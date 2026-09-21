import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import type { ChunkRecord } from '@/db/types';
import type { SearchResult } from '@/search/types';

/**
 * What actually gets sent to the model.
 *
 * Search matches a single ~500-character piece of a document, and sending
 * only that piece is where answers go wrong: a CV entry's employer sits in
 * the piece above its dates, so the model receives dates with no employer and
 * borrows a name from somewhere else. No cut is right for every question —
 * whatever the boundary, some answer straddles it.
 *
 * So a matched piece is never sent alone:
 *
 *   • A short document — a CV, a letter, a note — is sent whole. There are no
 *     boundaries to fall across because there are no cuts.
 *   • A long one is sent as the matched piece plus its neighbours, joined.
 *
 * These are the two standard fixes for the problem, known elsewhere as
 * sentence-window retrieval and auto-merging retrieval. The cost is context:
 * each source is several times larger, so fewer of them fit. Three passages
 * that can be read beats five fragments that start mid-word.
 */

/** Documents at or under this many characters are sent whole. About four
 *  pages — a CV, a cover letter, a contract clause set. */
export const WHOLE_DOCUMENT_LIMIT = 6000;

/** How many pieces either side of a match to bring along. */
export const NEIGHBOUR_RADIUS = 1;

/** How many documents to send. Lower than the old five because each is now
 *  much larger, and the model holds roughly 4,000 words in total. */
export const MAX_SOURCES = 3;

/**
 * How many matched sections of ONE document may be sent, and how strong the
 * second has to be relative to the first.
 *
 * One section per document was the rule, and it produced a wrong answer on
 * a real contract: "what is the notice period?" matched two sections — seven
 * days during probation, thirty days after — and the second was thrown away
 * because the first had claimed the document's one slot. The model answered
 * "seven days" with no idea a second rule existed. A document that answers a
 * question twice, under two conditions, has to be allowed to say so.
 *
 * Allowing it was not enough. The same contract, asked the same question,
 * still lost its thirty-day rule: that section was a search hit, but it
 * scored just under 0.8 of the seven-day section and was dropped as too weak.
 * Two rules on the same subject rarely score alike — the one whose wording
 * happens to echo the question wins by a margin — so a strength test alone
 * keeps throwing away the second half of a two-part answer.
 *
 * Position is the better witness. Two clauses that both answer a question
 * are usually on the same page of a contract, a few hundred words apart; the
 * two notice rules were two pieces apart. So a second hit is now also kept
 * when it sits within NEARBY_PIECES of the first, however it scored: nearness
 * to a strong match on the same subject is its own evidence. Four pieces is
 * about a page. Wider than that and unrelated sections start coming along.
 * The strength bar is lowered to 0.7 as well, for a second clause that is
 * far away but plainly about the same thing.
 */
export const MAX_SECTIONS_PER_DOCUMENT = 2;
export const SECOND_SECTION_RATIO = 0.7;
export const NEARBY_PIECES = 4;

export interface ContextSource {
    docId: number;
    filename: string;
    /** Fused retrieval score of the piece that matched. */
    score: string;
    /** The text the model is given. */
    text: string;
    /** How it was assembled — reported to the user, because what the model
     *  read and what the user is shown must be the same thing. */
    kind: 'whole-document' | 'window';
    /** How many separate matched sections a window joins. 1 for most. */
    sections: number;
}

/**
 * One source per document, best match first.
 *
 * Sending two overlapping windows from the same file wastes the context that
 * expanding them was meant to buy.
 */
export const chooseSources = <T extends { docId: number }>(
    results: T[],
    max: number = MAX_SOURCES,
): T[] => {
    const seen = new Set<number>();
    const chosen: T[] = [];

    for (const result of results) {
        if (seen.has(result.docId)) continue;
        seen.add(result.docId);
        chosen.push(result);
        if (chosen.length >= max) break;
    }

    return chosen;
};

const numeric = (score: string): number => {
    const value = Number.parseFloat(score);
    return Number.isFinite(value) ? value : 0;
};

/** Where a matched piece sits in its document, by piece id. Search results
 *  do not carry this; buildSources looks it up for the few pieces involved. */
export type OrdinalLookup = ReadonlyMap<number, number>;

/**
 * Further matches from the same documents as `chosen`, best first, at most
 * MAX_SECTIONS_PER_DOCUMENT - 1 per document. A second match is kept when it
 * scores close to that document's best, or when it sits within NEARBY_PIECES
 * of it (given `ordinals`; without them, nearness cannot be judged and only
 * strength counts). A weak, distant second match would drag in a section the
 * question is not about, and cost context that a third document needs.
 */
export const extraSections = <T extends { docId: number; id: number; score: string }>(
    results: T[],
    chosen: T[],
    ordinals?: OrdinalLookup,
): T[] => {
    const best = new Map<number, T>();
    for (const c of chosen) best.set(c.docId, c);

    const isNear = (a: T, b: T): boolean => {
        const first = ordinals?.get(a.id);
        const second = ordinals?.get(b.id);
        if (first === undefined || second === undefined) return false;
        return Math.abs(first - second) <= NEARBY_PIECES;
    };

    const taken = new Map<number, number>();
    const extras: T[] = [];
    for (const result of results) {
        const top = best.get(result.docId);
        if (!top || result.id === top.id) continue;
        if ((taken.get(result.docId) ?? 0) >= MAX_SECTIONS_PER_DOCUMENT - 1) continue;
        const strong = numeric(result.score) >= numeric(top.score) * SECOND_SECTION_RATIO;
        if (!strong && !isNear(result, top)) continue;
        taken.set(result.docId, (taken.get(result.docId) ?? 0) + 1);
        extras.push(result);
    }
    return extras;
};

/**
 * The positions of the matched pieces that could become a second section:
 * every hit from a chosen document. That is a handful of ids — search
 * returns a few results in all — fetched in one call, so nearness can be
 * judged without reading anything the answer would not use anyway.
 */
const lookupOrdinals = async (
    results: SearchResult[],
    chosen: SearchResult[],
): Promise<OrdinalLookup> => {
    const docIds = new Set(chosen.map((hit) => hit.docId));
    const ids = results.filter((hit) => docIds.has(hit.docId)).map((hit) => hit.id);
    const ordinals = new Map<number, number>();
    if (ids.length === 0) return ordinals;
    for (const chunk of await db.chunks.bulkGet(ids)) {
        if (chunk?.id !== undefined) ordinals.set(chunk.id, chunk.ordinal);
    }
    return ordinals;
};

/**
 * Split ordinals into runs of consecutive pieces. Two matched sections that
 * sit next to each other become one longer window; two far apart become two
 * windows joined with a visible gap, so the model does not read across the
 * cut as if it were continuous prose.
 */
export const groupRuns = (ordinals: number[]): number[][] => {
    const sorted = [...new Set(ordinals)].sort((a, b) => a - b);
    const runs: number[][] = [];
    for (const ordinal of sorted) {
        const current = runs[runs.length - 1];
        if (current && ordinal === (current[current.length - 1] as number) + 1) current.push(ordinal);
        else runs.push([ordinal]);
    }
    return runs;
};

/** Marks the cut between two sections of the same document. */
export const SECTION_GAP = ' […] ';

/** The positions to fetch around a match, never below zero. */
export const neighbourOrdinals = (
    ordinal: number,
    radius: number = NEIGHBOUR_RADIUS,
): number[] => {
    const ordinals: number[] = [];
    for (let i = ordinal - radius; i <= ordinal + radius; i++) {
        if (i >= 0) ordinals.push(i);
    }
    return ordinals;
};

/** Whether a document is short enough to send in full. */
export const shouldSendWhole = (
    characters: number,
    limit: number = WHOLE_DOCUMENT_LIMIT,
): boolean => characters > 0 && characters <= limit;

/**
 * Join pieces back into continuous text, in document order.
 *
 * Chunks overlap by design, so the join drops a piece's opening where it
 * repeats the end of the one before — otherwise the model reads the same
 * sentence twice and sometimes answers twice.
 */
export const joinChunks = (chunks: Pick<ChunkRecord, 'ordinal' | 'text'>[]): string => {
    const ordered = [...chunks].sort((a, b) => a.ordinal - b.ordinal);

    let joined = '';
    for (const chunk of ordered) {
        const text = chunk.text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (!joined) {
            joined = text;
            continue;
        }

        // Longest suffix of what we have that also opens the next piece.
        let overlap = 0;
        const maxOverlap = Math.min(joined.length, text.length, 200);
        for (let size = maxOverlap; size > 20; size--) {
            if (joined.endsWith(text.slice(0, size))) {
                overlap = size;
                break;
            }
        }
        joined += ` ${text.slice(overlap)}`.replace(/\s+/g, ' ');
    }

    return joined.trim();
};

/**
 * Assemble what the model will be given, from what search matched.
 * Falls back to the matched piece alone if the store cannot be read, so a
 * failure here degrades the answer rather than breaking the ask.
 */
export const buildSources = async (
    results: SearchResult[],
    max: number = MAX_SOURCES,
): Promise<ContextSource[]> => {
    const chosen = chooseSources(results, max);
    if (chosen.length === 0) return [];

    await ensureDbOpen();

    // If positions cannot be read, second sections are judged on strength
    // alone — a weaker answer, not a broken one.
    const ordinals = await lookupOrdinals(results, chosen).catch((): OrdinalLookup => new Map());
    const extras = extraSections(results, chosen, ordinals);

    return Promise.all(
        chosen.map(async (hit): Promise<ContextSource> => {
            const fallback: ContextSource = {
                docId: hit.docId,
                filename: hit.filename,
                score: hit.score,
                text: hit.text,
                kind: 'window',
                sections: 1,
            };

            try {
                const document = await db.documents.get(hit.docId);
                if (document && shouldSendWhole(document.fullText.length)) {
                    return {
                        ...fallback,
                        text: document.fullText.replace(/\s+/g, ' ').trim(),
                        kind: 'whole-document',
                    };
                }

                const matchedIds = [hit, ...extras.filter((e) => e.docId === hit.docId)].map((h) => h.id);
                const matchedChunks = (await db.chunks.bulkGet(matchedIds)).filter(
                    (chunk): chunk is ChunkRecord => chunk !== undefined,
                );
                if (matchedChunks.length === 0) return fallback;

                const wanted = new Set(matchedChunks.flatMap((chunk) => neighbourOrdinals(chunk.ordinal)));
                const pieces = await db.chunks
                    .where('docId')
                    .equals(hit.docId)
                    .and((chunk) => wanted.has(chunk.ordinal))
                    .toArray();
                const byOrdinal = new Map(pieces.map((piece) => [piece.ordinal, piece]));

                const runs = groupRuns(pieces.map((piece) => piece.ordinal));
                const text = runs
                    .map((run) => joinChunks(run.map((ordinal) => byOrdinal.get(ordinal) as ChunkRecord)))
                    .filter(Boolean)
                    .join(SECTION_GAP);

                return {
                    ...fallback,
                    text: text || joinChunks(matchedChunks) || hit.text,
                    sections: Math.max(1, runs.length),
                };
            } catch {
                return fallback;
            }
        }),
    );
};
