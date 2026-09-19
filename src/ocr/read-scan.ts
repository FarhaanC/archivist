import type { PDFDocumentProxy } from 'pdfjs-dist';
import { workerCountFor } from '@/ocr/reader';
import type { ScanReader, ScanSource } from '@/ocr/reader';

/**
 * Reading a scanned document: draw each page as a picture, hand the picture
 * to the reader, keep what comes back.
 *
 * The reader is the slow part — a few seconds a page on an ordinary laptop —
 * so every page reports progress, and the caller shows "Reading page 3 of 7"
 * rather than a bar that sits still.
 *
 * Two things keep that wait as short as it honestly can be. Pages are drawn
 * at the size the reader actually reads best at, rather than always at double
 * size, so a scan that is already sharp is not blown up into a picture that
 * takes twice as long to read for no gain. And pages are drawn ahead of the
 * reader, so a reader with several copies of the engine has something for
 * each of them; drawing itself has to stay on the screen's own thread, but
 * waiting for the words does not.
 */

export interface ScanProgress {
    /** The page being waited on: one past the last page finished. */
    page: number;
    pageCount: number;
    /** 0–1 across the whole document, not just this page. */
    fraction: number;
}

export interface ScanOutcome {
    text: string;
    /** Average of the per-page confidences, 0–100. */
    confidence: number;
    pageCount: number;
}

/**
 * The longer side a page should land on, in dots, before it is read.
 *
 * About 300 dots per inch for a sheet of A4, which is where this reader is at
 * its best. Below it small type breaks up; above it the picture gets bigger
 * and slower with nothing to show for it.
 */
const TARGET_LONG_SIDE = 2200;

/** Photos are allowed a little more, because a phone is usually further from
 *  the page than a scanner is and the writing lands smaller in the frame. */
const PHOTO_MAX_LONG_SIDE = 2400;

/** Pages whose confidence is below this are too garbled to index: they would
 *  match nothing and pollute the near-duplicate check. */
export const MIN_PAGE_CONFIDENCE = 40;

/**
 * How much to magnify a PDF page before reading it, given the size the page
 * says it is.
 *
 * Never below one. A PDF page's stated size is its size on paper, not the
 * sharpness of the picture inside it: a page that calls itself A4 may hold a
 * very detailed photograph, and drawing it smaller than its stated size
 * throws that detail away for good.
 */
export const renderScaleFor = (width: number, height: number): number => {
    const longest = Math.max(width, height);
    if (!Number.isFinite(longest) || longest <= 0) return 1;
    return Math.min(2, Math.max(1, TARGET_LONG_SIDE / longest));
};

/**
 * How much to shrink a photo before reading it. Never above one: a small
 * picture blown up gains no detail, only time.
 */
export const photoScaleFor = (width: number, height: number): number => {
    const longest = Math.max(width, height);
    if (!Number.isFinite(longest) || longest <= 0) return 1;
    return Math.min(1, PHOTO_MAX_LONG_SIDE / longest);
};

/**
 * Tidy what the reader gives back. Tesseract preserves the page's line
 * breaks, which is right for a poem and wrong for a contract: a paragraph
 * arrives as eight short lines that the chunker would happily cut between.
 * Lines are joined unless the break looks intentional (a blank line, a line
 * ending in punctuation, or a line that starts a list item).
 */
export const cleanScanText = (raw: string): string => {
    const paragraphs = raw
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .split(/\n{2,}/)
        .map((paragraph) => {
            const lines = paragraph
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
            let out = '';
            for (const line of lines) {
                if (!out) {
                    out = line;
                    continue;
                }
                const endsSentence = /[.:;!?]$/.test(out);
                const startsItem = /^([-•*]|\d+[.)])\s/.test(line);
                out += endsSentence || startsItem ? '\n' + line : ' ' + line;
            }
            return out;
        })
        .filter((paragraph) => paragraph.length > 0);

    return paragraphs.join('\n\n').trim();
};

/** Whether a reader result is worth keeping at all. */
export const isReadable = (text: string, confidence: number): boolean =>
    confidence >= MIN_PAGE_CONFIDENCE && /[A-Za-z؀-ۿ]{3,}/.test(text);

/** Let go of a picture's memory as soon as its words have been read; a long
 *  scan holds a lot of them otherwise. */
const release = (canvas: HTMLCanvasElement): void => {
    canvas.width = 0;
    canvas.height = 0;
};

/** Draw one page of a PDF onto a canvas the reader can look at. */
const renderPage = async (pdf: PDFDocumentProxy, pageNumber: number): Promise<HTMLCanvasElement> => {
    const page = await pdf.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: renderScaleFor(natural.width, natural.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not draw the page: no 2D canvas available');
    await page.render({ canvasContext: context, viewport }).promise;
    page.cleanup();
    return canvas;
};

/**
 * Read every page of an already-opened scanned PDF.
 *
 * Pages are drawn one at a time — drawing has to happen where the screen is —
 * but a drawn page is handed straight to the reader without waiting for the
 * previous one's words, so a reader with several copies of the engine reads
 * several pages at once. Only a few drawn-but-unread pages are kept in hand,
 * because each one is a large picture and a long scan would otherwise fill
 * the machine's memory.
 */
export const readScannedPdf = async (
    pdf: PDFDocumentProxy,
    reader: ScanReader,
    onProgress?: (progress: ScanProgress) => void,
    readAhead = workerCountFor() + 1,
): Promise<ScanOutcome> => {
    const pageCount = pdf.numPages;
    const pages: (string | null)[] = new Array(pageCount).fill(null);
    const fractions: number[] = new Array(pageCount).fill(0);
    const confidences: number[] = new Array(pageCount).fill(0);
    let finished = 0;
    let firstError: unknown = null;

    const report = (): void =>
        onProgress?.({
            page: Math.min(pageCount, finished + 1),
            pageCount,
            fraction: pageCount
                ? fractions.reduce((sum, value) => sum + value, 0) / pageCount
                : 1,
        });

    report();

    const inFlight = new Set<Promise<void>>();
    const capacity = Math.max(1, Math.floor(readAhead));

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        if (inFlight.size >= capacity) await Promise.race(inFlight);
        if (firstError) break;

        const index = pageNumber - 1;
        const canvas = await renderPage(pdf, pageNumber);
        const job = reader
            .readPage(canvas, (fraction) => {
                fractions[index] = fraction;
                report();
            })
            .then(({ text, confidence }) => {
                confidences[index] = confidence;
                if (isReadable(text, confidence)) pages[index] = cleanScanText(text);
            })
            .catch((error: unknown) => {
                firstError ??= error;
            })
            .finally(() => {
                release(canvas);
                fractions[index] = 1;
                finished += 1;
                inFlight.delete(job);
                report();
            });
        inFlight.add(job);
    }

    await Promise.all(inFlight);
    if (firstError) throw firstError;

    return {
        // Kept in page order, whatever order the pages were read in.
        text: pages.filter((page): page is string => page !== null).join('\n\n'),
        confidence: pageCount ? confidences.reduce((sum, value) => sum + value, 0) / pageCount : 0,
        pageCount,
    };
};

/**
 * Turn a photo into a picture the reader can work with quickly: upright, no
 * bigger than it needs to be, and on a white background.
 *
 * A phone stores a portrait photo sideways with a note saying which way up it
 * is; ignore the note and the reader sees sideways writing, which comes back
 * as nonsense. A see-through background — a PNG or WebP saved with one —
 * turns black on a canvas, which hides the writing completely.
 *
 * Where the browser cannot do this (and in tests) the photo is handed over
 * untouched, exactly as before.
 */
const drawPhoto = async (file: Blob): Promise<{ image: ScanSource; canvas?: HTMLCanvasElement }> => {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
        return { image: file };
    }
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        return { image: file };
    }
    try {
        const scale = photoScaleFor(bitmap.width, bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return { image: file };
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return { image: canvas, canvas };
    } finally {
        bitmap.close();
    }
};

/** Read a photo or picture of a document. One page by definition. */
export const readImageFile = async (
    file: Blob,
    reader: ScanReader,
    onProgress?: (progress: ScanProgress) => void,
): Promise<ScanOutcome> => {
    onProgress?.({ page: 1, pageCount: 1, fraction: 0 });
    const { image, canvas } = await drawPhoto(file);
    try {
        const { text, confidence } = await reader.readPage(image, (fraction) =>
            onProgress?.({ page: 1, pageCount: 1, fraction }),
        );
        return {
            text: isReadable(text, confidence) ? cleanScanText(text) : '',
            confidence,
            pageCount: 1,
        };
    } finally {
        if (canvas) release(canvas);
    }
};
