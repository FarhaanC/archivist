import { useEffect, useState } from 'react';
import {
    getCurrentModelId,
    getSelectedModelId,
    isEngineLoaded,
    loadEngine,
    onEngineProgress,
    setSelectedModelId,
    supportsWebGpu,
    unloadEngine,
} from '@/llm/get-engine';
import { MODEL_OPTIONS, findModel, formatMemory } from '@/llm/models';

/**
 * The answering model: which one, how big, where it came from, and whether it
 * is running. All of it stated outright rather than left to be inferred — an
 * app that claims to run entirely on your machine has to be able to tell you
 * exactly what it is running.
 */
export const ModelStatus = ({
    onChange,
}: {
    onChange?: (modelId: string | null) => void;
} = {}): JSX.Element => {
    const [loaded, setLoaded] = useState(isEngineLoaded());
    const [selected, setSelected] = useState(getSelectedModelId());
    const [progress, setProgress] = useState<{ text: string; progress: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => onEngineProgress(setProgress), []);

    const current = getCurrentModelId();
    const currentModel = current ? findModel(current) : undefined;
    const selectedModel = findModel(selected);

    if (!supportsWebGpu()) {
        return (
            <p className="small muted">
                This browser has no WebGPU, so answers can’t be generated here — search
                and the library still work. Chrome or Edge 121+ will run the model.
            </p>
        );
    }

    const load = (modelId: string): void => {
        setError(null);
        setProgress(null);
        loadEngine(modelId)
            .then(() => {
                setLoaded(true);
                onChange?.(getCurrentModelId());
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    };

    const busy = progress !== null && !error && !loaded;

    return (
        <div className="stack">
            <div className="spread">
                <div>
                    <strong className="small">Answering model</strong>
                    <div className="small muted">
                        {loaded && currentModel ? (
                            <>
                                Running <strong>{currentModel.label}</strong> ·{' '}
                                {currentModel.size} parameters · {currentModel.maker} ·{' '}
                                {formatMemory(currentModel.memoryMb)} in memory
                            </>
                        ) : (
                            'Nothing loaded. Search works without it; written answers do not.'
                        )}
                    </div>
                </div>
                {loaded && <span className="pill good">Ready</span>}
            </div>

            <span className="field-label" id="model-picker-label">
                Choose a model
            </span>

            <div className="field-row">
                <select
                    aria-labelledby="model-picker-label"
                    value={selected}
                    disabled={busy}
                    onChange={(event) => {
                        const id = event.target.value;
                        setSelected(id);
                        setSelectedModelId(id);
                    }}
                >
                    {MODEL_OPTIONS.map((model) => (
                        <option key={model.id} value={model.id}>
                            {model.label} — {formatMemory(model.memoryMb)} — {model.maker}
                        </option>
                    ))}
                </select>

                {/* Only offered when it would do something: a button that says
                    "Loaded" and cannot be pressed is just noise. */}
                {current !== selected && (
                    <button className="primary" onClick={() => load(selected)} disabled={busy}>
                        {busy
                            ? 'Loading…'
                            : loaded
                              ? `Switch to ${selectedModel?.label ?? 'this model'}`
                              : `Load ${selectedModel?.label ?? 'model'}`}
                    </button>
                )}

                {loaded && (
                    <button
                        onClick={() => {
                            void unloadEngine().then(() => {
                                setLoaded(false);
                                onChange?.(null);
                            });
                        }}
                        disabled={busy}
                    >
                        Unload
                    </button>
                )}
            </div>

            {selectedModel && <p className="small muted" style={{ margin: 0 }}>{selectedModel.note}</p>}

            {busy && progress && (
                <>
                    <div className="progress">
                        <div style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                    </div>
                    <span className="small muted mono">{progress.text}</span>
                </>
            )}

            {error && (
                <span className="small" style={{ color: 'var(--warn)' }}>
                    {error}
                </span>
            )}

            <p className="footnote">
                Downloaded once from the public MLC model repository, then cached in this
                browser. Your documents and questions never leave the device.
            </p>
        </div>
    );
};
