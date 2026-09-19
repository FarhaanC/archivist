import { useEffect, useRef, useState } from 'react';
import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import { deleteDocument } from '@/ingestion/ingest-document';
import { importFiles, type ImportOutcome, type ImportProgress } from '@/ingestion/import-files';
import { ImportReport } from '@/components/import-report';
import { explainFileType } from '@/ingestion/explain-problem';
import { ACCEPT_ATTR, collectFilesFromDataTransfer, collectFilesFromInput } from '@/upload/collect-files';
import type { DocumentRecord } from '@/db/types';
import type { WorkerClient } from '@/embed/worker-client';

const formatBytes = (bytes?: number): string => {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
};

/**
 * How full the bar is: the files already finished with, plus however far
 * through the files being read right now. Capped at whole, because a bar that
 * overshoots and a bar that goes backwards both read as something having gone
 * wrong.
 */
const barWidth = (progress: ImportProgress): number => {
    if (progress.total === 0) return 0;
    const reading = progress.inFlight.reduce((sum, file) => sum + file.fraction, 0);
    return Math.min(1, (progress.done + reading) / progress.total);
};

export const LibraryPanel = ({
    worker,
    onChange,
}: {
    worker: WorkerClient;
    onChange: () => void;
}): JSX.Element => {
    const [documents, setDocuments] = useState<DocumentRecord[]>([]);
    const [report, setReport] = useState<ImportOutcome[]>([]);
    const [progress, setProgress] = useState<ImportProgress | null>(null);
    const [dragging, setDragging] = useState(false);
    // The bar is only ever allowed to move forward.
    const furthest = useRef(0);

    const refresh = async (): Promise<void> => {
        await ensureDbOpen();
        setDocuments(await db.documents.orderBy('uploadedAt').reverse().toArray());
        onChange();
    };

    useEffect(() => {
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const run = async (files: File[], skipped: string[]): Promise<void> => {
        if (files.length === 0 && skipped.length === 0) return;
        setReport([]);
        furthest.current = 0;
        const outcomes = await importFiles(files, worker, { onProgress: setProgress });
        setProgress(null);
        setReport([
            ...outcomes,
            ...skipped.map(
                (file): ImportOutcome => ({
                    status: 'skipped',
                    file,
                    problem: explainFileType(file),
                }),
            ),
        ]);
        await refresh();
    };

    if (progress) furthest.current = Math.max(furthest.current, barWidth(progress));

    return (
        <>
            <div
                className={dragging ? 'dropzone over' : 'dropzone'}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void collectFilesFromDataTransfer(event.dataTransfer).then(
                        ({ files, skipped }) => run(files, skipped),
                    );
                }}
            >
                <p style={{ margin: '0 0 10px' }}>Drop files or a folder here</p>
                <label>
                    <input
                        type="file"
                        multiple
                        accept={ACCEPT_ATTR}
                        style={{ display: 'none' }}
                        onChange={(event) => {
                            if (!event.target.files) return;
                            const { files, skipped } = collectFilesFromInput(event.target.files);
                            void run(files, skipped);
                            event.target.value = '';
                        }}
                    />
                    <span className="pill accent" style={{ cursor: 'pointer', padding: '6px 14px' }}>
                        Choose files
                    </span>
                </label>
                <p className="small" style={{ marginBottom: 0, marginTop: 12 }}>
                    PDF, Word, Excel, PowerPoint, text, Markdown and code — and scans or photos of documents
                </p>
            </div>

            {progress && (
                <div className="card">
                    <div className="spread small" style={{ marginBottom: 6 }}>
                        <span>Reading your files</span>
                        <span className="muted">
                            {progress.done} of {progress.total} done
                        </span>
                    </div>
                    {progress.inFlight.map((file) => (
                        <div key={file.file} className="small muted" style={{ marginBottom: 2 }}>
                            {file.file} — {file.detail}
                        </div>
                    ))}
                    {progress.inFlight.length > 0 && (
                        <div className="small muted" style={{ margin: '6px 0' }}>
                            Scans take a few seconds a page.
                        </div>
                    )}
                    <div className="progress">
                        <div
                            style={{ width: `${furthest.current * 100}%` }}
                        />
                    </div>
                </div>
            )}

            <ImportReport report={report} />

            {documents.length > 0 && (
                <div className="card">
                    <ul className="plain">
                        {documents.map((doc) => (
                            <li key={doc.id}>
                                <div className="spread">
                                    <div>
                                        <div>{doc.title}</div>
                                        <div className="small muted">
                                            {formatBytes(doc.byteSize)}
                                            {doc.profile?.wordCount
                                                ? ` · ${doc.profile.wordCount.toLocaleString()} words`
                                                : ''}
                                            {doc.profile?.topics?.length
                                                ? ` · ${doc.profile.topics.slice(0, 5).join(', ')}`
                                                : ''}
                                        </div>
                                        {doc.readAsScan && (
                                            <div className="small muted">
                                                Read from a scan — the odd word may be wrong.
                                            </div>
                                        )}
                                        {doc.diffSummary && (
                                            <div className="small" style={{ color: 'var(--warn)' }}>
                                                Near-duplicate — {doc.diffSummary}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        className="ghost"
                                        onClick={() => {
                                            void deleteDocument(doc.id!).then(refresh);
                                        }}
                                        aria-label={`Remove ${doc.title}`}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </>
    );
};
