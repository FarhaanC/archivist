import { useRef, useState } from 'react';
import { ArchivistDb, useStore } from '@/db/get-db';
import { buildStandardFiles } from '@/dev/standard-files';
import { importFiles, type ImportProgress } from '@/ingestion/import-files';
import { recordRun } from '@/ingestion/import-timing';
import { ImportProgressCard } from '@/components/import-progress';
import { ImportTimings } from '@/components/import-timings';
import { invalidateKeywordIndex } from '@/search/search';
import { createWorkerClient, type WorkerClient } from '@/embed/worker-client';
import type { ImportRunRecord } from '@/db/types';

/**
 * The standard timing test, at #/timing. Nothing in the app links here.
 *
 * It imports the same made-up files every time, through exactly the same
 * import the Library tab uses, so a number from this machine can be set
 * beside a number from another one or from before a change. The files are
 * drawn in the browser and the import goes into a throwaway store that is
 * deleted the moment it finishes, so the person's own library is not touched,
 * not even by the duplicate check.
 */

type State = 'idle' | 'building' | 'importing' | 'done' | 'failed';

export const TimingPage = (): JSX.Element => {
    const [state, setState] = useState<State>('idle');
    const [progress, setProgress] = useState<ImportProgress | null>(null);
    const [lastRun, setLastRun] = useState<ImportRunRecord | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const workerRef = useRef<WorkerClient | null>(null);

    const go = async (): Promise<void> => {
        setProblem(null);
        setState('building');
        const scratch = new ArchivistDb(`archivist-timing-${Date.now()}`);
        let previous: ArchivistDb | null = null;
        try {
            const files = await buildStandardFiles();
            workerRef.current ??= createWorkerClient();
            setState('importing');

            previous = useStore(scratch);
            // The run is not written while the throwaway store is in place —
            // it would be deleted along with it. It is saved below, once the
            // real store is back.
            let run: ImportRunRecord | null = null;
            await importFiles(files, workerRef.current, {
                onProgress: setProgress,
                onRun: (finished) => (run = finished),
                standard: true,
                record: false,
            });
            setProgress(null);

            useStore(previous);
            previous = null;
            await scratch.delete();
            invalidateKeywordIndex();

            if (run) {
                const id = await recordRun(run);
                if (id !== null) (run as ImportRunRecord).id = id;
                setLastRun(run);
            }
            setState('done');
        } catch (error) {
            console.warn('[Timing] The standard test could not finish:', error);
            setProblem(error instanceof Error ? error.message : String(error));
            setState('failed');
        } finally {
            if (previous) useStore(previous);
            setProgress(null);
            await scratch.delete().catch(() => undefined);
        }
    };

    return (
        <div className="shell">
            <header className="topbar">
                <span className="wordmark">Archivist</span>
                <span className="muted small">Standard timing test</span>
            </header>
            <main className="view">
                <div className="centered">
                    <div className="card">
                        <p style={{ marginTop: 0 }}>
                            This reads the same twelve made-up files every time — twelve files,
                            sixteen pages, most of them scans — so the number it gives you can be
                            compared with the last one. Nothing is added to your library.
                        </p>
                        <button
                            className="primary"
                            disabled={state === 'building' || state === 'importing'}
                            onClick={() => void go()}
                        >
                            {state === 'building'
                                ? 'Making the files…'
                                : state === 'importing'
                                  ? 'Reading them…'
                                  : 'Run the standard timing test'}
                        </button>
                    </div>

                    {progress && <ImportProgressCard progress={progress} />}

                    {state === 'failed' && (
                        <div className="card">
                            <p style={{ margin: 0, color: 'var(--warn)' }}>
                                The test could not finish. {problem}
                            </p>
                        </div>
                    )}

                    <ImportTimings run={lastRun} />
                </div>
            </main>
        </div>
    );
};
