import type { MLCEngineInterface } from '@mlc-ai/web-llm';

/**
 * The answering model, running in the browser on WebGPU. Loading it is the
 * single most expensive thing the app does (~1GB on first run, cached after),
 * so the engine is a lazy singleton: nothing downloads until the user actually
 * asks a question rather than just searching.
 */

export const DEFAULT_MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

let enginePromise: Promise<MLCEngineInterface> | null = null;
let engine: MLCEngineInterface | null = null;

export type LoadProgressHandler = (report: { text: string; progress: number }) => void;

const progressHandlers = new Set<LoadProgressHandler>();

export const onEngineProgress = (handler: LoadProgressHandler): (() => void) => {
    progressHandlers.add(handler);
    return () => progressHandlers.delete(handler);
};

/**
 * The engine if it has finished loading, otherwise null.
 *
 * Deliberately synchronous: every caller here is an optional enhancement —
 * query planning, the search coach — that must degrade to plain retrieval
 * rather than block a search behind a gigabyte download.
 */
export const getEngine = (): MLCEngineInterface | null => engine;

export const isEngineLoading = (): boolean => enginePromise !== null && engine === null;
export const isEngineLoaded = (): boolean => engine !== null;

/** Start (or await) the model download. Safe to call repeatedly. */
export const loadEngine = (
    model: string = DEFAULT_MODEL,
): Promise<MLCEngineInterface> => {
    if (!enginePromise) {
        // Imported dynamically: the runtime is several megabytes and most
        // sessions never generate an answer at all.
        enginePromise = import('@mlc-ai/web-llm')
            .then((webllm) =>
                webllm.CreateMLCEngine(model, {
                    initProgressCallback: (report) => {
                        for (const handler of progressHandlers) {
                            handler({ text: report.text, progress: report.progress });
                        }
                    },
                }),
            )
            .then((created) => {
                engine = created;
                return created;
            })
            .catch((error: unknown) => {
                // Let the next attempt retry rather than caching the failure.
                enginePromise = null;
                throw error;
            });
    }
    return enginePromise;
};

/** True when the browser can actually run the engine. */
export const supportsWebGpu = (): boolean =>
    typeof navigator !== 'undefined' && 'gpu' in navigator;
