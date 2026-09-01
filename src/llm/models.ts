/**
 * The answering models on offer.
 *
 * Everything here runs in the browser on WebGPU — nothing is called over the
 * network at answer time, and the weights come from the public MLC model
 * repository the first time a model is chosen, then stay in the browser cache.
 *
 * This list is a curated subset of the ~140 builds WebLLM ships. The full set
 * is mostly variants of the same handful of models, and picking one your GPU
 * cannot hold is the easiest way to get a confusing failure, so the choice is
 * narrowed to six that span the useful range. `memoryMb` is the video memory
 * the model needs once loaded, which is also roughly the download.
 */

export interface ModelOption {
    /** WebLLM model id, passed straight to the engine. */
    id: string;
    /** What it is, in plain words. */
    label: string;
    /** Parameter count as the maker states it. */
    size: string;
    /** Video memory required, in megabytes. */
    memoryMb: number;
    /** Who made it, so the provenance is visible rather than implied. */
    maker: string;
    /** Honest one-line trade-off. */
    note: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
    {
        id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
        label: 'SmolLM2 360M',
        size: '360 million',
        memoryMb: 376,
        maker: 'Hugging Face',
        note: 'Smallest and quickest to load. Good enough to summarise a passage, not to reason about one.',
    },
    {
        id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
        label: 'Llama 3.2 1B',
        size: '1 billion',
        memoryMb: 879,
        maker: 'Meta',
        note: 'Fast on almost any machine. Answers stay close to the text, which is mostly what you want here.',
    },
    {
        id: 'Qwen3-1.7B-q4f16_1-MLC',
        label: 'Qwen3 1.7B',
        size: '1.7 billion',
        memoryMb: 2037,
        maker: 'Alibaba',
        note: 'Stronger at following instructions than its size suggests. A good middle option.',
    },
    {
        id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
        label: 'Llama 3.2 3B',
        size: '3 billion',
        memoryMb: 2264,
        maker: 'Meta',
        note: 'The default. Balanced quality against a download most machines will tolerate.',
    },
    {
        id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        label: 'Phi 3.5 Mini',
        size: '3.8 billion',
        memoryMb: 3672,
        maker: 'Microsoft',
        note: 'Better at multi-step reasoning over documents. Slower to load, needs a real GPU.',
    },
    {
        id: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',
        label: 'Mistral 7B',
        size: '7 billion',
        memoryMb: 4573,
        maker: 'Mistral AI',
        note: 'The best answers on offer here, and the heaviest. Wants 6GB or more of video memory.',
    },
];

export const DEFAULT_MODEL_ID = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

export const findModel = (id: string): ModelOption | undefined =>
    MODEL_OPTIONS.find((model) => model.id === id);

/** Human-readable size, e.g. "2.3 GB". */
export const formatMemory = (memoryMb: number): string =>
    memoryMb >= 1024 ? `${(memoryMb / 1024).toFixed(1)} GB` : `${Math.round(memoryMb)} MB`;
