import { evidenceWords, splitSentences } from '@/search/locate';

/**
 * Saying each fact once.
 *
 * A small model, asked when a licence expires, answered four times: the
 * expiry date, then the same date as "the expiry date of the licence", then
 * "so the licence is valid until" the same date again. The prompt now tells
 * it not to, and a 3B model mostly listens — mostly. This is the safety net
 * for when it does not: once the answer is complete, sentences that only
 * restate an earlier sentence are dropped.
 *
 * What counts as a restatement is deliberately narrow. A sentence goes only
 * when nearly all of its meaningful words already appeared in one earlier
 * sentence that was kept, and it brings no number the earlier one lacked. A
 * second date, a different amount, a different day count is new information
 * however similar the wording around it, and stays. The first sentence
 * always stays, so an answer is never emptied.
 *
 * This runs on the finished answer, never on the text while it streams:
 * a sentence cannot be judged a repeat until the rest of it has arrived.
 */

/** How much of a sentence's meaning must already have been said. */
export const REPEAT_THRESHOLD = 0.8;

/** Letters kept when comparing words, so "expires", "expiry" and
 *  "expiration" count as the same fact and "licence" matches "licensed".
 *  The stemmer search uses only strips a plural "s", which is not enough
 *  for prose that reaches for a synonym each time it repeats itself. */
const ROOT_LENGTH = 5;

const isNumber = (word: string): boolean => /\d/.test(word);

/** Words about the answering rather than the fact — "so", "according to
 *  the document", "in other words". A restatement leans on these, and they
 *  would otherwise count as new information. Stems, to match ROOT_LENGTH. */
const FILLER = new Set([
    'so', 'also', 'there', 'thus', 'hence', 'again', 'other', 'words', 'means', 'meani',
    'accor', 'menti', 'state', 'based', 'excer', 'docum', 'provi', 'given', 'shown',
]);

/** The words a sentence's meaning rests on, reduced so that inflections of
 *  the same word compare equal. Numbers are kept exactly. */
export const factWords = (sentence: string): Set<string> =>
    new Set(
        evidenceWords(sentence)
            .map((word) => (isNumber(word) || word.length <= ROOT_LENGTH ? word : word.slice(0, ROOT_LENGTH)))
            .filter((word) => !FILLER.has(word)),
    );

/** A sentence that is nothing but citations, "[contract.pdf]", belongs to
 *  the sentence before it and must travel with it. */
const isCitationOnly = (text: string): boolean => /^(\s*\[[^\]]{1,200}\])+\s*[.!?]*$/.test(text);

/** Citations at the start of a sentence, "[contract.pdf] The next fact…",
 *  were written after the previous full stop and belong to that sentence. */
const LEADING_CITATIONS = /^(\s*\[[^\]]{1,200}\])+\s+/;

interface Unit {
    start: number;
    end: number;
    words: Set<string>;
}

/**
 * The sentences of an answer as units to keep or drop, each with the
 * span of text it owns. A citation that the sentence splitter separated
 * from its sentence is folded back into it.
 */
const units = (answer: string): Unit[] => {
    const result: Unit[] = [];
    for (const sentence of splitSentences(answer)) {
        const previous = result[result.length - 1];
        if (previous && isCitationOnly(sentence.text)) {
            previous.end = sentence.end;
            continue;
        }
        let { start, text } = sentence;
        const leading = previous ? LEADING_CITATIONS.exec(text) : null;
        if (previous && leading) {
            previous.end = start + leading[0].trimEnd().length;
            start += leading[0].length;
            text = text.slice(leading[0].length);
        }
        result.push({ start, end: sentence.end, words: factWords(text) });
    }
    return result;
};

/** Whether `candidate` only restates `earlier`. */
export const isRepeatOf = (candidate: Set<string>, earlier: Set<string>): boolean => {
    if (candidate.size === 0) return false;
    let shared = 0;
    for (const word of candidate) {
        if (earlier.has(word)) shared += 1;
        else if (isNumber(word)) return false; // a number the earlier sentence lacks is news
    }
    return shared / candidate.size >= REPEAT_THRESHOLD;
};

const newlines = (text: string): number => (text.match(/\n/g) ?? []).length;

/**
 * The answer with restated sentences removed. Paragraph breaks survive:
 * when a sentence goes, the smaller of the gaps either side of it goes
 * with it, so a break between paragraphs is never the one that is lost.
 */
export const tidyAnswer = (answer: string): string => {
    const all = units(answer);
    if (all.length < 2) return answer;

    const kept: Unit[] = [];
    const dropped = new Set<Unit>();
    for (const unit of all) {
        const repeat = kept.some((earlier) => isRepeatOf(unit.words, earlier.words));
        if (repeat) dropped.add(unit);
        else kept.push(unit);
    }
    if (dropped.size === 0) return answer;

    // Cut each dropped sentence out along with one of its neighbouring gaps.
    const cuts: { start: number; end: number }[] = [];
    all.forEach((unit, index) => {
        if (!dropped.has(unit)) return;
        const before = all[index - 1];
        const after = all[index + 1];
        if (!before) {
            cuts.push({ start: unit.start, end: after ? after.start : unit.end });
            return;
        }
        if (!after) {
            cuts.push({ start: before.end, end: unit.end });
            return;
        }
        const gapBefore = answer.slice(before.end, unit.start);
        const gapAfter = answer.slice(unit.end, after.start);
        if (newlines(gapBefore) < newlines(gapAfter)) cuts.push({ start: before.end, end: unit.end });
        else cuts.push({ start: unit.start, end: after.start });
    });

    let text = '';
    let position = 0;
    for (const cut of cuts) {
        const start = Math.max(cut.start, position);
        text += answer.slice(position, start);
        position = Math.max(position, cut.end);
    }
    text += answer.slice(position);
    return text.trim();
};
