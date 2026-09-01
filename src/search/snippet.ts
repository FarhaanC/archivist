/**
 * Evidence snippets.
 *
 * A retrieved chunk is a 500-character slice of a document, and showing it raw
 * is how you get evidence that reads "pt, Java, SQL, MongoDB, asynchronous
 * programming" — the tail of a word, then a list, with the part that actually
 * matched the question somewhere off the end. Correct retrieval looks broken.
 *
 * So: find where in the chunk the question's words actually appear, take a
 * window around that, and cut it at word boundaries.
 */

import { IGNORED_WORDS } from '@/search/words';

export const DEFAULT_SNIPPET_LENGTH = 280;

const queryTerms = (query: string): string[] =>
    [
        ...new Set(
            query
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter((w) => w.length > 2 && !IGNORED_WORDS.has(w)),
        ),
    ];

/** Every position in `haystack` where any term occurs. */
const matchPositions = (haystack: string, terms: string[]): number[] => {
    const positions: number[] = [];
    for (const term of terms) {
        let from = 0;
        for (;;) {
            const at = haystack.indexOf(term, from);
            if (at === -1) break;
            positions.push(at);
            from = at + term.length;
        }
    }
    return positions.sort((a, b) => a - b);
};

/** Move `index` forward to the start of the next whole word. */
const forwardToWordStart = (text: string, index: number): number => {
    let i = index;
    while (i < text.length && !/\s/.test(text[i] as string)) i++;
    while (i < text.length && /[\s,;:.)\]}"']/.test(text[i] as string)) i++;
    return i;
};

/** Move `index` back to the end of the previous whole word. */
const backToWordEnd = (text: string, index: number): number => {
    let i = Math.min(index, text.length);
    while (i > 0 && !/\s/.test(text[i - 1] as string)) i--;
    while (i > 0 && /\s/.test(text[i - 1] as string)) i--;
    return i;
};

/**
 * A readable extract of `text` centred on where `query` matches.
 *
 * Guarantees, all covered by tests: never begins or ends mid-word; never
 * longer than `maxLength` plus the ellipses; shows the match when there is
 * one; falls back to the opening of the text when there isn't.
 */
export const makeSnippet = (
    text: string,
    query: string,
    maxLength: number = DEFAULT_SNIPPET_LENGTH,
): string => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;

    const terms = queryTerms(query);
    const positions = matchPositions(clean.toLowerCase(), terms);

    let start: number;
    if (positions.length === 0) {
        // Nothing matched literally — the hit came from the vector side. The
        // opening of the chunk is the most useful thing to show.
        start = 0;
    } else {
        // Centre on the match that has the most other matches near it, so a
        // dense region wins over the first stray occurrence.
        let best = positions[0] as number;
        let bestCount = 0;
        for (const position of positions) {
            const count = positions.filter(
                (other) => other >= position && other < position + maxLength,
            ).length;
            if (count > bestCount) {
                bestCount = count;
                best = position;
            }
        }
        // A little lead-in, so the match is not flush against the left edge.
        start = Math.max(0, best - Math.floor(maxLength / 5));
    }

    if (start > 0) start = forwardToWordStart(clean, start);

    let end = start + maxLength;
    if (end >= clean.length) {
        end = clean.length;
        // Pulled to the end of the text: re-anchor the start so the snippet
        // still uses its full budget rather than trailing off short.
        start = Math.max(0, end - maxLength);
        if (start > 0) start = forwardToWordStart(clean, start);
    } else {
        end = backToWordEnd(clean, end);
    }

    const body = clean.slice(start, end).trim();
    return `${start > 0 ? '…' : ''}${body}${end < clean.length ? '…' : ''}`;
};
