import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import { findExactDuplicate, findNearDuplicate } from '@/ingestion/dedupe';
import { ingestDocument } from '@/ingestion/ingest-document';
import { buildDocProfile, saveDocProfile } from '@/knowledge/doc-profile';
import { describeChanges, summarizeDiff, wordDiff } from '@/knowledge/word-diff';
import { explainEmpty, explainError } from '@/ingestion/explain-problem';
import { mapWithLimit } from '@/lib/map-with-limit';
import { createTesseractReader, workerCountFor } from '@/ocr/reader';
import { parseFile } from '@/parsers/parse-file';
import { UnsupportedFileError } from '@/parsers/types';
import type { ImportProblem } from '@/ingestion/explain-problem';
import type { PlainDiff } from '@/knowledge/word-diff';
import type { EmbeddingWorker } from '@/lib/types';
import type { ScanReader } from '@/ocr/reader';
import type { ParseResult } from '@/parsers/types';

/**
 * Import a batch of files, reporting the outcome of each.
 *
 * Every file produces a row in the report — imported, duplicate, or failed —
 * because the failure mode that matters here is silent: a user drops 200 files,
 * 30 are scans with no text layer, and they only find out weeks later when a
 * search comes up empty.
 *
 * The work happens in two stages, for a reason worth spelling out. Reading a
 * file is slow and self-contained, so several files are read at once. Saving
 * one is quick but not self-contained: telling whether a file is already in
 * the library means looking at what is already there, and two copies of the
 * same document dropped together have to be settled one after the other or
 * they would each decide the other was not there yet. So reading runs several
 * abreast and saving runs strictly in the order the files were dropped, which
 * is also the order the report lists them in.
 */

export type ImportOutcome =
    | {
          status: 'imported';
          file: string;
          docId: number;
          chunkCount?: number;
          /** The words were read off a picture of the page, so a few may be wrong. */
          readAsScan?: boolean;
      }
    | {
          status: 'near-duplicate';
          file: string;
          docId: number;
          of: string;
          /** One-line form, also stored on the document. */
          diff: string;
          /** The same differences as separate plain sentences, for the report. */
          changes: PlainDiff;
      }
    | { status: 'duplicate'; file: string; of: string }
    /** Never reached a parser: the file type isn't one Archivist reads. */
    | { status: 'skipped'; file: string; problem: ImportProblem }
    /** Right type, but reading it failed — a scan, a locked PDF, a broken file. */
    | { status: 'failed'; file: string; problem: ImportProblem };

/** One file that is being read right now. */
export interface ImportInFlight {
    file: string;
    /** What is happening to this file, when it is slow enough to need saying
     *  — "page 3 of 7". Files that read instantly never get one. */
    detail?: string;
    /** 0–1 within this file. */
    fraction: number;
}

export interface ImportProgress {
    /** Files completely finished with — saved, set aside as a copy, or
     *  reported as a problem. */
    done: number;
    total: number;
    /** The slow files currently being read, at most one line each. */
    inFlight: ImportInFlight[];
}

export interface ImportOptions {
    onProgress?: (progress: ImportProgress) => void;
    /** Supplied by tests; the app creates a Tesseract reader per batch. */
    reader?: ScanReader;
    /** How many files to read at once. Defaults to the number of copies of
     *  the scan reader's engine — reading more than that at a time would
     *  only queue them up behind each other. */
    readLimit?: number;
}

/** Everything that came back from reading one file, kept until its turn to
 *  be saved comes round. */
type ReadResult = { ok: true; value: ParseResult } | { ok: false; error: unknown };

export const importFiles = async (
    files: File[],
    worker: EmbeddingWorker,
    options: ImportOptions | ((progress: ImportProgress) => void) = {},
): Promise<ImportOutcome[]> => {
    const {
        onProgress,
        reader: suppliedReader,
        readLimit,
    } = typeof options === 'function' ? ({ onProgress: options } as ImportOptions) : options;
    await ensureDbOpen();
    const total = files.length;
    const report: ImportOutcome[] = [];

    // One reader for the whole batch: starting a copy of the engine costs a
    // few seconds, and a folder of scans would otherwise pay that per file.
    // It starts copies only when scans actually turn up, so a batch with no
    // scans never loads it at all.
    const reader = suppliedReader ?? createTesseractReader();

    const inFlight = new Map<number, ImportInFlight>();
    let done = 0;
    const notify = (): void =>
        onProgress?.({
            done,
            total,
            inFlight: [...inFlight.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, entry]) => entry),
        });

    notify();

    const results: (ReadResult | undefined)[] = new Array(total);

    // Saving, one file at a time, in the order the files were dropped. It
    // starts as soon as the first file has been read and keeps up with the
    // reading from there; a slow scan early in the list holds up the saving
    // of the files behind it, which is the price of keeping the report in
    // the order the person expects.
    let cursor = 0;
    let saving: Promise<void> = Promise.resolve();

    const saveOne = async (index: number, result: ReadResult): Promise<void> => {
        const file = files[index] as File;
        try {
            if (!result.ok) throw result.error;
            const { text, readAsScan } = result.value;

            if (!text.trim()) {
                report.push({ status: 'failed', file: file.name, problem: explainEmpty() });
                return;
            }

            const exact = await findExactDuplicate(text);
            if (exact) {
                report.push({ status: 'duplicate', file: file.name, of: exact.title });
                return;
            }

            const docId = await ingestDocument({
                fileObj: file,
                text,
                workerClient: worker,
                blob: file,
                readAsScan,
            });

            await saveDocProfile(docId, buildDocProfile(text));

            const near = await findNearDuplicate(text, docId, (t) => worker.getEmbedding(t));
            if (near) {
                const other = await db.documents.get(near.docId);
                const changes = wordDiff(other?.fullText ?? '', text);
                const diff = summarizeDiff(changes);
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
                    changes: describeChanges(changes),
                });
                return;
            }

            report.push({ status: 'imported', file: file.name, docId, readAsScan });
        } catch (error) {
            console.warn(`[Import] Could not read ${file.name}:`, error);
            report.push({
                status: error instanceof UnsupportedFileError ? 'skipped' : 'failed',
                file: file.name,
                problem: explainError(file.name, error),
            });
        } finally {
            done += 1;
            notify();
        }
    };

    const pumpSaving = (): void => {
        saving = saving.then(async () => {
            while (cursor < total) {
                const result = results[cursor];
                if (!result) return;
                const index = cursor;
                cursor += 1;
                await saveOne(index, result);
            }
        });
    };

    try {
        const atOnce = Math.max(1, readLimit ?? workerCountFor());
        await mapWithLimit(files, atOnce, async (file, index) => {
            try {
                results[index] = {
                    ok: true,
                    value: await parseFile(file, {
                        reader,
                        onScanProgress: ({ page, pageCount, fraction }) => {
                            inFlight.set(index, {
                                file: file.name,
                                detail:
                                    pageCount > 1
                                        ? `page ${page} of ${pageCount}`
                                        : 'reading it as a scan',
                                fraction,
                            });
                            notify();
                        },
                    }),
                };
            } catch (error) {
                results[index] = { ok: false, error };
            } finally {
                // Only slow files ever appeared here; the rest were never
                // shown, because a line that flashes up and vanishes is
                // harder to read than no line at all.
                inFlight.delete(index);
                pumpSaving();
                notify();
            }
        });

        pumpSaving();
        await saving;
    } finally {
        if (!suppliedReader) await reader.close();
    }

    return report;
};
