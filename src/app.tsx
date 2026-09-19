import { useEffect, useMemo, useRef, useState } from 'react';
import { AskPanel } from '@/pages/ask-panel';
import { LibraryPanel } from '@/pages/library-panel';
import { OrganizePanel } from '@/pages/organize-panel';
import { ModelStatus } from '@/components/model-status';
import {
    getCurrentModelId,
    getSelectedModelId,
    isEngineLoaded,
    supportsWebGpu,
} from '@/llm/get-engine';
import { findModel } from '@/llm/models';
import { createWorkerClient, type WorkerClient } from '@/embed/worker-client';
import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';

/**
 * The application shell: one bar across the top holding the name, the tabs and
 * the model, then a single full-height region below it.
 *
 * The model used to occupy a large panel at the bottom of every screen — the
 * densest block on the page, for something touched once. It is now a line in
 * the header that states what is answering, and opens the full panel when
 * clicked. Visible, still honest, no longer the loudest thing in the room.
 */

type Tab = 'ask' | 'library' | 'organize';

const TABS: { id: Tab; label: string }[] = [
    { id: 'ask', label: 'Ask' },
    { id: 'library', label: 'Library' },
    { id: 'organize', label: 'Organize' },
];

export const App = (): JSX.Element => {
    const [tab, setTab] = useState<Tab>('ask');
    const [docCount, setDocCount] = useState(0);
    const [modelOpen, setModelOpen] = useState(false);
    // Bumped when the loaded model changes, so panels that name the model
    // re-render rather than showing a stale one.
    const [modelTick, setModelTick] = useState(0);
    const workerRef = useRef<WorkerClient | null>(null);
    const modelRef = useRef<HTMLDivElement | null>(null);

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

    // Close the model panel on an outside click or Escape, the way any
    // popover is expected to behave.
    useEffect(() => {
        if (!modelOpen) return;

        const onPointer = (event: MouseEvent): void => {
            if (!modelRef.current?.contains(event.target as Node)) setModelOpen(false);
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') setModelOpen(false);
        };

        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [modelOpen]);

    const running = getCurrentModelId();
    const runningModel = running ? findModel(running) : undefined;
    const nextModel = findModel(getSelectedModelId());

    const modelLabel = !supportsWebGpu()
        ? 'No WebGPU — search only'
        : isEngineLoaded() && runningModel
          ? runningModel.label
          : (nextModel?.label ?? 'No model');

    return (
        <div className="shell">
            <header className="topbar">
                <span className="wordmark">Archivist</span>

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
                                <span className="muted"> · {docCount}</span>
                            )}
                        </button>
                    ))}
                </nav>

                <div className="model-menu" ref={modelRef}>
                    <button
                        className="model-chip"
                        aria-expanded={modelOpen}
                        onClick={() => setModelOpen((open) => !open)}
                        title="Choose the answering model"
                    >
                        <span
                            className={isEngineLoaded() ? 'status-dot on' : 'status-dot'}
                            aria-hidden="true"
                        />
                        <span className="muted">
                            {isEngineLoaded() ? 'Answering with' : 'Model'}
                        </span>
                        <strong>{modelLabel}</strong>
                        <span className="muted" aria-hidden="true">
                            ⌄
                        </span>
                    </button>

                    {modelOpen && (
                        <div className="model-popover">
                            <ModelStatus
                                onChange={() => {
                                    setModelTick((n) => n + 1);
                                }}
                            />
                        </div>
                    )}
                </div>
            </header>

            <main className="view">
                {/* modelTick is read here only so a model change re-renders the
                    panel, which names the model that will answer. */}
                {tab === 'ask' && (
                    <AskPanel worker={worker} docCount={docCount} modelTick={modelTick} />
                )}
                {tab === 'library' && (
                    <div className="centered">
                        <LibraryPanel worker={worker} onChange={() => void refreshCount()} />
                    </div>
                )}
                {tab === 'organize' && (
                    <div className="centered">
                        <OrganizePanel />
                    </div>
                )}
            </main>
        </div>
    );
};
