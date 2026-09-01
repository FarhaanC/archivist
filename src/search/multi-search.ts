import { search } from '@/search/search';
import type { EmbeddingWorker, SearchResult } from '@/search/types';

const toNumber = (s: unknown): number => {
    const n = typeof s === 'string' ? parseFloat(s) : (s as number);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Run hybrid search for several queries and merge the results:
 * - deduped by chunk id, keeping the best score
 * - capped per document so one file cannot crowd out the others
 *   (this is what lets answers CONNECT information across documents)
 * - sorted by score, trimmed to maxTotal
 */
export const searchMulti = async (
    queries: string[],
    worker: EmbeddingWorker,
    perQueryTopK: number = 5,
    hybridBalance: number = 0.5,
    maxPerDoc: number = 3,
    maxTotal: number = 8
): Promise<SearchResult[]> => {
    const merged = new Map<number | string, SearchResult>();

    for (const q of queries) {
        try {
            const results = await search(q, worker, perQueryTopK, hybridBalance);
            for (const r of results) {
                const existing = merged.get(r.id);
                if (!existing || toNumber(r.score) > toNumber(existing.score)) {
                    merged.set(r.id, r);
                }
            }
        } catch (err) {
            console.warn(`[multi-search] Sub-query failed: "${q}"`, err);
        }
    }

    const sorted = [...merged.values()].sort(
        (a, b) => toNumber(b.score) - toNumber(a.score)
    );

    const perDocCount = new Map<number, number>();
    const out: SearchResult[] = [];
    for (const r of sorted) {
        const count = perDocCount.get(r.docId) ?? 0;
        if (count >= maxPerDoc) continue;
        perDocCount.set(r.docId, count + 1);
        out.push(r);
        if (out.length >= maxTotal) break;
    }
    return out;
};
