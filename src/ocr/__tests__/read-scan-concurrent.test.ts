import { afterAll, describe, expect, test } from 'bun:test';
import { photoScaleFor, readScannedPdf, renderScaleFor } from '@/ocr/read-scan';
import type { ScanProgress } from '@/ocr/read-scan';
import type { ScanReader } from '@/ocr/reader';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * Drawing a page needs a browser. These tests put the thinnest possible
 * stand-in in its place, because what is being checked is not the drawing —
 * it is that pages come back in the right order however they were read, that
 * no more pictures are held in hand at once than were allowed, and that the
 * progress the person sees only ever moves forward.
 */

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const realDocument = (globalThis as { document?: unknown }).document;

(globalThis as { document?: unknown }).document = {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
            fillStyle: '',
            fillRect: () => undefined,
            drawImage: () => undefined,
        }),
    }),
};

afterAll(() => {
    (globalThis as { document?: unknown }).document = realDocument;
});

const fakePdf = (pageCount: number, width = 595, height = 842): PDFDocumentProxy =>
    ({
        numPages: pageCount,
        getPage: async () => ({
            getViewport: ({ scale }: { scale: number }) => ({
                width: width * scale,
                height: height * scale,
            }),
            render: () => ({ promise: Promise.resolve() }),
            cleanup: () => undefined,
        }),
    }) as unknown as PDFDocumentProxy;

describe('renderScaleFor', () => {
    test('magnifies a page stored small, so small type survives', () => {
        // A4 at 72 dots per inch.
        expect(renderScaleFor(595, 842)).toBe(2);
    });

    test('leaves a page that is already sharp alone', () => {
        // A4 at 300 dots per inch: blowing it up further only costs time.
        expect(renderScaleFor(2480, 3508)).toBe(1);
    });

    test('lands a middling page near the size the reader likes', () => {
        expect(renderScaleFor(1100, 1500)).toBeCloseTo(2200 / 1500, 5);
    });

    test('never shrinks a page, whatever it claims to be', () => {
        expect(renderScaleFor(8000, 11000)).toBe(1);
        expect(renderScaleFor(0, 0)).toBe(1);
        expect(renderScaleFor(Number.NaN, Number.NaN)).toBe(1);
    });
});

describe('photoScaleFor', () => {
    test('shrinks a big phone photo', () => {
        expect(photoScaleFor(4000, 3000)).toBeCloseTo(2400 / 4000, 5);
    });

    test('leaves a small picture alone rather than blowing it up', () => {
        expect(photoScaleFor(200, 150)).toBe(1);
        expect(photoScaleFor(2400, 1800)).toBe(1);
        expect(photoScaleFor(0, 0)).toBe(1);
        expect(photoScaleFor(Number.NaN, 10)).toBe(1);
    });
});

/** A reader that takes longer over the early pages than the late ones, so a
 *  file whose pages came back out of order is easy to spot. */
const outOfOrderReader = (): ScanReader & { peak: () => number } => {
    let call = 0;
    let active = 0;
    let peak = 0;
    return {
        peak: () => peak,
        readPage: async (_image, onProgress) => {
            const n = (call += 1);
            active += 1;
            peak = Math.max(peak, active);
            onProgress?.(0.5);
            await wait((8 - n) * 4);
            active -= 1;
            return { text: `page ${n} words`, confidence: 90 };
        },
        close: async () => undefined,
    };
};

describe('readScannedPdf', () => {
    test('keeps the pages in page order however fast each one was read', async () => {
        const reader = outOfOrderReader();
        const out = await readScannedPdf(fakePdf(5), reader, undefined, 3);
        expect(out.text.split('\n\n')).toEqual([
            'page 1 words',
            'page 2 words',
            'page 3 words',
            'page 4 words',
            'page 5 words',
        ]);
        expect(out.pageCount).toBe(5);
        expect(out.confidence).toBe(90);
    });

    test('reads several pages at once, but only as many as it was allowed', async () => {
        const reader = outOfOrderReader();
        await readScannedPdf(fakePdf(6), reader, undefined, 2);
        expect(reader.peak()).toBe(2);

        const oneAtATime = outOfOrderReader();
        await readScannedPdf(fakePdf(6), oneAtATime, undefined, 1);
        expect(oneAtATime.peak()).toBe(1);
    });

    test('progress only ever moves forward and ends at the last page', async () => {
        const seen: ScanProgress[] = [];
        await readScannedPdf(fakePdf(4), outOfOrderReader(), (p) => seen.push(p), 2);

        const fractions = seen.map((p) => p.fraction);
        for (let i = 1; i < fractions.length; i++) {
            expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1] as number);
        }
        expect(fractions[fractions.length - 1]).toBe(1);

        const pages = seen.map((p) => p.page);
        for (let i = 1; i < pages.length; i++) {
            expect(pages[i]).toBeGreaterThanOrEqual(pages[i - 1] as number);
        }
        expect(seen.every((p) => p.pageCount === 4)).toBe(true);
        expect(pages[pages.length - 1]).toBe(4);
    });

    test('a page the reader chokes on fails the file rather than half-saving it', async () => {
        const reader: ScanReader = {
            readPage: async () => {
                throw new Error('that page makes no sense');
            },
            close: async () => undefined,
        };
        await expect(readScannedPdf(fakePdf(3), reader, undefined, 2)).rejects.toThrow(
            'that page makes no sense',
        );
    });

    test('drops the pages it could not make out and keeps the ones it could', async () => {
        let call = 0;
        const reader: ScanReader = {
            readPage: async () => {
                call += 1;
                return call === 2
                    ? { text: 'smudge', confidence: 5 }
                    : { text: `page ${call} words`, confidence: 88 };
            },
            close: async () => undefined,
        };
        const out = await readScannedPdf(fakePdf(3), reader, undefined, 1);
        expect(out.text).toBe('page 1 words\n\npage 3 words');
    });
});
