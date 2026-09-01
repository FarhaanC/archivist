import { describe, test, expect } from 'bun:test';
import { wordDiff, summarizeDiff } from '../word-diff';

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

describe('summarizeDiff', () => {
    test('formats changes as readable arrows', () => {
        const s = summarizeDiff([{ removed: '5 years', added: '7 years' }]);
        expect(s).toBe('"5 years" → "7 years"');
    });

    test('caps shown changes and counts the rest', () => {
        const changes = Array.from({ length: 5 }, (_, i) => ({ removed: `a${i}`, added: `b${i}` }));
        const s = summarizeDiff(changes, 2);
        expect(s).toContain('(+3 more changes)');
    });

    test('empty diff reads as identical', () => {
        expect(summarizeDiff([])).toBe('identical text');
    });
});
