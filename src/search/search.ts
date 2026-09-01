import MiniSearch from 'minisearch';
import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import {
    EXACT_PHRASE_BOOST,
    MINI_SEARCH_FUZZY,
    MINI_SEARCH_TEXT_BOOST,
    MINI_SEARCH_TITLE_BOOST,
    RRF_CONSTANT,
    SCORE_DISPLAY_SCALE,
} from '@/search/constants';
import type {
    EmbeddingWorker,
    KeywordSearchResult,
    MiniSearchDocument,
    SearchResult,
    VectorSearchResult,
} from '@/search/types';

/**
 * Hybrid retrieval.
 *
 * Vector search alone misses exact tokens — part numbers, dates, names — that
 * mean everything in a document library. Keyword search alone misses the
 * paraphrase. Running both and fusing their RANKS (rather than their scores,
 * which are on incomparable scales) is what makes this usable on real files.
 */

const cosine = (a: number[], b: number[]): number => {
    let dot = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
    return dot; // both sides are L2-normalized by the embedder
};

let index: MiniSearch<MiniSearchDocument> | null = null;
let indexedChunkCount = -1;

const buildKeywordIndex = async (): Promise<MiniSearch<MiniSearchDocument>> => {
    const count = await db.chunks.count();
    if (index && indexedChunkCount === count) return index;

    const [chunks, documents] = await Promise.all([
        db.chunks.toArray(),
        db.documents.toArray(),
    ]);
    const titleById = new Map(documents.map((d) => [d.id!, d.title]));

    const next = new MiniSearch<MiniSearchDocument>({
        fields: ['text', 'title'],
        storeFields: ['docId', 'text'],
        searchOptions: {
            fuzzy: MINI_SEARCH_FUZZY,
            prefix: true,
            boost: { text: MINI_SEARCH_TEXT_BOOST, title: MINI_SEARCH_TITLE_BOOST },
        },
    });
    next.addAll(
        chunks.map((c) => ({
            id: c.id!,
            docId: c.docId,
            text: c.text,
            title: titleById.get(c.docId) ?? '',
        })),
    );

    index = next;
    indexedChunkCount = count;
    return next;
};

/** Call after ingesting or deleting so the next search rebuilds. */
export const invalidateKeywordIndex = (): void => {
    index = null;
    indexedChunkCount = -1;
};

const keywordSearch = async (query: string, topK: number): Promise<KeywordSearchResult[]> => {
    const mini = await buildKeywordIndex();
    return mini
        .search(query)
        .slice(0, topK * 4)
        .map((hit) => ({
            id: hit.id as number,
            score: hit.score,
            text: (hit as unknown as { text: string }).text,
            docId: (hit as unknown as { docId: number }).docId,
        }));
};

const vectorSearch = async (
    query: string,
    worker: EmbeddingWorker,
    topK: number,
): Promise<VectorSearchResult[]> => {
    const queryVector = Array.from(await worker.getEmbedding(query));
    const chunks = await db.chunks.toArray();
    return chunks
        .map((c) => ({
            id: c.id!,
            docId: c.docId,
            text: c.text,
            score: cosine(queryVector, c.vector),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK * 4);
};

/**
 * Reciprocal Rank Fusion: each list contributes 1/(k + rank). A chunk that
 * both retrievers rank highly beats one that either ranks first alone, which
 * is exactly the behaviour we want when the question mixes a concept with a
 * literal identifier. `balance` weights the two sides (0 = keyword only,
 * 1 = vector only).
 */
export const search = async (
    query: string,
    worker: EmbeddingWorker,
    topK: number = 5,
    balance: number = 0.5,
): Promise<SearchResult[]> => {
    await ensureDbOpen();
    const trimmed = query.trim();
    if (!trimmed) return [];

    const [vector, keyword] = await Promise.all([
        vectorSearch(trimmed, worker, topK),
        keywordSearch(trimmed, topK),
    ]);

    const fused = new Map<
        number,
        { docId: number; text: string; score: number; vector: number; keyword: number }
    >();

    const contribute = (
        list: { id: number; docId: number; text: string; score: number }[],
        weight: number,
        field: 'vector' | 'keyword',
    ): void => {
        list.forEach((hit, rank) => {
            const entry = fused.get(hit.id) ?? {
                docId: hit.docId,
                text: hit.text,
                score: 0,
                vector: 0,
                keyword: 0,
            };
            entry.score += weight * (1 / (RRF_CONSTANT + rank + 1));
            entry[field] = hit.score;
            fused.set(hit.id, entry);
        });
    };

    contribute(vector, balance, 'vector');
    contribute(keyword as unknown as VectorSearchResult[], 1 - balance, 'keyword');

    // An exact phrase match is strong evidence that no ranking signal captures.
    const needle = trimmed.toLowerCase();
    for (const entry of fused.values()) {
        if (entry.text.toLowerCase().includes(needle)) entry.score *= EXACT_PHRASE_BOOST;
    }

    const documents = await db.documents.toArray();
    const titleById = new Map(documents.map((d) => [d.id!, d.title]));

    return [...fused.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, topK)
        .map(([id, entry]) => ({
            id,
            docId: entry.docId,
            score: (entry.score * SCORE_DISPLAY_SCALE).toFixed(2),
            text: entry.text,
            filename: titleById.get(entry.docId) ?? 'Unknown document',
            debug: {
                vector: entry.vector.toFixed(3),
                keyword: entry.keyword.toFixed(3),
            },
        }));
};
