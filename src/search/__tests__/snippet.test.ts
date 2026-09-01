import { describe, expect, test } from 'bun:test';
import { makeSnippet } from '@/search/snippet';

/** Shaped like a real resume chunk: a long unpunctuated run of skills. */
const RESUME_CHUNK =
    'Farhaan Chida Backend Software Engineer Dubai UAE Summary Backend engineer with two years of experience building services. ' +
    'Languages and Backend Python FastAPI REST API design JavaScript TypeScript Java SQL MongoDB asynchronous programming ' +
    'Infrastructure and Practices Docker CI CD pipelines Git code review testing n8n React front-end integration ' +
    'Education University of British Columbia Kelowna Canada 2021 2025 BSc Computer Science ' +
    'Uptown International School Dubai UAE 2019 2021 International Baccalaureate IB Diploma';

const startsMidWord = (s: string): boolean => /^…?[a-z]/.test(s) && !/^…?\s/.test(s);

describe('makeSnippet', () => {
    test('returns short text untouched', () => {
        expect(makeSnippet('A short line.', 'anything')).toBe('A short line.');
    });

    test('never starts mid-word', () => {
        // The bug this exists for: the old display sliced at character 0 of a
        // chunk that itself began mid-word, giving "pt, Java, SQL, MongoDB".
        const snippet = makeSnippet(RESUME_CHUNK, 'education university', 120);
        const firstWord = snippet.replace(/^…/, '').split(' ')[0] as string;
        expect(RESUME_CHUNK).toContain(firstWord);
        expect(startsMidWord(snippet.replace(/^…/, 'X'))).toBe(false);
    });

    test('shows the part that matched the question', () => {
        const snippet = makeSnippet(RESUME_CHUNK, 'education university', 160);
        expect(snippet.toLowerCase()).toContain('education');
        expect(snippet.toLowerCase()).toContain('university');
    });

    test('finds a match near the end of the chunk', () => {
        const snippet = makeSnippet(RESUME_CHUNK, 'Baccalaureate', 140);
        expect(snippet).toContain('Baccalaureate');
    });

    test('marks both ends it trimmed', () => {
        const snippet = makeSnippet(RESUME_CHUNK, 'Docker pipelines', 140);
        expect(snippet.startsWith('…')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
    });

    test('does not mark the start when it begins at the beginning', () => {
        const snippet = makeSnippet(RESUME_CHUNK, 'Farhaan Chida backend', 140);
        expect(snippet.startsWith('…')).toBe(false);
    });

    test('stays within the length budget', () => {
        for (const query of ['education', 'Docker', 'nothing here at all', 'MongoDB']) {
            const snippet = makeSnippet(RESUME_CHUNK, query, 120);
            expect(snippet.replace(/…/g, '').length).toBeLessThanOrEqual(120);
        }
    });

    test('falls back to the opening when nothing matches literally', () => {
        const snippet = makeSnippet(RESUME_CHUNK, 'zzz qqq', 100);
        expect(snippet.startsWith('Farhaan Chida')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
    });

    test('collapses runs of whitespace', () => {
        expect(makeSnippet('one\n\n   two\tthree', 'two')).toBe('one two three');
    });

    test('handles a query of only ignored words', () => {
        const snippet = makeSnippet(RESUME_CHUNK, 'what is it about', 100);
        expect(snippet.length).toBeGreaterThan(0);
        expect(snippet.startsWith('Farhaan')).toBe(true);
    });
});
