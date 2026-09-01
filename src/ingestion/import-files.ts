import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import { findExactDuplicate, findNearDuplicate } from '@/ingestion/dedupe';
import { ingestDocument } from '@/ingestion/ingest-document';
import { buildDocProfile, saveDocProfile } from '@/knowledge/doc-profile';
import { summarizeDiff, wordDiff } from '@/knowledge/word-diff';
import { parseFile } from '@/parsers/parse-file';
import { UnsupportedFileError } from '@/parsers/types';
import type { EmbeddingWorker } from '@/lib/types';

/**
 * Import a batch of files, one at a time, reporting the outcome of each.
 *
 * Every file produces a row in the report — imported, duplicate, or failed —
 * because the failure mode that matters here is silent: a user drops 200 files,
 * 30 are scans with no text layer, and they only find out weeks later when a
 * search comes up empty.
 */

export type ImportOutcome =
    | { status: 'imported'; file: string; docId: number; chunkCount?: number }
    | { status: 'near-duplicate'; file: string; docId: number; of: string; diff: string }
    | { status: 'duplicate'; file: string; of: string }
    | { status: 'skipped'; file: string; reason: string }
    | { status: 'failed'; file: string; reason: string };

export interface ImportProgress {
    file: string;
    index: number;
    total: number;
}

export const importFiles = async (
    files: File[],
    worker: EmbeddingWorker,
    onProgress?: (progress: ImportProgress) => void,
): Promise<ImportOutcome[]> => {
    await ensureDbOpen();
    const report: ImportOutcome[] = [];

    for (const [index, file] of files.entries()) {
        onProgress?.({ file: file.name, index, total: files.length });
        try {
            const { text } = await parseFile(file);
            if (!text.trim()) {
                report.push({
                    status: 'skipped',
                    file: file.name,
                    reason: 'No readable text',
                });
                continue;
            }

            const exact = await findExactDuplicate(text);
            if (exact) {
                report.push({ status: 'duplicate', file: file.name, of: exact.title });
                continue;
            }

            const docId = await ingestDocument({
                fileObj: file,
                text,
                workerClient: worker,
                blob: file,
            });

            await saveDocProfile(docId, buildDocProfile(text));

            const near = await findNearDuplicate(text, docId, (t) => worker.getEmbedding(t));
            if (near) {
                const other = await db.documents.get(near.docId);
                const diff = summarizeDiff(wordDiff(other?.fullText ?? '', text));
                await db.documents.update(docId, {
                    similarToDocId: near.docId,
                    diffSummary: diff,
                });
                report.push({
                    status: 'near-duplicate',
                    file: file.name,
                    docId,
                    of: near.title,
                    diff,
                });
                continue;
            }

            report.push({ status: 'imported', file: file.name, docId });
        } catch (error) {
            report.push({
                status: error instanceof UnsupportedFileError ? 'skipped' : 'failed',
                file: file.name,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return report;
};
