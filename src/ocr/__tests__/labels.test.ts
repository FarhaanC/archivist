import { describe, expect, test } from 'bun:test';
import { ARABIC_LABELS, explainArabicLabels, findArabicLabels } from '@/ocr/labels';

/**
 * The real stored text of the photographed licence, as the reader gave it
 * back. Everything in this file is measured against it, because it is the
 * document that prompted all of this: the English label beside the licence
 * date broke up into "1868. Date", while the one beside the insurance date
 * survived, and the app answered the wrong question as a result.
 */
const LICENCE =
    '…[23-12-2025 ‏تهاءالترخيص|‎ 1868. Date] 16-01-2013 omelet Ins. Exp. 23-01-2026 ' +
    '‏مؤمنة لدى | الاتحاد الوطنى شركة 1 [إنتهاءالتأمين]‎ Policy No. …';

const meanings = (text: string): string[] =>
    findArabicLabels(text).map((found) => found.english);

describe('finding the labels on the licence photograph', () => {
    test('finds the three that are on it', () => {
        expect(meanings(LICENCE)).toEqual(['Licence expiry', 'Insured by', 'Insurance expiry']);
    });

    test('reads the licence-expiry label even with its first letters missing', () => {
        // The card prints إنتهاء الترخيص; the photograph gave back
        // تهاءالترخيص — two letters short at the front and no space.
        expect(meanings('‏تهاءالترخيص|')).toEqual(['Licence expiry']);
    });

    test('is not fooled into explaining the same label twice over', () => {
        expect(meanings(LICENCE).length).toBe(new Set(meanings(LICENCE)).size);
    });
});

describe('labels that came back damaged', () => {
    // A letter missing from either end of each spelling in the table. Cards
    // lose the edges of their printing first, which is exactly the case this
    // matching is loose for.
    const long = ARABIC_LABELS.flatMap(({ arabic, english }) =>
        arabic.filter((spelling) => spelling.replace(/\s/g, '').length >= 9).map((spelling) => ({
            spelling,
            english,
        })),
    );

    test('there are enough long labels to be worth testing', () => {
        expect(long.length).toBeGreaterThanOrEqual(5);
    });

    for (const { spelling, english } of long.slice(0, 6)) {
        test(`${english}: recognised with a letter missing from either end`, () => {
            expect(meanings(spelling)).toContain(english);
            expect(meanings(spelling.slice(1))).toContain(english);
            expect(meanings(spelling.slice(0, -1))).toContain(english);
        });
    }

    test('spelling differences between cards do not matter', () => {
        // Whether an alif carries its hamza, whether a word ends round or
        // open, whether the two halves are spaced — cards, fonts and readers
        // all disagree, and none of it changes what the label says.
        for (const spelling of [
            'انتهاء الترخيص',
            'إنتهاءالترخيص',
            'إنتهاء  الترخيص',
            'إنتهاء الترخيــص',
        ]) {
            expect(meanings(spelling)).toContain('Licence expiry');
        }
    });
});

describe('putting the meaning into the text', () => {
    const explained = explainArabicLabels(LICENCE);

    test('the licence date now sits beside words that say what it is', () => {
        // The point of the whole exercise: asked about the licence, the model
        // now has a readable label next to the right date instead of only
        // next to the wrong one.
        const at = explained.indexOf('(Licence expiry)');
        const date = explained.indexOf('23-12-2025');
        expect(at).toBeGreaterThan(-1);
        expect(date).toBeGreaterThan(-1);
        expect(Math.abs(at - date)).toBeLessThan(60);
    });

    test('the insurance date keeps its own label too', () => {
        const insurance = explained.indexOf('23-01-2026');
        const licence = explained.indexOf('23-12-2025');
        expect(explained).toContain('(Insurance expiry)');
        // Both dates are labelled, and the two labels are not the same one.
        expect(insurance).not.toBe(licence);
    });

    test('the Arabic itself is left exactly where it was', () => {
        expect(explained).toContain('تهاءالترخيص');
        expect(explained).toContain('إنتهاءالتأمين');
        // Nothing is removed or moved: take the added brackets back out and
        // the text is character for character what the reader gave back.
        expect(explained.replace(/ \([A-Za-z ]+\)/g, '')).toBe(LICENCE);
    });

    test('nothing lands in the middle of a word or a number', () => {
        expect(explained).not.toMatch(/\d\s\(/);
        expect(explained).not.toMatch(/\(\w+ \w+\)\d/);
        expect(explained).toContain('23-12-2025');
        expect(explained).toContain('23-01-2026');
    });
});

describe('leaving alone what it should', () => {
    test('English-only text is handed straight back', () => {
        const english = 'Exp. Date 23-12-2025 Ins. Exp. 23-01-2026 Policy No. 4471';
        expect(explainArabicLabels(english)).toBe(english);
    });

    test('Arabic with none of these labels in it is handed straight back', () => {
        const prose = 'هذه رسالة قصيرة مكتوبة باللغة العربية ولا تحتوي على أي بيانات';
        expect(explainArabicLabels(prose)).toBe(prose);
    });

    test('nothing at all is handed straight back', () => {
        expect(explainArabicLabels('')).toBe('');
    });

    test('a label printed twice close together is explained once', () => {
        const twice = 'مؤمنة لدى شركة مؤمنة لدى شركة';
        expect(explainArabicLabels(twice).match(/\(Insured by\)/g)?.length).toBe(1);
    });

    test('a label printed twice far apart is explained both times', () => {
        const far = `مؤمنة لدى${' the rest of the card '.repeat(4)}مؤمنة لدى`;
        expect(explainArabicLabels(far).match(/\(Insured by\)/g)?.length).toBe(2);
    });
});
