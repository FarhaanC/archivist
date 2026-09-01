import { describe, test, expect } from 'bun:test';
import {
    describeChange,
    describeChanges,
    meaningfulChanges,
    summarizeDiff,
    wordDiff,
} from '../word-diff';

describe('wordDiff', () => {
    test('identical texts produce no changes', () => {
        expect(wordDiff('same text here', 'same text here')).toEqual([]);
    });

    test('detects a single word substitution', () => {
        const changes = wordDiff('battery life is 5 years', 'battery life is 7 years');
        expect(changes).toHaveLength(1);
        expect(changes[0]?.removed).toBe('5');
        expect(changes[0]?.added).toBe('7');
    });

    test('detects multiple separated changes', () => {
        const changes = wordDiff(
            'range of 100 meters and life of 5 years',
            'range of 120 meters and life of 7 years'
        );
        expect(changes).toHaveLength(2);
        expect(changes.map((c) => `${c.removed}>${c.added}`)).toEqual(['100>120', '5>7']);
    });

    test('detects pure insertions and deletions', () => {
        const ins = wordDiff('the beacon works', 'the new beacon works');
        expect(ins).toHaveLength(1);
        expect(ins[0]?.removed).toBe('');
        expect(ins[0]?.added).toBe('new');

        const del = wordDiff('the old beacon works', 'the beacon works');
        expect(del).toHaveLength(1);
        expect(del[0]?.removed).toBe('old');
        expect(del[0]?.added).toBe('');
    });

    test('whitespace differences alone are no change', () => {
        expect(wordDiff('a  b\n c', 'a b c')).toEqual([]);
    });

    test('huge documents fall back without crashing', () => {
        const big1 = Array.from({ length: 5000 }, (_, i) => `word${i}`).join(' ');
        const big2 = big1.replace('word2500', 'CHANGED');
        const changes = wordDiff(big1, big2);
        expect(changes.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(changes)).toContain('CHANGED');
    });
});

describe('meaningfulChanges', () => {
    /**
     * The changes that made the old import report unreadable: a pipe character
     * that moved and a line break that became a space, printed as
     * `"UAE Driving License |" -> "(nothing)"; "(nothing)" -> "|"`.
     */
    test('drops changes that are only punctuation moving around', () => {
        const changes = [
            { removed: '|', added: '' },
            { removed: '', added: '|' },
            { removed: '—', added: '-' },
        ];
        expect(meaningfulChanges(changes)).toEqual([]);
    });

    test('keeps changes that carry real words', () => {
        const changes = [
            { removed: '|', added: '' },
            { removed: '5 years', added: '7 years' },
        ];
        expect(meaningfulChanges(changes)).toEqual([{ removed: '5 years', added: '7 years' }]);
    });

    test('puts the biggest difference first', () => {
        const changes = [
            { removed: 'cat', added: 'dog' },
            { removed: 'the whole education section listing UBC', added: 'nothing at all here' },
        ];
        expect(meaningfulChanges(changes)[0]?.removed).toContain('education section');
    });
});

describe('describeChange', () => {
    test('a pure addition reads as an addition', () => {
        expect(describeChange({ removed: '', added: 'RAG pipelines and voice AI' })).toBe(
            'Adds “RAG pipelines and voice AI”',
        );
    });

    test('a pure removal reads as an omission', () => {
        expect(describeChange({ removed: 'UAE Driving License', added: '' })).toBe(
            'Leaves out “UAE Driving License”',
        );
    });

    test('a substitution names both sides, this file first', () => {
        expect(describeChange({ removed: '5 years', added: '7 years' })).toBe(
            'Says “7 years” where the other says “5 years”',
        );
    });

    test('long fragments are cut at a word boundary', () => {
        const sentence = describeChange({
            removed: '',
            added: 'a very long run of words that goes on well past any reasonable limit for one line',
        });
        expect(sentence).toContain('…');
        expect(sentence).not.toContain('reasonab”');
    });
});

describe('describeChanges', () => {
    test('shows the biggest few and counts the rest', () => {
        const changes = Array.from({ length: 8 }, (_, i) => ({
            removed: `old wording number ${i}`,
            added: `new wording number ${i}`,
        }));
        const plain = describeChanges(changes, 3);

        expect(plain.points).toHaveLength(3);
        expect(plain.minorCount).toBe(5);
    });

    test('punctuation-only diffs produce nothing to show', () => {
        const plain = describeChanges([{ removed: '|', added: '' }]);
        expect(plain.points).toEqual([]);
        expect(plain.minorCount).toBe(0);
    });
});

describe('summarizeDiff', () => {
    test('reads as sentences, not as a diff', () => {
        const s = summarizeDiff([{ removed: '5 years', added: '7 years' }]);
        expect(s).toBe('Says “7 years” where the other says “5 years”.');
    });

    test('counts the changes it did not show', () => {
        const changes = Array.from({ length: 5 }, (_, i) => ({
            removed: `alpha bravo ${i}`,
            added: `charlie delta ${i}`,
        }));
        expect(summarizeDiff(changes, 2)).toContain('3 smaller wording changes');
    });

    test('says so plainly when only formatting differs', () => {
        expect(summarizeDiff([])).toBe(
            'The wording is the same; only spacing or punctuation differs.',
        );
    });
});
