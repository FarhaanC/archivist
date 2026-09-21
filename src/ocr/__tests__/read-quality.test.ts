import { describe, expect, test } from 'bun:test';
import {
    isJunkToken,
    judgeRead,
    junkFraction,
    MIN_PIXELS_PER_WORD,
    POOR_CONFIDENCE,
    wordCount,
} from '@/ocr/read-quality';

/**
 * The two real texts these rules were tuned against.
 *
 * The licence is the stored text of a photographed UAE vehicle licence, the
 * one that sent the app looking for the wrong expiry date. The contract is the
 * kind of clean office prose the standard timing test draws, which must never
 * be judged poor.
 */
const LICENCE =
    '…[23-12-2025 ‏تهاءالترخيص|‎ 1868. Date] 16-01-2013 omelet Ins. Exp. 23-01-2026 ' +
    '‏مؤمنة لدى | الاتحاد الوطنى شركة 1 [إنتهاءالتأمين]‎ Policy No. …';

const CONTRACT = [
    'TENANCY CONTRACT — RENEWAL NOTICE',
    'Reference: ARC-2291-B   Issued: 14 March',
    'This notice confirms that the agreement described below will renew',
    'for a further twelve months unless either party gives written',
    'notice no later than sixty days before the expiry date.',
    'Property: Unit 1204, Marina Heights, Plot 42',
    'Annual rent: payable in four instalments',
    'Maintenance: landlord retains responsibility for the air',
    'conditioning units and the water heater.',
    'Signed on behalf of the landlord and countersigned by the tenant.',
].join('\n');

describe('isJunkToken', () => {
    test('letter-soup is junk', () => {
        expect(isJunkToken('trchs')).toBe(true); // no vowel at all
        expect(isJunkToken('EEE')).toBe(true); // the same letter three times
        expect(isJunkToken('eS')).toBe(true); // the case switching mid-word
        expect(isJunkToken('1o68')).toBe(true); // letters and digits jumbled
        expect(isJunkToken('تهاءالترخيص|')).toBe(true); // a pipe inside a word
        expect(isJunkToken('n')).toBe(true); // a stray single letter
    });

    test('ordinary writing is not junk', () => {
        // Words with long consonant runs are the easiest thing to get wrong
        // here: an over-eager rule condemns half of English.
        for (const word of ['months', 'Heights,', 'strengths', 'rhythm', 'Signed']) {
            expect(isJunkToken(word)).toBe(false);
        }
        // Reference numbers, dates, money and the real one-letter words.
        for (const word of ['ARC-2291-B', '23-12-2025', 'AED', '1,496.25', 'A4', '23rd', 'a', 'I']) {
            expect(isJunkToken(word)).toBe(false);
        }
        // Arabic is written without the vowels the rules above look for, so it
        // is judged only on the characters it is made of.
        for (const word of ['مؤمنة', 'الاتحاد', 'إنتهاءالتأمين']) {
            expect(isJunkToken(word)).toBe(false);
        }
    });
});

describe('junkFraction', () => {
    test('clean office prose has none', () => {
        expect(junkFraction(CONTRACT)).toBe(0);
    });

    test('the licence photo has some, and clearly more than the contract', () => {
        // Worth being honest about this number. Most of what went wrong on
        // that card cannot be seen from the text alone: "1868." reads as a
        // perfectly ordinary number and "omelet" as a perfectly ordinary
        // word, though neither is what the card says. Only the broken-apart
        // Arabic label shows. So this share stays below the one-third bar,
        // and that photo is caught by the other two signs instead.
        expect(junkFraction(LICENCE)).toBeGreaterThan(junkFraction(CONTRACT));
        expect(junkFraction(LICENCE)).toBeGreaterThan(0.04);
    });

    test('nothing at all is not junk', () => {
        expect(junkFraction('')).toBe(0);
        expect(junkFraction('   \n  ')).toBe(0);
    });
});

describe('judgeRead', () => {
    test('a clean read is left alone', () => {
        const quality = judgeRead({ text: CONTRACT, confidence: 91 });
        expect(quality.poor).toBe(false);
        expect(quality.why).toBe(null);
        expect(quality.score).toBe(wordCount(CONTRACT) * 91);
    });

    test('an unsure read is worth another go', () => {
        const quality = judgeRead({ text: CONTRACT, confidence: POOR_CONFIDENCE - 1 });
        expect(quality.poor).toBe(true);
        expect(quality.why).toBe('low-confidence');
    });

    test('letter-soup is worth another go however sure the reader is', () => {
        const soup = 'trchs EEE eS 1o68 mnth Exp bcdf ghjk the and 5 of';
        const quality = judgeRead({ text: soup, confidence: 95 });
        expect(quality.poor).toBe(true);
        expect(quality.why).toBe('mostly-junk');
    });

    test('a big photograph that yielded almost nothing is worth another go', () => {
        // 2400 × 1500 should carry about ninety words; thirty means most of
        // the card was missed, however sure the reader is about the thirty.
        const thirty = Array.from({ length: 30 }, () => 'word').join(' ');
        const quality = judgeRead({ text: thirty, confidence: 88 }, { width: 2400, height: 1500 });
        expect(quality.poor).toBe(true);
        expect(quality.why).toBe('too-few-words');
    });

    test('a full photograph is left alone', () => {
        const words = Math.ceil((2400 * 1500) / MIN_PIXELS_PER_WORD) + 5;
        const text = Array.from({ length: words }, () => 'word').join(' ');
        expect(judgeRead({ text, confidence: 88 }, { width: 2400, height: 1500 }).poor).toBe(false);
    });

    test('a page of a scan is never judged on how big the page is', () => {
        // A title page with four words on it is a title page, not a bad read.
        const quality = judgeRead({ text: 'Schedule of Agreed Works', confidence: 90 });
        expect(quality.poor).toBe(false);
    });

    test('a blank page is blank, not poor', () => {
        // There is nothing on it to sharpen, so a second look would cost the
        // person time and find the same nothing.
        const quality = judgeRead({ text: '', confidence: 0 }, { width: 2400, height: 1500 });
        expect(quality.poor).toBe(false);
        expect(quality.why).toBe(null);
        expect(quality.score).toBe(0);
    });

    test('the score weights sureness by how much was read', () => {
        // The whole reason confidence alone cannot be trusted: a read that
        // skipped the hard half of the card is surer and worth less.
        const thorough = judgeRead({ text: 'one two three four five six', confidence: 70 });
        const timid = judgeRead({ text: 'one two', confidence: 95 });
        expect(thorough.score).toBeGreaterThan(timid.score);
    });

    test('a nonsense confidence does not produce a nonsense score', () => {
        expect(judgeRead({ text: 'one two', confidence: Number.NaN }).score).toBe(0);
        expect(judgeRead({ text: 'one two', confidence: -5 }).score).toBe(0);
    });
});
