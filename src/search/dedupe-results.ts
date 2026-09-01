import type { SearchResult } from '@/search/types';

/**
 * Suppress near-identical chunks in search results (duplicate documents,
 * boilerplate repeated across files). Keeps the highest-scoring copy so
 * the topK slots carry DIVERSE evidence instead of five copies of one text.
 */

const tokenSet = (text: string): Set<string> =>
    new Set(
        text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 2)
    );

const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    return inter / (a.size + b.size - inter);
};

export const SIMILAR_CHUNK_THRESHOLD = 0.85;

/** Input must be sorted by score descending (highest first is kept). */
export const dedupeSimilarResults = <T extends Pick<SearchResult, 'text'>>(
    results: T[],
    threshold: number = SIMILAR_CHUNK_THRESHOLD
): T[] => {
    const kept: { result: T; tokens: Set<string> }[] = [];
    for (const r of results) {
        const tokens = tokenSet(r.text);
        const isDupe = kept.some((k) => jaccard(tokens, k.tokens) >= threshold);
        if (!isDupe) kept.push({ result: r, tokens });
    }
    return kept.map((k) => k.result);
};
