import { describe, expect, test } from 'bun:test';
import { describeModelProgress } from '@/llm/model-progress';

describe('describeModelProgress', () => {
    test('a download reads as a download, with how far along it is', () => {
        expect(
            describeModelProgress(
                'Fetching param cache[15/58]: 409MB fetched. 23% completed, 12 secs elapsed.',
            ),
        ).toBe('Downloading the model — 23% done (this happens once)');
    });

    test('loading what was already downloaded does not say "downloading"', () => {
        const said = describeModelProgress(
            'Loading model from cache[30/58]: 51% completed, 3 secs elapsed.',
        );
        expect(said).toBe('Getting the model ready — 51%');
        expect(said).not.toContain('Downloading');
    });

    test('anything else becomes a plain sentence rather than raw jargon', () => {
        expect(describeModelProgress('Start to fetch params')).toBe('Getting the model ready…');
        expect(describeModelProgress('')).toBe('Getting the model ready…');
    });

    test('never shows the words the user cannot act on', () => {
        const raw = [
            'Start to fetch params',
            'Fetching param cache[15/58]: 409MB fetched. 23% completed, 12 secs elapsed.',
            'Loading model from cache[30/58]: 51% completed, 3 secs elapsed.',
        ];
        for (const text of raw) {
            const said = describeModelProgress(text);
            expect(said).not.toContain('param');
            expect(said).not.toContain('cache');
            expect(said).not.toContain('Fetch');
        }
    });
});
