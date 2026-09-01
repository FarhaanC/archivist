import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import { chunkText } from '@/ingestion/chunk';
import { hashText } from '@/ingestion/dedupe';
import { invalidateKeywordIndex } from '@/search/search';
import type { EmbeddingWorker } from '@/lib/types';

export interface IngestArgs {
    /** The source file. Only `name` is required, so ingestion is testable
     *  without constructing a real File. */
    fileObj: { name: string; type?: string; size?: number };
    text: string;
    workerClient: EmbeddingWorker;
    blob?: Blob;
    onProgress?: (done: number, total: number) => void;
}

/**
 * Write one document and its embedded chunks to the store, returning the new
 * document id. The document row is written first so that a failure part-way
 * through embedding leaves a visible, re-ingestable record rather than nothing.
 */
export const ingestDocument = async ({
    fileObj,
    text,
    workerClient,
    blob,
    onProgress,
}: IngestArgs): Promise<number> => {
    await ensureDbOpen();

    const docId = (await db.documents.add({
        title: fileObj.name,
        fullText: text,
        blob,
        mimeType: fileObj.type,
        byteSize: fileObj.size,
        uploadedAt: Date.now(),
        contentHash: await hashText(text),
    })) as number;

    const chunks = chunkText(text);
    if (chunks.length === 0) {
        invalidateKeywordIndex();
        return docId;
    }

    const batchSize = 32;
    for (let start = 0; start < chunks.length; start += batchSize) {
        const batch = chunks.slice(start, start + batchSize);
        const vectors = workerClient.getEmbeddings
            ? await workerClient.getEmbeddings(batch)
            : await Promise.all(batch.map((t) => workerClient.getEmbedding(t)));

        await db.chunks.bulkAdd(
            batch.map((chunkBody, offset) => ({
                docId,
                ordinal: start + offset,
                text: chunkBody,
                vector: Array.from(vectors[offset] ?? []),
            })),
        );
        onProgress?.(Math.min(start + batchSize, chunks.length), chunks.length);
    }

    invalidateKeywordIndex();
    return docId;
};

/** Remove a document and everything derived from it. */
export const deleteDocument = async (docId: number): Promise<void> => {
    await ensureDbOpen();
    await db.chunks.where('docId').equals(docId).delete();
    await db.documents.delete(docId);
    invalidateKeywordIndex();
};
