import { describe, expect, test } from 'bun:test';
import { mergeResults } from '@/search/multi-search';
import type { SearchResult } from '@/search/types';

const hit = (id: number, docId: number, score: string): SearchResult => ({
    id,
    docId,
    score,
    text: `piece ${id}`,
    filename: `${docId}.pdf`,
    debug: { vector: '0', keyword: '0' },
});

describe('mergeResults', () => {
    /**
     * The contract: four hits from one document, the fourth being the
     * thirty-day rule, and nothing else competing for the room. All four
     * must survive.
     */
    test('a document keeps its fourth hit when there is room for it', () => {
        const contract = [hit(69, 12, '1.20'), hit(70, 12, '1.30'), hit(71, 12, '1.61'), hit(73, 12, '1.05')];
        const out = mergeResults([contract], 3, 8);
        expect(out.map((r) => r.id)).toEqual([71, 70, 69, 73]);
    });

    test('a document is held to its share only when others need the room', () => {
        const contract = [1, 2, 3, 4, 5].map((n) => hit(n, 12, `1.${9 - n}0`));
        const others = [hit(10, 20, '1.00'), hit(11, 21, '0.95'), hit(12, 22, '0.90'), hit(13, 23, '0.85')];
        const out = mergeResults([contract, others], 3, 6);
        // Three of the contract's, then the three best others; the contract's
        // fourth and fifth do not push another document out.
        expect(out.map((r) => r.id)).toEqual([1, 2, 3, 10, 11, 12]);
    });

    test('the same piece found by two searches keeps its better score', () => {
        const out = mergeResults([[hit(1, 5, '1.10')], [hit(1, 5, '1.40')]], 3, 8);
        expect(out).toHaveLength(1);
        expect(out[0]?.score).toBe('1.40');
    });

    test('the list is ranked by score and never longer than the cap', () => {
        const many = [...Array(12).keys()].map((n) => hit(n, n, `${(1 + n / 10).toFixed(2)}`));
        const out = mergeResults([many], 3, 8);
        expect(out).toHaveLength(8);
        expect(out[0]?.id).toBe(11);
    });

    test('nothing found means nothing to merge', () => {
        expect(mergeResults([], 3, 8)).toEqual([]);
        expect(mergeResults([[]], 3, 8)).toEqual([]);
    });
});
