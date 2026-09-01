import { describe, expect, test } from 'bun:test';
import { filterSubQueries, looksMultiPart } from '@/llm/decompose-query';

describe('looksMultiPart', () => {
    test('leaves ordinary single questions alone', () => {
        const singles = [
            'Ok what does it say about my resumes?',
            'What is the notice period?',
            'When does my lease end',
            'Summarise the Concert IDC internship',
            'Which file mentions MongoDB',
        ];
        for (const q of singles) {
            expect(looksMultiPart(q)).toBe(false);
        }
    });

    test('splits questions that genuinely span two things', () => {
        const multis = [
            'Compare the LW003 gateway range with the M3 beacon power',
            'How do my lease notice period and my contract resignation terms interact',
            'What is the difference between the 2024 and 2026 resumes',
            'React vs Vue in my notes',
            'What did I do at Concert IDC? What did I do at Disrupt X?',
        ];
        for (const q of multis) {
            expect(looksMultiPart(q)).toBe(true);
        }
    });
});

describe('filterSubQueries', () => {
    const original = 'Ok what does it say about my resumes?';
    const titles = ['Farhaan_Chida_AI_ML_Engineer.pdf', 'Farhaan Chida_Software Engineer_2026.pdf'];

    /**
     * The exact output the 3B planner produced in the wild. Not one of these is
     * answerable from a library of the user's own files.
     */
    test('rejects generic advice queries the library cannot contain', () => {
        const junk = [
            'resume writing tips',
            'resume examples for software engineer',
            'resume templates for entry level',
            'resume writing for beginners',
        ];
        expect(filterSubQueries(original, junk, titles)).toEqual([]);
    });

    test('keeps sub-queries that share wording with the question', () => {
        const good = ['resume notice period', 'resume education section'];
        expect(filterSubQueries(original, good, titles)).toEqual(good);
    });

    test('keeps sub-queries that name something in the library', () => {
        const kept = filterSubQueries(
            'What did I do there?',
            ['Concert IDC internship responsibilities'],
            ['Concert IDC offer letter.pdf'],
        );
        expect(kept).toEqual(['Concert IDC internship responsibilities']);
    });

    test('drops sub-queries about something entirely unrelated', () => {
        expect(filterSubQueries(original, ['bluetooth scan duration'], titles)).toEqual([]);
    });

    test('allows advice wording when the user asked for advice', () => {
        const kept = filterSubQueries(
            'What tips does my mentor doc give about resumes?',
            ['resume tips'],
            titles,
        );
        expect(kept).toEqual(['resume tips']);
    });

    test('drops empty and over-long candidates', () => {
        expect(filterSubQueries(original, ['', 'ab', 'resume '.repeat(60)], titles)).toEqual([]);
    });
});
