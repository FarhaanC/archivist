import { describe, expect, test } from 'bun:test';
import { chunkText } from '@/ingestion/chunk';
import { explainArabicLabels } from '@/ocr/labels';

/**
 * The question this whole piece of work exists for.
 *
 * "When does my vehicle licence expire?" was answered with 23-01-2026, the
 * insurance expiry, instead of 23-12-2025, the licence expiry. Not because
 * the model reasoned badly, but because the stored text gave it one readable
 * English label and one heap of letters: "Ins. Exp." beside the insurance
 * date, "1868. Date" beside the licence date. It reported the only labelled
 * date it could see.
 *
 * This checks the part of the fix that can honestly be checked without a
 * browser and a real photograph: that the licence date and words saying what
 * it is end up in the same piece of text, so that whichever piece the search
 * hands over carries both.
 */
const STORED_LICENCE =
    '…[23-12-2025 ‏تهاءالترخيص|‎ 1868. Date] 16-01-2013 omelet Ins. Exp. 23-01-2026 ' +
    '‏مؤمنة لدى | الاتحاد الوطنى شركة 1 [إنتهاءالتأمين]‎ Policy No. 4471-2013-0091 ' +
    'Traffic Plate No. 51234 Dubai Emirate Vehicle Licence';

const LICENCE_EXPIRY = '23-12-2025';
const INSURANCE_EXPIRY = '23-01-2026';

describe('before this work', () => {
    test('only the insurance date had a label anyone could read', () => {
        // Stated plainly so that if this ever stops being true, the test that
        // follows stops meaning anything and says so.
        expect(STORED_LICENCE).toContain(`Ins. Exp. ${INSURANCE_EXPIRY}`);
        expect(STORED_LICENCE).not.toContain(`Exp. Date] ${LICENCE_EXPIRY}`);
        expect(STORED_LICENCE).not.toContain('Licence expiry');
    });
});

describe('after this work', () => {
    const stored = explainArabicLabels(STORED_LICENCE);

    test('the licence date carries words that say what it is', () => {
        expect(stored).toContain('(Licence expiry)');
        expect(stored).toContain('(Insurance expiry)');
    });

    test('the date and its label land in the same piece of text', () => {
        // The pieces are what a search hands to the model. A label in one
        // piece and its date in another would leave the model exactly where
        // it started.
        const pieces = chunkText(stored);
        const together = pieces.filter(
            (piece) => piece.includes(LICENCE_EXPIRY) && piece.includes('Licence expiry'),
        );
        expect(together.length).toBeGreaterThan(0);
    });

    test('the two dates are told apart by their own labels', () => {
        const pieces = chunkText(stored);
        const licencePiece = pieces.find((piece) => piece.includes('(Licence expiry)'));
        const insurancePiece = pieces.find((piece) => piece.includes('(Insurance expiry)'));
        expect(licencePiece).toBeDefined();
        expect(insurancePiece).toBeDefined();

        // Whichever piece the licence label is in, the licence date is nearer
        // to it than the insurance date is. That closeness is what the model
        // has to go on.
        const at = (stored.indexOf('(Licence expiry)') + 16) as number;
        const toLicence = Math.abs(stored.indexOf(LICENCE_EXPIRY) - at);
        const toInsurance = Math.abs(stored.indexOf(INSURANCE_EXPIRY) - at);
        expect(toLicence).toBeLessThan(toInsurance);
    });
});
