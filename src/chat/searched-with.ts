import type { MessageRecord, SearchedWith } from '@/db/types';

/**
 * What to tell the user about a question that was searched for in more than
 * one way — and, just as importantly, why.
 *
 * There are two reasons a turn ends up with several searches, and they used
 * to be recorded identically. A genuinely multi-part question ("what is my
 * notice period and when does my lease end?") is split into separate
 * questions. A follow-up ("and the other one?") is instead searched again
 * with the previous question in front of it. Calling both of them
 * "sub-questions" was wrong for the second case and confusing in the first.
 */

/**
 * @param queries what was actually searched for
 * @param expandedWithPrevious true when the extra query is the previous
 *        question with this one appended, rather than a split
 */
export const describeSearch = (
    queries: string[],
    expandedWithPrevious: boolean,
): SearchedWith | null => {
    if (queries.length < 2) return null;
    return { kind: expandedWithPrevious ? 'follow-up' : 'multi-part', queries };
};

/**
 * Answers saved before this distinction existed recorded only the list of
 * queries. Those were overwhelmingly split questions, and there is nothing
 * left to tell them apart by, so they read as multi-part.
 */
export const searchedWithOf = (
    message: Pick<MessageRecord, 'searchedWith' | 'subQueries'>,
): SearchedWith | null => {
    if (message.searchedWith) return message.searchedWith;
    if (message.subQueries && message.subQueries.length > 1) {
        return { kind: 'multi-part', queries: message.subQueries };
    }
    return null;
};

/** The one-line summary the user sees before opening the detail. */
export const searchHeading = (searched: SearchedWith): string =>
    searched.kind === 'follow-up'
        ? 'Also searched together with your previous question'
        : `Searched as ${searched.queries.length} separate questions`;

/**
 * Which queries are worth showing. For a split, all of them. For a follow-up,
 * only the combined one — the question as typed is already on screen right
 * above it.
 */
export const searchDetail = (searched: SearchedWith): string[] =>
    searched.kind === 'follow-up' ? searched.queries.slice(-1) : searched.queries;
