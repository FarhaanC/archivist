import { search } from '@/search/search';
import type { EmbeddingWorker, SearchResult } from '@/search/types';

const toNumber = (s: unknown): number => {
    const n = typeof s === 'string' ? parseFloat(s) : (s as number);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Merge the results of several searches into one ranked list:
 * - deduped by chunk id, keeping the best score
 * - held to `maxPerDoc` pieces per document WHILE THE LIST IS FULL, so one
 *   file cannot crowd the others out (this is what lets answers CONNECT
 *   information across documents) — but never at the cost of leaving slots
 *   empty. A document's fourth hit is dropped only when another document
 *   needed the room.
 * - sorted by score, trimmed to maxTotal
 *
 * The "while full" part was learned from a contract. Asked for the notice
 * period, the search found four pieces of it: the two rules — seven days
 * during probation, thirty days after — and two pieces above them that
 * happen to say "until further notice". Ranked by score the thirty-day rule
 * came fourth, and a flat cap of three per document threw it away with five
 * empty slots still in the list. The part of the app that sends two sections
 * of one document never got to see it.
 */
export const mergeResults = (
    lists: SearchResult[][],
    maxPerDoc: number = 3,
    maxTotal: number = 8,
): SearchResult[] => {
    const merged = new Map<number | string, SearchResult>();
    for (const results of lists) {
        for (const r of results) {
            const existing = merged.get(r.id);
            if (!existing || toNumber(r.score) > toNumber(existing.score)) {
                merged.set(r.id, r);
            }
        }
    }

    const sorted = [...merged.values()].sort(
        (a, b) => toNumber(b.score) - toNumber(a.score)
    );

    // First pass: every document gets up to its share, best first.
    const perDocCount = new Map<number, number>();
    const chosen = new Set<SearchResult>();
    for (const r of sorted) {
        const count = perDocCount.get(r.docId) ?? 0;
        if (count >= maxPerDoc) continue;
        perDocCount.set(r.docId, count + 1);
        chosen.add(r);
        if (chosen.size >= maxTotal) break;
    }
    // Second pass: room left over goes to whatever scored next, whichever
    // document it belongs to.
    for (const r of sorted) {
        if (chosen.size >= maxTotal) break;
        chosen.add(r);
    }

    return sorted.filter((r) => chosen.has(r));
};

/**
 * Run hybrid search for several queries and merge the results with
 * `mergeResults`. Eight hits a query rather than five, because a document
 * that answers a question twice needs both answers to make the list, and
 * the extra hits cost nothing until the part that builds the model's
 * evidence decides what to send.
 */
export const searchMulti = async (
    queries: string[],
    worker: EmbeddingWorker,
    perQueryTopK: number = 8,
    hybridBalance: number = 0.5,
    maxPerDoc: number = 3,
    maxTotal: number = 8
): Promise<SearchResult[]> => {
    const lists: SearchResult[][] = [];
    for (const q of queries) {
        try {
            lists.push(await search(q, worker, perQueryTopK, hybridBalance));
        } catch (err) {
            console.warn(`[multi-search] Sub-query failed: "${q}"`, err);
        }
    }
    return mergeResults(lists, maxPerDoc, maxTotal);
};
