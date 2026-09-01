import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';

/**
 * Duplicate handling for uploads.
 *
 * - EXACT duplicates (same extracted text — format/font differences vanish at
 *   extraction) are detected via a content hash and skipped entirely.
 * - NEAR duplicates (a word or two changed, v1 vs v2) are detected by
 *   comparing document embeddings and FLAGGED, not skipped — a small edit
 *   can be the whole point of the newer file.
 */

/** Normalize so whitespace/formatting differences don't defeat the hash. */
export const normalizeForHash = (text: string): string =>
    text.toLowerCase().replace(/\s+/g, ' ').trim();

export const hashText = async (text: string): Promise<string> => {
    const data = new TextEncoder().encode(normalizeForHash(text));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * Returns the title of an existing document with identical content, or null.
 * Backfills contentHash on older records as it goes (one-time cost each).
 */
export const findExactDuplicate = async (
    text: string
): Promise<{ docId: number; title: string } | null> => {
    await ensureDbOpen();
    const hash = await hashText(text);
    const docs = await db.documents.toArray();
    for (const doc of docs) {
        let docHash = (doc as { contentHash?: string }).contentHash;
        if (!docHash && doc.fullText) {
            docHash = await hashText(doc.fullText);
            if (doc.id) await db.documents.update(doc.id, { contentHash: docHash } as never);
        }
        if (docHash === hash && doc.id) {
            return { docId: doc.id, title: doc.title };
        }
    }
    return null;
};

const cosine = (a: number[], b: number[]): number => {
    let dot = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
    return dot; // vectors are normalized
};

export const NEAR_DUPLICATE_THRESHOLD = 0.95;

/**
 * Find an existing document whose content embedding is nearly identical.
 * Uses a single embedding of the document's head (first ~2000 chars) stored
 * on the record as `docVector`; backfills older records lazily.
 */
export const findNearDuplicate = async (
    text: string,
    newDocId: number,
    getEmbedding: (t: string) => Promise<Float32Array | number[]>
): Promise<{ docId: number; title: string; similarity: number } | null> => {
    await ensureDbOpen();
    const head = normalizeForHash(text).slice(0, 2000);
    if (!head) return null;

    const newVec = Array.from(await getEmbedding(head)) as number[];
    // Persist on the new doc for future comparisons
    await db.documents.update(newDocId, { docVector: newVec } as never);

    const docs = await db.documents.toArray();
    let best: { docId: number; title: string; similarity: number } | null = null;
    for (const doc of docs) {
        if (!doc.id || doc.id === newDocId || !doc.fullText) continue;
        let vec = (doc as { docVector?: number[] }).docVector;
        if (!vec) {
            vec = Array.from(
                await getEmbedding(normalizeForHash(doc.fullText).slice(0, 2000))
            ) as number[];
            await db.documents.update(doc.id, { docVector: vec } as never);
        }
        const sim = cosine(newVec, vec);
        if (sim >= NEAR_DUPLICATE_THRESHOLD && (!best || sim > best.similarity)) {
            best = { docId: doc.id, title: doc.title, similarity: sim };
        }
    }
    return best;
};
