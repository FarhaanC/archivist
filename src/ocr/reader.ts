import { createWorker, type Worker } from 'tesseract.js';

/**
 * The scan reader: turns a picture of a page into words.
 *
 * Behind an interface on purpose. Today it is Tesseract, which runs in the
 * browser, needs no graphics card and reads a clean scan well. A smarter
 * reader — one that copes with photos taken at an angle, tables, and pages
 * mixing Arabic with English — would slot in here without touching the
 * import pipeline, the progress display or the report.
 *
 * Reading is the slowest thing the app does, and it used to happen one page
 * at a time on a single core while the rest of the machine sat idle. So the
 * reader is now a small pool: several copies of the engine, fed from one
 * queue. Everything upstream still sees a single `ScanReader` and hands it
 * one page at a time; the pool decides how many of those pages are actually
 * read at once.
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
    /** Free the workers. Safe to call when nothing was ever loaded, and safe
     *  to call twice. */
    close(): Promise<void>;
}

/**
 * How many copies of the engine to run at once.
 *
 * One core is left for the screen and for the part that works out what each
 * document means, both of which have to stay responsive while a folder is
 * being read. The ceiling of four is about memory, not speed: every copy
 * holds the engine and both languages, which is well over a hundred
 * megabytes each, and a laptop runs out of memory long before it runs out of
 * cores. Browsers that hide the core count are treated as small machines.
 */
export const workerCountFor = (cores?: number): number => {
    const reported =
        cores ??
        (typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency) ??
        2;
    const usable = Number.isFinite(reported) && reported > 0 ? Math.floor(reported) : 2;
    return Math.min(4, Math.max(1, usable - 1));
};

/** One copy of the engine, as the pool needs to see it. */
export interface PooledWorker {
    recognize(image: ScanSource): Promise<ScanResult>;
    terminate(): Promise<void>;
}

export interface PoolOptions {
    /**
     * Start one copy of the engine. Whatever it reports while reading should
     * be passed to `onProgress` as a number from 0 to 1; the pool makes sure
     * that reaches whoever asked for the page being read at the time.
     */
    start: (onProgress: (fraction: number) => void) => Promise<PooledWorker>;
    maxWorkers?: number;
}

interface QueuedPage {
    image: ScanSource;
    onProgress?: (fraction: number) => void;
    resolve: (result: ScanResult) => void;
    reject: (error: unknown) => void;
}

/** One copy of the engine plus the bookkeeping the pool keeps about it. */
interface Lane {
    worker: PooledWorker | null;
    starting: Promise<PooledWorker> | null;
    /** Who wants the progress this copy is currently reporting. */
    listener: ((fraction: number) => void) | null;
    busy: boolean;
}

/** After this many failures to start a copy of the engine, stop trying: the
 *  engine files are missing or the browser will not allow them, and a fresh
 *  attempt per page would only make the person wait longer for the same
 *  answer. */
const MAX_START_FAILURES = 2;

class ReaderClosedError extends Error {
    constructor() {
        super('The scan reader was closed');
        this.name = 'ReaderClosedError';
    }
}

/**
 * The pool itself, with starting a copy of the engine left to the caller so
 * the queueing, the progress routing and the failure handling can be tested
 * without loading a real engine.
 */
export const createReaderPool = ({ start, maxWorkers = workerCountFor() }: PoolOptions): ScanReader => {
    const cap = Math.max(1, Math.floor(maxWorkers));
    const queue: QueuedPage[] = [];
    const lanes: Lane[] = [];
    let startFailures = 0;
    let lastStartError: unknown = null;
    let closed = false;

    const newLane = (): Lane => {
        const lane: Lane = { worker: null, starting: null, listener: null, busy: false };
        lanes.push(lane);
        return lane;
    };

    const retire = (lane: Lane): void => {
        const at = lanes.indexOf(lane);
        if (at >= 0) lanes.splice(at, 1);
        void lane.worker?.terminate().catch(() => undefined);
    };

    /**
     * Hand waiting pages to copies of the engine that are free, and start
     * another copy only when there is still a page waiting for it. Starting
     * every copy up front would cost a few seconds before the first page is
     * read, which is the wrong trade for someone adding a single scan.
     */
    const dispatch = (): void => {
        if (closed) return;
        while (queue.length > 0) {
            const free = lanes.find((lane) => !lane.busy);
            if (free) {
                void run(free, queue.shift() as QueuedPage);
                continue;
            }
            if (startFailures >= MAX_START_FAILURES) {
                // No copy of the engine can be started, so nothing that is
                // waiting will ever be read. Say so now rather than leaving
                // the import hanging on a queue that cannot move.
                const waiting = queue.splice(0, queue.length);
                for (const page of waiting) page.reject(lastStartError);
                return;
            }
            if (lanes.length >= cap) return;
            void run(newLane(), queue.shift() as QueuedPage);
        }
    };

    const run = async (lane: Lane, page: QueuedPage): Promise<void> => {
        lane.busy = true;
        try {
            if (!lane.worker) {
                lane.starting ??= start((fraction) => lane.listener?.(fraction));
                lane.worker = await lane.starting;
                startFailures = 0;
            }
            lane.listener = page.onProgress ?? null;
            page.resolve(await lane.worker.recognize(page.image));
        } catch (error) {
            // A copy that never started is a broken copy: drop it, so the
            // next page tries a fresh one rather than waiting on a ghost. A
            // page that failed to read, on the other hand, is usually a
            // damaged picture — the engine is fine and keeps the rest of the
            // batch moving.
            if (!lane.worker) {
                lane.starting = null;
                startFailures += 1;
                lastStartError = error;
                retire(lane);
            }
            page.reject(error);
        } finally {
            lane.listener = null;
            lane.busy = false;
            dispatch();
        }
    };

    return {
        readPage(image, onProgress) {
            if (closed) return Promise.reject(new ReaderClosedError());
            return new Promise<ScanResult>((resolve, reject) => {
                queue.push({ image, onProgress, resolve, reject });
                dispatch();
            });
        },
        async close() {
            if (closed) return;
            closed = true;
            const waiting = queue.splice(0, queue.length);
            for (const page of waiting) page.reject(new ReaderClosedError());

            const going = lanes.splice(0, lanes.length);
            await Promise.all(
                going.map(async (lane) => {
                    // A copy that is still starting has to be waited for
                    // before it can be stopped, or it outlives the import.
                    const worker = lane.worker ?? (await lane.starting?.catch(() => null)) ?? null;
                    await worker?.terminate().catch(() => undefined);
                }),
            );
        },
    };
};

/**
 * The real thing: a pool of Tesseract workers reading from the app's own
 * copy of the engine and language files.
 *
 * English and Arabic together by default, because the documents this app was
 * built for — a UAE identity card, a driving licence, a visa page — carry
 * both on the same page. Tesseract takes several languages joined with "+"
 * and decides per word. The parameter stays so a caller can narrow it.
 */
export const createTesseractReader = (language = 'eng+ara', maxWorkers?: number): ScanReader =>
    createReaderPool({
        maxWorkers: maxWorkers ?? workerCountFor(),
        start: async (onProgress) => {
            // Where the engine and language files are served from — the app's
            // own origin, copied there by scripts/prepare-ocr.ts. Read here
            // rather than at the top of the file so that nothing about the
            // build environment is needed until a scan actually turns up.
            const base = `${import.meta.env.BASE_URL}ocr`;
            const worker: Worker = await createWorker(language, undefined, {
                workerPath: `${base}/worker.min.js`,
                corePath: base,
                langPath: base,
                gzip: true,
                logger: (message: { status: string; progress: number }) => {
                    if (message.status === 'recognizing text') onProgress(message.progress);
                },
                // Without this Tesseract rethrows a failed page inside its own
                // message handler, where nothing can catch it. The page's own
                // promise already carries the failure to the import report.
                errorHandler: (error: unknown) => {
                    console.warn('[Scan reader] A page could not be read:', error);
                },
            });
            return {
                async recognize(image) {
                    const { data } = await worker.recognize(image);
                    return { text: data.text, confidence: data.confidence };
                },
                async terminate() {
                    await worker.terminate();
                },
            };
        },
    });
