import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ScanReader } from '@/ocr/reader';

/**
 * Reading a scanned document: draw each page as a picture, hand the picture
 * to the reader, keep what comes back.
 *
 * The reader is the slow part — a few seconds a page on an ordinary laptop —
 * so every page reports progress, and the caller shows "Reading page 3 of 7"
 * rather than a bar that sits still.
 */

export interface ScanProgress {
    page: number;
    pageCount: number;
    /** 0–1 within the current page. */
    fraction: number;
}

export interface ScanOutcome {
    text: string;
    /** Average of the per-page confidences, 0–100. */
    confidence: number;
    pageCount: number;
}

/** Pages are drawn at twice their nominal size. Tesseract reads small type
 *  badly below ~300 dpi, and most scans are stored at 72–150. */
const RENDER_SCALE = 2;

/** Pages whose confidence is below this are too garbled to index: they would
 *  match nothing and pollute the near-duplicate check. */
export const MIN_PAGE_CONFIDENCE = 40;

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

/** Draw one page of a PDF onto a canvas the reader can look at. */
const renderPage = async (pdf: PDFDocumentProxy, pageNumber: number): Promise<HTMLCanvasElement> => {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not draw the page: no 2D canvas available');
    await page.render({ canvasContext: context, viewport }).promise;
    page.cleanup();
    return canvas;
};

/** Read every page of an already-opened scanned PDF. */
export const readScannedPdf = async (
    pdf: PDFDocumentProxy,
    reader: ScanReader,
    onProgress?: (progress: ScanProgress) => void,
): Promise<ScanOutcome> => {
    const pageCount = pdf.numPages;
    const pages: string[] = [];
    let confidenceTotal = 0;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        onProgress?.({ page: pageNumber, pageCount, fraction: 0 });
        const canvas = await renderPage(pdf, pageNumber);
        const { text, confidence } = await reader.readPage(canvas, (fraction) =>
            onProgress?.({ page: pageNumber, pageCount, fraction }),
        );
        // Release the bitmap; a 20-page scan at 2× is a lot of memory otherwise.
        canvas.width = 0;
        canvas.height = 0;

        confidenceTotal += confidence;
        if (isReadable(text, confidence)) pages.push(cleanScanText(text));
    }

    return {
        text: pages.join('\n\n'),
        confidence: pageCount ? confidenceTotal / pageCount : 0,
        pageCount,
    };
};

/** Read a photo or picture of a document. One page by definition. */
export const readImageFile = async (
    file: Blob,
    reader: ScanReader,
    onProgress?: (progress: ScanProgress) => void,
): Promise<ScanOutcome> => {
    onProgress?.({ page: 1, pageCount: 1, fraction: 0 });
    const { text, confidence } = await reader.readPage(file, (fraction) =>
        onProgress?.({ page: 1, pageCount: 1, fraction }),
    );
    return {
        text: isReadable(text, confidence) ? cleanScanText(text) : '',
        confidence,
        pageCount: 1,
    };
};
