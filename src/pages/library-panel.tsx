import { useEffect, useState } from 'react';
import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import { deleteDocument } from '@/ingestion/ingest-document';
import { importFiles, type ImportOutcome, type ImportProgress } from '@/ingestion/import-files';
import { ImportReport } from '@/components/import-report';
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
        const outcomes = await importFiles(files, worker, setProgress);
        setProgress(null);
        setReport([
            ...outcomes,
            ...skipped.map(
                (file): ImportOutcome => ({
                    status: 'skipped',
                    file,
                    reason: 'Unsupported file type',
                }),
            ),
        ]);
        await refresh();
    };

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
                    PDF, Word, Excel, PowerPoint, text, Markdown and code
                </p>
            </div>

            {progress && (
                <div className="card">
                    <div className="spread small" style={{ marginBottom: 6 }}>
                        <span>Reading {progress.file}</span>
                        <span className="muted">
                            {progress.index + 1} / {progress.total}
                        </span>
                    </div>
                    <div className="progress">
                        <div style={{ width: `${((progress.index + 1) / progress.total) * 100}%` }} />
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
