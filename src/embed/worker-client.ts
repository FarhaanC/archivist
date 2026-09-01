import type { EmbeddingWorker } from '@/lib/types';

/**
 * Promise-shaped wrapper around the embedding worker. Requests are correlated
 * by id so callers can fire concurrently, and batched calls go over the wire
 * as one message — embedding 200 chunks one postMessage at a time is dominated
 * by the round trips, not the model.
 */

type Pending = {
    resolve: (vectors: number[][]) => void;
    reject: (error: Error) => void;
};

export interface WorkerClient extends EmbeddingWorker {
    getEmbeddings: (texts: string[]) => Promise<number[][]>;
    onModelProgress: (handler: (progress: number) => void) => () => void;
    terminate: () => void;
}

export const createWorkerClient = (): WorkerClient => {
    const worker = new Worker(new URL('./embedding-worker.ts', import.meta.url), {
        type: 'module',
    });

    const pending = new Map<number, Pending>();
    const progressHandlers = new Set<(progress: number) => void>();
    let nextId = 0;

    worker.onmessage = (event) => {
        const data = event.data as
            | { type: 'result'; id: number; vectors: number[][] }
            | { type: 'error'; id: number; message: string }
            | { type: 'model-progress'; progress: number };

        if (data.type === 'model-progress') {
            for (const handler of progressHandlers) handler(data.progress);
            return;
        }
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        if (data.type === 'result') entry.resolve(data.vectors);
        else entry.reject(new Error(data.message));
    };

    const getEmbeddings = (texts: string[]): Promise<number[][]> => {
        if (texts.length === 0) return Promise.resolve([]);
        const id = nextId++;
        return new Promise<number[][]>((resolve, reject) => {
            pending.set(id, { resolve, reject });
            worker.postMessage({ id, texts });
        });
    };

    return {
        getEmbeddings,
        getEmbedding: async (text: string) => (await getEmbeddings([text]))[0]!,
        onModelProgress: (handler) => {
            progressHandlers.add(handler);
            return () => progressHandlers.delete(handler);
        },
        terminate: () => worker.terminate(),
    };
};
