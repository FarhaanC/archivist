import { createWorker, type Worker } from 'tesseract.js';

/**
 * The scan reader: turns a picture of a page into words.
 *
 * Behind an interface on purpose. Today it is Tesseract, which runs in the
 * browser, needs no graphics card and reads a clean scan well. A smarter
 * reader — one that copes with photos taken at an angle, tables, and pages
 * mixing Arabic with English — would slot in here without touching the
 * import pipeline, the progress display or the report.
 */

export interface ScanResult {
    text: string;
    /** 0–100. Tesseract's own estimate of how sure it is, averaged over the
     *  page. Below ~60 the text is usually too garbled to be worth keeping. */
    confidence: number;
}

/** Anything Tesseract accepts: a canvas, an image element, a File or Blob. */
export type ScanSource = HTMLCanvasElement | HTMLImageElement | Blob;

export interface ScanReader {
    /** Read one page. `onProgress` is 0–1 within this page. */
    readPage(image: ScanSource, onProgress?: (fraction: number) => void): Promise<ScanResult>;
    /** Free the worker. Safe to call when nothing was ever loaded. */
    close(): Promise<void>;
}

/** Where the engine and language files are served from — the app's own
 *  origin, copied there by scripts/prepare-ocr.ts. */
const OCR_BASE = `${import.meta.env.BASE_URL}ocr`;

/**
 * Lazily-created Tesseract worker. Creating one costs a few seconds (the
 * engine and language data load, ~7 MB the first time, cached after), so it
 * is created on the first scan and reused for the rest of the import.
 */
export const createTesseractReader = (language = 'eng'): ScanReader => {
    let workerPromise: Promise<Worker> | null = null;
    let progressListener: ((fraction: number) => void) | null = null;

    const worker = (): Promise<Worker> => {
        workerPromise ??= createWorker(language, undefined, {
            workerPath: `${OCR_BASE}/worker.min.js`,
            corePath: OCR_BASE,
            langPath: OCR_BASE,
            gzip: true,
            logger: (message: { status: string; progress: number }) => {
                if (message.status === 'recognizing text') progressListener?.(message.progress);
            },
        });
        return workerPromise;
    };

    return {
        async readPage(image, onProgress) {
            const w = await worker();
            progressListener = onProgress ?? null;
            try {
                const { data } = await w.recognize(image);
                return { text: data.text, confidence: data.confidence };
            } finally {
                progressListener = null;
            }
        },
        async close() {
            if (!workerPromise) return;
            const w = await workerPromise;
            workerPromise = null;
            await w.terminate();
        },
    };
};
