import Dexie, { type EntityTable } from 'dexie';
import type {
    ChunkRecord,
    ConversationRecord,
    DocumentRecord,
    ImportRunRecord,
    MessageRecord,
} from '@/db/types';

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
    conversations!: EntityTable<ConversationRecord, 'id'>;
    messages!: EntityTable<MessageRecord, 'id'>;
    importRuns!: EntityTable<ImportRunRecord, 'id'>;

    /** Named, so a throwaway store can be opened beside the real one. */
    constructor(name = 'archivist') {
        super(name);
        this.version(1).stores({
            documents: '++id, title, uploadedAt, contentHash',
            chunks: '++id, docId, ordinal',
        });
        // v2 adds saved conversations. Dexie carries the existing tables
        // forward untouched, so upgrading never costs anyone their library.
        this.version(2).stores({
            documents: '++id, title, uploadedAt, contentHash',
            chunks: '++id, docId, ordinal',
            conversations: '++id, updatedAt',
            messages: '++id, conversationId, [conversationId+ordinal]',
        });
        // v3 adds how long each import took. Same rule: everything else is
        // carried forward, so nobody loses a document to a version bump.
        this.version(3).stores({
            documents: '++id, title, uploadedAt, contentHash',
            chunks: '++id, docId, ordinal',
            conversations: '++id, updatedAt',
            messages: '++id, conversationId, [conversationId+ordinal]',
            importRuns: '++id, startedAt',
        });
    }
}

/**
 * Which store the app is talking to.
 *
 * Almost always the real one. The exception is the standard timing test,
 * which has to import a fixed set of made-up files and must not put a single
 * one of them in the person's library, or change what their library says
 * about duplicates. It swaps in a throwaway store for the length of the run
 * and swaps back afterwards.
 *
 * Everything else in the app imports `db` once, at module load, and keeps
 * that reference forever — so the swap happens behind a stand-in that passes
 * every call through to whichever store is current. Nothing else had to
 * change, and nothing else can tell the difference.
 */
let current = new ArchivistDb();

export const db: ArchivistDb = new Proxy({} as ArchivistDb, {
    get(_target, property) {
        const value = Reflect.get(current as unknown as object, property) as unknown;
        return typeof value === 'function' ? value.bind(current) : value;
    },
    set(_target, property, value) {
        return Reflect.set(current as unknown as object, property, value);
    },
    has: (_target, property) => property in (current as unknown as object),
});

/** Point the app at a throwaway store, and hand back the one it was using. */
export const useStore = (replacement: ArchivistDb): ArchivistDb => {
    const previous = current;
    current = replacement;
    return previous;
};
