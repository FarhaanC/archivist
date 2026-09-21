import { describe, expect, test } from 'bun:test';
import { STANDARD_EXPECTED, STANDARD_HARD_CARDS, wordsFoundIn } from '@/dev/standard-files';
import { judgeRead } from '@/ocr/read-quality';

/**
 * The hard cards, and the promise that goes with them.
 *
 * Drawing the files needs a browser, so what is checked here is the part that
 * does not: what each card is expected to say, how that is counted, and — the
 * rule that matters most — that none of the *clean* files in the standard set
 * would ever be sent back for a second look. A clean scan that is read twice
 * on every run is a permanent tax on every ordinary import.
 */

const CARD = 'card-photo.jpg';

describe('what the hard cards are expected to say', () => {
    test('there are four of them', () => {
        expect(STANDARD_HARD_CARDS).toEqual([
            'card-small.jpg',
            'card-tilted.jpg',
            'card-blurred.jpg',
            'card-photo.jpg',
        ]);
    });

    test('each one knows the labels and values it carries', () => {
        for (const card of STANDARD_HARD_CARDS) {
            const expected = STANDARD_EXPECTED[card];
            expect(expected?.length ?? 0).toBeGreaterThanOrEqual(12);
            expect(expected).toContain('23-12-2025'); // the licence expiry
            expect(expected).toContain('23-01-2026'); // the insurance expiry
        }
    });

    test('the photograph also expects the Arabic labels beside the English', () => {
        expect(STANDARD_EXPECTED[CARD]).toContain('إنتهاء الترخيص');
        expect((STANDARD_EXPECTED[CARD]?.length ?? 0)).toBeGreaterThan(
            STANDARD_EXPECTED['card-small.jpg']?.length ?? 0,
        );
    });
});

describe('counting how much came through', () => {
    test('a perfect reading finds everything', () => {
        const everything = (STANDARD_EXPECTED[CARD] ?? []).join(' ');
        const score = wordsFoundIn(CARD, everything);
        expect(score?.found).toBe(score?.expected);
    });

    test('a reading that lost half finds half', () => {
        const expected = STANDARD_EXPECTED[CARD] ?? [];
        const half = expected.slice(0, Math.floor(expected.length / 2)).join(' ');
        const score = wordsFoundIn(CARD, half);
        expect(score?.found).toBe(Math.floor(expected.length / 2));
    });

    test('Arabic spelled another way still counts', () => {
        // The reader may give back الترخيص انتهاء without the hamza, or with
        // no space. It is the same label and should be counted as found.
        const score = wordsFoundIn(CARD, 'انتهاءالترخيص');
        expect(score?.found).toBeGreaterThan(0);
    });

    test('nothing read finds nothing', () => {
        expect(wordsFoundIn(CARD, '')?.found).toBe(0);
    });

    test('the other files in the set are not counted this way', () => {
        // They have no list of what they say, so there is no honest number
        // to give and none is invented.
        expect(wordsFoundIn('scan-1.pdf', 'anything at all')).toBe(null);
        expect(wordsFoundIn('typed-notes.txt', 'anything at all')).toBe(null);
    });
});

describe('the clean files in the standard set are never read twice', () => {
    // The pages the standard test draws: crisp black type on white, which the
    // reader handles in the high eighties and nineties.
    const CLEAN_PAGE = [
        'TENANCY CONTRACT — RENEWAL NOTICE Reference: ARC-2291-B Issued: 14 March',
        'This notice confirms that the agreement described below will renew for a',
        'further twelve months unless either party gives written notice no later',
        'than sixty days before the expiry date. Property: Unit 1204, Marina',
        'Heights, Plot 42 Annual rent: payable in four instalments Maintenance:',
        'landlord retains responsibility for the air conditioning units and the',
        'water heater. Signed on behalf of the landlord and countersigned by the',
        'tenant.',
    ].join(' ');

    test('a page of a scan is left alone', () => {
        for (const confidence of [85, 88, 91, 96]) {
            expect(judgeRead({ text: CLEAN_PAGE, confidence }).poor).toBe(false);
        }
    });

    test.each([
        ['photo-plain.jpg', 1600, 2200],
        // The large photograph is shrunk to fit before it is read, so this is
        // the size the reader and the judge actually see.
        ['photo-large.jpg', 1697, 2400],
        ['photo-sideways.jpg', 2200, 1600],
    ])('%s is left alone', (_name, width, height) => {
        for (const confidence of [85, 91, 96]) {
            expect(judgeRead({ text: CLEAN_PAGE, confidence }, { width, height }).poor).toBe(
                false,
            );
        }
    });
});
