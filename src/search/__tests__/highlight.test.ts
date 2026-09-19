import { describe, expect, test } from 'bun:test';
import { highlight } from '@/search/highlight';

const PASSAGE =
    '…front-end integration Education University of British Columbia Kelowna, Canada 2021–2025 BSc, Computer Science…';

const rebuild = (query: string, text: string = PASSAGE): string =>
    highlight(text, query)
        .map((s) => s.text)
        .join('');

const marked = (query: string, text: string = PASSAGE): string[] =>
    highlight(text, query)
        .filter((s) => s.match)
        .map((s) => s.text);

describe('highlight', () => {
    test('marks the words the question asked about', () => {
        expect(marked('What does my resume say about education at university?')).toEqual([
            'Education',
            'University',
        ]);
    });

    test('never alters the text it is given', () => {
        for (const query of ['education university', 'nothing here', '', 'BSc Computer Science']) {
            expect(rebuild(query)).toBe(PASSAGE);
        }
    });

    test('ignores filler words, which would mark half the passage', () => {
        // "of", "my", "the", "what", "does", "about" are all in the passage.
        expect(marked('what does my education say about the university')).toEqual([
            'Education',
            'University',
        ]);
    });

    test('matches regardless of case', () => {
        expect(marked('EDUCATION')).toEqual(['Education']);
    });

    test('matches across singular and plural, both ways round', () => {
        expect(marked('resumes', 'My resume lists two roles.')).toEqual(['resume']);
        expect(marked('resume', 'My resumes list two roles.')).toEqual(['resumes']);
    });

    test('matches whole words only', () => {
        expect(marked('science', 'Computer Sciences and pseudoscience')).toEqual(['Sciences']);
    });

    test('a query of only filler marks nothing', () => {
        expect(marked('what is it about')).toEqual([]);
        expect(rebuild('what is it about')).toBe(PASSAGE);
    });

    test('empty text produces nothing to render', () => {
        expect(highlight('', 'education')).toEqual([]);
    });

    test('handles a query containing regular-expression characters', () => {
        expect(() => highlight('a (b) [c] *d*', 'education')).not.toThrow();
        expect(rebuild('C++ (2021) [draft]')).toBe(PASSAGE);
    });

    test('marks several occurrences of the same word', () => {
        expect(marked('education', 'Education first, education again.')).toEqual([
            'Education',
            'education',
        ]);
    });
});
