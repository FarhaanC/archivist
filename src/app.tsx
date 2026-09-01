import { useEffect, useMemo, useRef, useState } from 'react';
import { AskPanel } from '@/pages/ask-panel';
import { LibraryPanel } from '@/pages/library-panel';
import { OrganizePanel } from '@/pages/organize-panel';
import { ModelStatus } from '@/components/model-status';
import { createWorkerClient, type WorkerClient } from '@/embed/worker-client';
import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';

type Tab = 'ask' | 'library' | 'organize';

const TABS: { id: Tab; label: string }[] = [
    { id: 'ask', label: 'Ask' },
    { id: 'library', label: 'Library' },
    { id: 'organize', label: 'Organize' },
];

export const App = (): JSX.Element => {
    const [tab, setTab] = useState<Tab>('ask');
    const [docCount, setDocCount] = useState(0);
    const workerRef = useRef<WorkerClient | null>(null);

    const worker = useMemo(() => {
        workerRef.current ??= createWorkerClient();
        return workerRef.current;
    }, []);

    const refreshCount = async (): Promise<void> => {
        await ensureDbOpen();
        setDocCount(await db.documents.count());
    };

    useEffect(() => {
        void refreshCount();
    }, []);

    return (
        <div className="shell">
            <header className="masthead">
                <h1 className="wordmark">Archivist</h1>
                <span className="tagline">
                    Ask questions about your own documents. Nothing leaves this device.
                </span>
            </header>

            <nav className="tabs" role="tablist">
                {TABS.map(({ id, label }) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                    >
                        {label}
                        {id === 'library' && docCount > 0 && (
                            <span className="muted small"> · {docCount}</span>
                        )}
                    </button>
                ))}
            </nav>

            {tab === 'ask' && <AskPanel worker={worker} docCount={docCount} />}
            {tab === 'library' && (
                <LibraryPanel worker={worker} onChange={() => void refreshCount()} />
            )}
            {tab === 'organize' && <OrganizePanel />}

            <div className="card" style={{ marginTop: 24 }}>
                <ModelStatus />
            </div>
        </div>
    );
};
