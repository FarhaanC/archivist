export interface DocumentRecord {
    id?: number;
    title: string;
    fullText: string;
    /** Original bytes, kept so the document can be previewed and re-parsed. */
    blob?: Blob;
    mimeType?: string;
    byteSize?: number;
    uploadedAt: number;
    /** SHA-256 of the normalized extracted text — exact-duplicate detection. */
    contentHash?: string;
    /** Embedding of the document head — near-duplicate detection. */
    docVector?: number[];
    /** Topic profile written by the library brain at ingest time. */
    profile?: {
        topics: string[];
        wordCount: number;
    };
    /** Set when this document is a near-duplicate of another. */
    similarToDocId?: number;
    /** Human-readable summary of how it differs from that document. */
    diffSummary?: string;
}

export interface ChunkRecord {
    id?: number;
    docId: number;
    /** Position of this chunk within its document. */
    ordinal: number;
    text: string;
    vector: number[];
}

/** One saved conversation. Chats are never dropped on their own — nothing
 *  here expires, and only an explicit delete removes anything. */
export interface ConversationRecord {
    id?: number;
    title: string;
    createdAt: number;
    updatedAt: number;
}

/** A passage as it was shown at the time, kept so reopening a chat shows the
 *  same evidence even if the library has changed since. */
export interface StoredEvidence {
    docId: number;
    filename: string;
    snippet: string;
    score: string;
}

/** One turn in a conversation. */
export interface MessageRecord {
    id?: number;
    conversationId: number;
    /** Position within the conversation, from 0. */
    ordinal: number;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
    /** Assistant turns: why there was no written answer, in plain words. */
    note?: string;
    /** Assistant turns: what was actually searched for. */
    subQueries?: string[];
    evidence?: StoredEvidence[];
    alternatives?: { docId: number; title: string; snippet: string }[];
    coach?: { note: string; suggestions: string[] };
    /** Which model wrote this answer. Recorded per turn, because it can change. */
    modelId?: string;
}
