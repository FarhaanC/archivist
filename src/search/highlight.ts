import { contentWordList } from '@/search/words';

/**
 * Marking the question's words inside a passage.
 *
 * A passage on its own answers "what was retrieved". Marking the words the
 * question actually asked about answers "why", which is the question a reader
 * looking at evidence really has — and it turns a wall of CV text into
 * something scannable in a second.
 */

export interface HighlightSegment {
    text: string;
    /** True when this run matched a word from the question. */
    match: boolean;
}

const escape = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split `text` into runs, marking the ones that match a meaningful word from
 * `query`. Joining every segment's `text` reproduces the input exactly, so
 * this can never alter what the user is shown — only how it is styled.
 *
 * Terms come from the same word list the rest of search uses, so filler like
 * "what" and "does" is never marked, and they are stemmed, so asking about
 * "resumes" marks "resume" in the passage and the other way round.
 */
export const highlight = (text: string, query: string): HighlightSegment[] => {
    if (!text) return [];

    const terms = [...new Set(contentWordList(query))].sort((a, b) => b.length - a.length);
    if (terms.length === 0) return [{ text, match: false }];

    // The optional suffix catches the plural of a stemmed term without
    // matching a longer unrelated word: "resume" hits "resumes", not
    // "resumption".
    const pattern = new RegExp(`\\b(?:${terms.map(escape).join('|')})(?:s|es)?\\b`, 'gi');

    const segments: HighlightSegment[] = [];
    let lastIndex = 0;

    for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
        if (hit.index > lastIndex) {
            segments.push({ text: text.slice(lastIndex, hit.index), match: false });
        }
        segments.push({ text: hit[0], match: true });
        lastIndex = hit.index + hit[0].length;

        // A zero-length match would loop forever; step past it.
        if (hit[0].length === 0) pattern.lastIndex += 1;
    }

    if (lastIndex < text.length) {
        segments.push({ text: text.slice(lastIndex), match: false });
    }

    return segments;
};
