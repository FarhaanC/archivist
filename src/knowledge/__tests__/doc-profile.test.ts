import { describe, test, expect } from 'bun:test';
import { buildDocProfile, formatInventoryChunk } from '../doc-profile';

describe('buildDocProfile', () => {
    test('extracts repeated meaningful terms as topics', () => {
        const text =
            'The beacon transmits bluetooth signals. The beacon battery lasts years. Bluetooth range is long.';
        const p = buildDocProfile(text);
        expect(p.topics).toContain('beacon');
        expect(p.topics).toContain('bluetooth');
    });

    test('ignores stop words and short/numeric tokens', () => {
        const p = buildDocProfile('the the the and and 123 123 ab ab');
        expect(p.topics).toEqual([]);
    });

    test('counts words', () => {
        const p = buildDocProfile('alpha beta gamma alpha');
        expect(p.wordCount).toBe(4);
    });
});

describe('formatInventoryChunk', () => {
    test('includes topics and near-duplicate relations with diffs', () => {
        const chunk = formatInventoryChunk([
            { title: 'spec-v2.pdf', topics: ['beacon', 'battery'], similarTitle: 'spec-v1.pdf', diffSummary: '"5" → "7"' },
            { title: 'notes.md' },
        ]);
        expect(chunk).toContain('LIBRARY INVENTORY');
        expect(chunk).toContain('2 documents');
        expect(chunk).toContain('[topics: beacon, battery]');
        expect(chunk).toContain('near-duplicate of "spec-v1.pdf"');
        expect(chunk).toContain('differs: "5" → "7"');
        expect(chunk).toContain('- notes.md');
    });

    test('caps the number of listed documents', () => {
        const lines = Array.from({ length: 100 }, (_, i) => ({ title: `doc${i}.txt` }));
        const chunk = formatInventoryChunk(lines, 10);
        expect(chunk).toContain('100 documents');
        expect(chunk).toContain('doc9.txt');
        expect(chunk).not.toContain('doc10.txt');
    });
});
