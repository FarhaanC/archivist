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
