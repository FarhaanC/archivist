import Dexie, { type EntityTable } from 'dexie';
import type { ChunkRecord, DocumentRecord } from '@/db/types';

/**
 * The whole store. IndexedDB only — there is no server and no sync.
 *
 * Vectors live on the chunk rows rather than in a separate index: at the
 * library sizes this app targets (thousands of chunks, not millions) a linear
 * cosine scan in a worker is fast enough, and it keeps the store to two tables
 * that can be reasoned about and exported.
 */
export class ArchivistDb extends Dexie {
    documents!: EntityTable<DocumentRecord, 'id'>;
    chunks!: EntityTable<ChunkRecord, 'id'>;

    constructor() {
        super('archivist');
        this.version(1).stores({
            documents: '++id, title, uploadedAt, contentHash',
            chunks: '++id, docId, ordinal',
        });
    }
}

export const db = new ArchivistDb();
