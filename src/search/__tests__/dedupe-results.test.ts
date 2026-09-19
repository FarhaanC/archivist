import { describe, test, expect } from 'bun:test';
import { dedupeSimilarResults } from '../dedupe-results';

describe('dedupeSimilarResults', () => {
    const spec = 'The M3 beacon supports Bluetooth with a range of 100 meters and battery life of 5 years using a coin cell.';

    test('keeps the first (highest-scoring) of near-identical texts', () => {
        const out = dedupeSimilarResults([
            { text: spec },
            { text: spec.replace('5 years', '7 years') },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]?.text).toBe(spec);
    });

    test('keeps genuinely different texts', () => {
        const out = dedupeSimilarResults([
            { text: spec },
            { text: 'Flight to Lisbon departs June 3rd, hotel check-in after 3pm, remember the day trip.' },
        ]);
        expect(out).toHaveLength(2);
    });

    test('handles empty input and empty texts', () => {
        expect(dedupeSimilarResults([])).toEqual([]);
        expect(dedupeSimilarResults([{ text: '' }, { text: '' }])).toHaveLength(2);
    });

    test('collapses three copies to one but keeps the outlier', () => {
        const out = dedupeSimilarResults([
            { text: spec },
            { text: spec + ' Extra.' },
            { text: spec.replace('100 meters', '120 meters') },
            { text: 'Completely unrelated content about travel plans in Portugal next summer.' },
        ]);
        expect(out).toHaveLength(2);
    });
});

describe('dedupeSimilarResults within one document', () => {
    const probation =
        'During this period both the company and Employee have the option to terminate the contract with Seven-day Notice. The Employee dues will be immediately paid upon completion of handover.';
    const after = probation.replace('During this period', 'Post three months of contract').replace('Seven-day', 'Thirty (30) days');

    test('keeps two near-identical clauses of the SAME document — they differ in the number that matters', () => {
        const out = dedupeSimilarResults([
            { text: probation, docId: 7 },
            { text: after, docId: 7 },
        ]);
        expect(out).toHaveLength(2);
    });

    test('still collapses the same clause repeated across two documents', () => {
        const out = dedupeSimilarResults([
            { text: probation, docId: 7 },
            { text: probation, docId: 8 },
        ]);
        expect(out).toHaveLength(1);
    });
});
