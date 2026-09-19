import { describe, expect, test } from 'bun:test';
import { cleanScanText, isReadable, MIN_PAGE_CONFIDENCE, readImageFile } from '@/ocr/read-scan';
import type { ScanReader } from '@/ocr/reader';

/** A reader that returns whatever it is told to, so the flow around it can
 *  be tested without loading the real engine. */
const fakeReader = (text: string, confidence: number): ScanReader => ({
    readPage: async (_image, onProgress) => {
        onProgress?.(0.5);
        onProgress?.(1);
        return { text, confidence };
    },
    close: async () => undefined,
});

describe('cleanScanText', () => {
    test('joins the short lines a scanner makes of a paragraph', () => {
        const raw = 'This letter confirms that Farhaan Chida\nwas employed at Disrupt X FZCO from\nOctober 01, 2025, to August 10, 2026.';
        expect(cleanScanText(raw)).toBe(
            'This letter confirms that Farhaan Chida was employed at Disrupt X FZCO from October 01, 2025, to August 10, 2026.',
        );
    });

    test('keeps paragraph breaks', () => {
        const raw = 'First paragraph line one\nline two.\n\nSecond paragraph.';
        expect(cleanScanText(raw)).toBe('First paragraph line one line two.\n\nSecond paragraph.');
    });

    test('keeps a break after a sentence ends and before a list item', () => {
        const raw = 'Duties included:\n- prompt engineering\n- testing\nand more';
        expect(cleanScanText(raw)).toBe('Duties included:\n- prompt engineering\n- testing and more');
    });

    test('collapses runs of spaces and drops blank lines', () => {
        expect(cleanScanText('  a   b \n\n\n\n c  ')).toBe('a b\n\nc');
    });
});

describe('isReadable', () => {
    test('rejects low confidence and pages with no real words', () => {
        expect(isReadable('Employment letter', MIN_PAGE_CONFIDENCE)).toBe(true);
        expect(isReadable('Employment letter', MIN_PAGE_CONFIDENCE - 1)).toBe(false);
        expect(isReadable('|| -- ,, .. 12 3', 95)).toBe(false);
    });

    test('accepts Arabic', () => {
        expect(isReadable('رخصة قيادة', 80)).toBe(true);
    });
});

describe('readImageFile', () => {
    test('returns cleaned text and reports progress for the single page', async () => {
        const seen: number[] = [];
        const out = await readImageFile(new Blob(['x']), fakeReader('Driving\nLicence', 88), (p) => {
            expect(p.page).toBe(1);
            expect(p.pageCount).toBe(1);
            seen.push(p.fraction);
        });
        expect(out.text).toBe('Driving Licence');
        expect(out.confidence).toBe(88);
        expect(seen).toEqual([0, 0.5, 1]);
    });

    test('returns empty text when the reader was not confident', async () => {
        const out = await readImageFile(new Blob(['x']), fakeReader('gibberish words here', 20));
        expect(out.text).toBe('');
    });
});

describe('Arabic', () => {
    /**
     * UAE documents put Arabic and English on the same page — an identity
     * card, a driving licence, a visa. The scan reader now reads both, so
     * neither half may be thrown away or mangled on the way through.
     */
    test('Arabic text is worth keeping', () => {
        expect(isReadable('\u0631\u062e\u0635\u0629 \u0642\u064a\u0627\u062f\u0629', 82)).toBe(true);
    });

    test('Arabic and English on one page both survive', () => {
        const page = '\u0631\u062e\u0635\u0629 \u0642\u064a\u0627\u062f\u0629\nDriving Licence\n\nExpiry 2027-04-11';
        const cleaned = cleanScanText(page);
        expect(cleaned).toContain('\u0631\u062e\u0635\u0629');
        expect(cleaned).toContain('Driving Licence');
        expect(cleaned).toContain('Expiry 2027-04-11');
    });

    test('a low-confidence Arabic page is still dropped, like any other', () => {
        expect(isReadable('\u0631\u062e\u0635\u0629 \u0642\u064a\u0627\u062f\u0629', 12)).toBe(false);
    });
});
