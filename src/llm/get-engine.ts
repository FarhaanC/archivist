import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { DEFAULT_MODEL_ID, findModel } from '@/llm/models';

/**
 * The answering model, running in the browser on WebGPU. Loading it is the
 * single most expensive thing the app does (hundreds of megabytes to several
 * gigabytes on first run, cached after), so the engine is a lazy singleton:
 * nothing downloads until the user actually asks for it rather than just
 * searching.
 *
 * Which model is loaded is never implicit. `getCurrentModelId` is what the UI
 * reports, and the user's choice is remembered between visits.
 */

export const DEFAULT_MODEL = DEFAULT_MODEL_ID;

const STORAGE_KEY = 'archivist.model';

let enginePromise: Promise<MLCEngineInterface> | null = null;
let engine: MLCEngineInterface | null = null;
/** The model the loaded engine is actually running. */
let currentModelId: string | null = null;
/** The model that will be loaded next, chosen by the user. */
let selectedModelId: string = DEFAULT_MODEL_ID;

// localStorage is unavailable in a few contexts (private windows, workers,
// tests). A missing preference is not an error; it just means the default.
try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored && findModel(stored)) selectedModelId = stored;
} catch {
    /* keep the default */
}

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
 * rather than block a search behind a multi-gigabyte download.
 */
export const getEngine = (): MLCEngineInterface | null => engine;

export const isEngineLoading = (): boolean => enginePromise !== null && engine === null;
export const isEngineLoaded = (): boolean => engine !== null;

/** The model currently answering, or null when nothing is loaded. */
export const getCurrentModelId = (): string | null => currentModelId;

/** The model that will be used on the next load. */
export const getSelectedModelId = (): string => selectedModelId;

/** Choose the model to load. Takes effect on the next `loadEngine` call. */
export const setSelectedModelId = (id: string): void => {
    if (!findModel(id)) return;
    selectedModelId = id;
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, id);
    } catch {
        /* the preference simply will not persist */
    }
};

/** Release the loaded model, freeing its video memory. */
export const unloadEngine = async (): Promise<void> => {
    const loaded = engine;
    engine = null;
    enginePromise = null;
    currentModelId = null;
    if (loaded) await loaded.unload();
};

/**
 * Start (or await) the model download. Safe to call repeatedly.
 * Passing a different model than the one loaded swaps it, because two
 * multi-gigabyte models will not sit in video memory together.
 */
export const loadEngine = async (
    model: string = selectedModelId,
): Promise<MLCEngineInterface> => {
    if (engine && currentModelId === model) return engine;
    if (engine && currentModelId !== model) await unloadEngine();

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
                currentModelId = model;
                return created;
            })
            .catch((error: unknown) => {
                // Let the next attempt retry rather than caching the failure.
                enginePromise = null;
                currentModelId = null;
                throw error;
            });
    }
    return enginePromise;
};

/** True when the browser can actually run the engine. */
export const supportsWebGpu = (): boolean =>
    typeof navigator !== 'undefined' && 'gpu' in navigator;
