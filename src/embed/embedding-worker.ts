/// <reference lib="webworker" />
import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';

/**
 * Embedding runs in a worker because the first call downloads ~45MB of model
 * weights and then pins a CPU core for the length of a batch. On the main
 * thread that is a frozen UI for the entire ingest of a folder.
 */

// No remote code execution; weights are fetched once and cached by the browser.
env.allowLocalModels = false;

const MODEL = 'Xenova/all-MiniLM-L6-v2';

let extractor: Promise<FeatureExtractionPipeline> | null = null;

const getExtractor = (): Promise<FeatureExtractionPipeline> => {
    if (!extractor) {
        extractor = pipeline('feature-extraction', MODEL, {
            progress_callback: (p: { status?: string; progress?: number }) => {
                if (p.status === 'progress' && typeof p.progress === 'number') {
                    self.postMessage({ type: 'model-progress', progress: p.progress });
                }
            },
        }) as Promise<FeatureExtractionPipeline>;
    }
    return extractor;
};

const embed = async (texts: string[]): Promise<number[][]> => {
    const model = await getExtractor();
    const out = await model(texts, { pooling: 'mean', normalize: true });
    const [rows, dim] = out.dims as [number, number];
    const data = out.data as Float32Array;
    const vectors: number[][] = [];
    for (let r = 0; r < rows; r++) {
        vectors.push(Array.from(data.slice(r * dim, (r + 1) * dim)));
    }
    return vectors;
};

export interface EmbedRequest {
    id: number;
    texts: string[];
}

self.onmessage = async (event: MessageEvent<EmbedRequest>) => {
    const { id, texts } = event.data;
    try {
        const vectors = await embed(texts);
        self.postMessage({ type: 'result', id, vectors });
    } catch (error) {
        self.postMessage({
            type: 'error',
            id,
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
