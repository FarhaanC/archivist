import { useEffect, useState } from 'react';
import { isEngineLoaded, loadEngine, onEngineProgress, supportsWebGpu } from '@/llm/get-engine';

/**
 * The answering model is a ~1GB download, so it is opt-in and its state is
 * always visible. Search works without it; only generated answers need it.
 */
export const ModelStatus = (): JSX.Element => {
    const [loaded, setLoaded] = useState(isEngineLoaded());
    const [progress, setProgress] = useState<{ text: string; progress: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => onEngineProgress(setProgress), []);

    if (!supportsWebGpu()) {
        return (
            <p className="small muted">
                This browser has no WebGPU, so answers can’t be generated here — search
                and the library still work. Chrome or Edge 121+ will run the model.
            </p>
        );
    }

    if (loaded) {
        return <span className="pill good">Answering model ready</span>;
    }

    return (
        <div className="stack">
            <div className="row">
                <button
                    onClick={() => {
                        setError(null);
                        loadEngine()
                            .then(() => setLoaded(true))
                            .catch((e: unknown) =>
                                setError(e instanceof Error ? e.message : String(e)),
                            );
                    }}
                    disabled={progress !== null && !error}
                >
                    {progress && !error ? 'Loading model…' : 'Load answering model'}
                </button>
                <span className="small muted">
                    ~1GB, downloaded once and cached. Search works without it.
                </span>
            </div>
            {progress && !error && (
                <>
                    <div className="progress">
                        <div style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                    </div>
                    <span className="small muted mono">{progress.text}</span>
                </>
            )}
            {error && <span className="small" style={{ color: 'var(--warn)' }}>{error}</span>}
        </div>
    );
};
