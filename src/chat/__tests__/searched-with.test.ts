import { describe, expect, test } from 'bun:test';
import {
    describeSearch,
    searchDetail,
    searchedWithOf,
    searchHeading,
} from '@/chat/searched-with';

describe('describeSearch', () => {
    test('one search is not worth mentioning', () => {
        expect(describeSearch(['what is my notice period'], false)).toBeNull();
    });

    test('a split question is recorded as a split', () => {
        const searched = describeSearch(['my notice period', 'when my lease ends'], false);
        expect(searched?.kind).toBe('multi-part');
    });

    test('an expansion of a follow-up is recorded as a follow-up', () => {
        const searched = describeSearch(['and the 2024 one?', 'my resume and the 2024 one?'], true);
        expect(searched?.kind).toBe('follow-up');
    });
});

describe('searchHeading', () => {
    test('a split says how many questions it became', () => {
        expect(searchHeading({ kind: 'multi-part', queries: ['a b c', 'd e f'] })).toBe(
            'Searched as 2 separate questions',
        );
    });

    /** The old wording called this a sub-question, which it never was. */
    test('a follow-up says it was searched with the previous question', () => {
        const heading = searchHeading({ kind: 'follow-up', queries: ['x', 'y x'] });
        expect(heading).toBe('Also searched together with your previous question');
        expect(heading).not.toContain('sub-question');
    });
});

describe('searchDetail', () => {
    test('a split shows every question it became', () => {
        expect(searchDetail({ kind: 'multi-part', queries: ['a', 'b'] })).toEqual(['a', 'b']);
    });

    test('a follow-up shows only the combined question', () => {
        expect(searchDetail({ kind: 'follow-up', queries: ['the 2024 one', 'my resume the 2024 one'] })).toEqual([
            'my resume the 2024 one',
        ]);
    });
});

describe('searchedWithOf', () => {
    test('uses what the answer recorded', () => {
        const searched = searchedWithOf({ searchedWith: { kind: 'follow-up', queries: ['a', 'b a'] } });
        expect(searched?.kind).toBe('follow-up');
    });

    /**
     * Answers saved before the reason was recorded cannot be told apart —
     * a split or a follow-up — so they say nothing rather than guess.
     */
    test('an older answer with only a query list says nothing', () => {
        expect(searchedWithOf({ subQueries: ['a', 'b'] })).toBeNull();
    });

    test('a question searched exactly as typed says nothing', () => {
        expect(searchedWithOf({})).toBeNull();
        expect(searchedWithOf({ subQueries: ['only one'] })).toBeNull();
    });
});
