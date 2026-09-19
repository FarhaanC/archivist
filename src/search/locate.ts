import { IGNORED_WORDS, stem } from '@/search/words';

/**
 * Finding the sentence an answer rests on.
 *
 * The model reads a passage and writes an answer. To let a person check that
 * answer, the app has to point at the sentence the answer came from — not at
 * the first place a word from the question happens to appear, which is how
 * "what is the notice period?" came to show a sentence about "until further
 * notice" while the answer's "seven days" sat one sentence out of frame.
 *
 * So: split the text into sentences, score each by how many of the answer's
 * meaningful words it contains (numbers count — "seven", "1,496.25" and
 * "2026" are usually the whole point), and pick the best. When nothing
 * matches the answer — the model refused, or made something up — fall back to
 * the question's words, and when even those match nothing, say so with null,
 * so the caller can show the opening rather than pretend.
 */

export interface TextRange {
    start: number;
    end: number;
}

/** Words that carry meaning for matching an answer to its evidence. Unlike
 *  the search word list this keeps numbers of any length and short
 *  all-caps tokens ("AED", "CEO"), because those are exactly what answers
 *  are made of. */
export const evidenceWords = (text: string): string[] =>
    text
        .replace(/\[[^\]]{1,200}\]/g, ' ') // citations like [contract.pdf] are not evidence
        .split(/[^A-Za-z0-9.,]+/)
        .map((token) => token.replace(/^[.,]+|[.,]+$/g, ''))
        .filter((token) => token.length > 0)
        .filter((token) => /\d/.test(token) || token.length > 2 || token === token.toUpperCase())
        .map((token) => token.toLowerCase())
        .filter((token) => !IGNORED_WORDS.has(token))
        .map((token) => (/\d/.test(token) ? token.replace(/,/g, '') : stem(token)));

/**
 * Sentence boundaries. Deliberately simple — a full stop, question or
 * exclamation mark followed by a space, or a line break — because the text
 * here is OCR output and contract prose, not literature, and a boundary in
 * slightly the wrong place costs a few words either side, not the sentence.
 * A full stop between two digits ("1,496.25") is never a boundary.
 */
export const splitSentences = (text: string): (TextRange & { text: string })[] => {
    const sentences: (TextRange & { text: string })[] = [];
    let start = 0;

    const push = (end: number): void => {
        const raw = text.slice(start, end);
        const leading = raw.length - raw.trimStart().length;
        const trimmed = raw.trim();
        if (trimmed) sentences.push({ start: start + leading, end: start + leading + trimmed.length, text: trimmed });
        start = end;
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i] as string;
        if (char === '\n') {
            push(i);
            start = i + 1;
        } else if (char === '.' || char === '!' || char === '?') {
            // Swallow a run of terminators ("?!", "...") then require a gap.
            let j = i;
            while (j + 1 < text.length && /[.!?]/.test(text[j + 1] as string)) j++;
            const next = text[j + 1];
            if (next === undefined || /\s/.test(next)) {
                push(j + 1);
                i = j;
            }
        }
    }
    push(text.length);
    return sentences;
};

const overlap = (sentence: Set<string>, wanted: string[]): number => {
    let count = 0;
    for (const word of new Set(wanted)) if (sentence.has(word)) count += 1;
    return count;
};

/**
 * The sentence in `text` that best supports `answer`, or failing that best
 * matches `question`, or null when neither matches anything at all.
 *
 * A single shared word is not support: "the" is ignored already, but a
 * lone "contract" would match half a contract. Two answer words, or one
 * answer word that is a number, is the bar.
 */
export const findSupportingSentence = (
    text: string,
    answer: string,
    question: string = '',
): TextRange | null => findSupportingSentences(text, answer, question, 1)[0] ?? null;

/**
 * Every sentence that supports the answer, best first, at most `max` — for
 * an answer that rests on two places in one document ("seven days during
 * probation, thirty days after"), both are marked. Falls back to the single
 * best question match when nothing supports the answer.
 */
export const findSupportingSentences = (
    text: string,
    answer: string,
    question: string = '',
    max: number = 3,
): TextRange[] => {
    const sentences = splitSentences(text);
    if (sentences.length === 0) return [];

    const answerWords = evidenceWords(answer);
    const questionWords = evidenceWords(question);

    // How many sentences each word appears in. A word in half the sentences
    // ("contract", in a contract) says little about which one is meant; a
    // word in one sentence says everything.
    const sentenceWords = sentences.map((sentence) => new Set(evidenceWords(sentence.text)));
    const frequency = new Map<string, number>();
    for (const words of sentenceWords) {
        for (const word of words) frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
    const weight = (words: Set<string>, wanted: string[]): number => {
        let total = 0;
        for (const word of new Set(wanted)) if (words.has(word)) total += 1 / (frequency.get(word) ?? 1);
        return total;
    };

    const scored = sentences.map((sentence, index) => {
        const words = sentenceWords[index] as Set<string>;
        const fromAnswer = overlap(words, answerWords);
        const numbers = answerWords.filter((w) => /\d/.test(w) && words.has(w)).length;
        const fromQuestion = overlap(words, questionWords);
        return {
            sentence,
            fromAnswer,
            numbers,
            fromQuestion,
            answerWeight: weight(words, answerWords),
            questionWeight: weight(words, questionWords),
        };
    });

    const supports = (s: (typeof scored)[number]): boolean => s.fromAnswer >= 2 || s.numbers >= 1;

    const supporting = scored.filter(supports).sort(
        (a, b) =>
            b.numbers - a.numbers ||
            b.answerWeight - a.answerWeight ||
            b.questionWeight - a.questionWeight ||
            a.sentence.start - b.sentence.start,
    );

    if (supporting.length > 0) {
        // A second sentence has to carry real weight of its own — at least
        // half the best one's — or it is just the best one's words echoed
        // somewhere else in the document.
        const floor = (supporting[0] as (typeof scored)[number]).answerWeight / 2;
        return supporting
            .filter((s, index) => index === 0 || s.answerWeight >= floor)
            .slice(0, max)
            .map((s) => ({ start: s.sentence.start, end: s.sentence.end }));
    }

    const fallback = scored
        .filter((s) => s.fromQuestion >= 1)
        .sort((a, b) => b.questionWeight - a.questionWeight || a.sentence.start - b.sentence.start)[0];

    return fallback ? [{ start: fallback.sentence.start, end: fallback.sentence.end }] : [];
};
