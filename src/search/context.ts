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

    return Promise.all(
        chosen.map(async (hit): Promise<ContextSource> => {
            const fallback: ContextSource = {
                docId: hit.docId,
                filename: hit.filename,
                score: hit.score,
                text: hit.text,
                kind: 'window',
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

                const matched = await db.chunks.get(hit.id);
                if (!matched) return fallback;

                const wanted = new Set(neighbourOrdinals(matched.ordinal));
                const neighbours = await db.chunks
                    .where('docId')
                    .equals(hit.docId)
                    .and((chunk) => wanted.has(chunk.ordinal))
                    .toArray();

                const text = joinChunks(neighbours.length ? neighbours : [matched]);
                return { ...fallback, text: text || hit.text };
            } catch {
                return fallback;
            }
        }),
    );
};
