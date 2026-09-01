import type { EmbeddingWorker } from '@/lib/types';
import type { DocumentRecord } from '@/db/types';

export type { EmbeddingWorker };

/** One chunk returned by hybrid search, with its per-retriever scores kept
 *  for the debug panel — opaque relevance is impossible to tune. */
export interface SearchResult {
    id: number;
    docId: number;
    score: string;
    text: string;
    filename: string;
    debug: {
        vector: string;
        keyword: string;
    };
}

export interface KeywordSearchResult {
    id: string | number;
    score: number;
    text: string;
    docId: number;
}

export interface VectorSearchResult {
    id: number;
    docId: number;
    text: string;
    score: number;
}

export interface MiniSearchDocument {
    id: number;
    docId: number;
    text: string;
    title: string;
}

/** A turn in the ask/answer transcript. */
export interface SearchChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    documents?: DocumentRecord[];
    searchResults?: SearchResult[];
    query?: string;
    timestamp: Date;
    isStreaming?: boolean;
    /** Documents that scored near the top but were not used in the answer,
     *  offered to the user as targets for a scoped re-ask. */
    alternatives?: { docId: number; title: string; snippet: string }[];
    /** Diagnosis and better questions when the turn probably failed. */
    coach?: { note: string; suggestions: string[] };
}
