/** The minimal surface the rest of the app needs from the embedding backend. */
export interface EmbeddingWorker {
    getEmbedding: (text: string) => Promise<Float32Array | number[]>;
    getEmbeddings?: (texts: string[]) => Promise<(Float32Array | number[])[]>;
}
