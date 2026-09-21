import { describe, expect, test } from 'bun:test';
import { buildMessages } from '@/llm/answer';
import { factWords, isRepeatOf, tidyAnswer } from '@/llm/tidy-answer';

describe('tidyAnswer', () => {
    /**
     * The answer that started this: one date, said four ways. Only the
     * issue date survives alongside it, because it is a number the first
     * sentence did not have — it was not asked for, but the tidier removes
     * repeats, not extras; the prompt is what discourages extras.
     */
    test('the four-line licence answer collapses to the facts it holds', () => {
        const answer =
            'Your vehicle licence expires on 23-01-2026 [vehicle licence.jpg]. ' +
            'The expiry date of the licence is 23-01-2026 [vehicle licence.jpg]. ' +
            'The licence was issued on 16-01-2013 [vehicle licence.jpg]. ' +
            'So, according to the document, your licence expires on 23-01-2026 [vehicle licence.jpg].';

        expect(tidyAnswer(answer)).toBe(
            'Your vehicle licence expires on 23-01-2026 [vehicle licence.jpg]. ' +
                'The licence was issued on 16-01-2013 [vehicle licence.jpg].',
        );
    });

    /**
     * The rule is conservative on purpose. A restatement that brings enough
     * new wording of its own is left where it is: losing a real fact would
     * be far worse than keeping a repeat, and the prompt is the main fix.
     */
    test('a restatement with mostly new words is left alone', () => {
        const answer =
            'Your licence expires on 23-01-2026 [licence.jpg]. It remains valid until then [licence.jpg].';
        expect(tidyAnswer(answer)).toBe(answer);
    });

    test('two genuinely different facts are left alone', () => {
        const answer =
            'You worked as a Junior AI Engineer at Disrupt-X FZCO [experience letter.pdf]. ' +
            'Your degree is from the University of British Columbia [degree.pdf].';
        expect(tidyAnswer(answer)).toBe(answer);
    });

    test('the two notice rules are different numbers, so both stay', () => {
        const answer =
            'During probation the notice period is seven days [contract.pdf].\n\n' +
            'After probation the notice period is thirty days [contract.pdf].';
        expect(tidyAnswer(answer)).toBe(answer);
    });

    test('a second date is news even when the words around it repeat', () => {
        const answer =
            'The licence expires on 23-12-2025 [licence.jpg]. The insurance expires on 23-01-2026 [licence.jpg].';
        expect(tidyAnswer(answer)).toBe(answer);
    });

    test('a citation split from its sentence travels with it', () => {
        const answer =
            'The renewal cost AED 1,496.25. [receipt.pdf] The renewal cost was AED 1,496.25. [receipt.pdf]';
        expect(tidyAnswer(answer)).toBe('The renewal cost AED 1,496.25. [receipt.pdf]');
    });

    test('paragraph breaks between kept sentences survive', () => {
        const answer =
            'The notice period is seven days [contract.pdf].\n\n' +
            'That is, seven days of notice [contract.pdf].\n\n' +
            'Holidays are one month a year [contract.pdf].';
        expect(tidyAnswer(answer)).toBe(
            'The notice period is seven days [contract.pdf].\n\nHolidays are one month a year [contract.pdf].',
        );
    });

    test('a repeat at the end of a paragraph does not merge the paragraphs', () => {
        const answer = 'Rent is AED 5,000 a month [lease.pdf]. The monthly rent is AED 5,000 [lease.pdf].\n\nPaid in four cheques [lease.pdf].';
        expect(tidyAnswer(answer)).toBe('Rent is AED 5,000 a month [lease.pdf].\n\nPaid in four cheques [lease.pdf].');
    });

    test('a refusal is untouched', () => {
        const answer = 'There is no mention of a lease in the provided excerpts.';
        expect(tidyAnswer(answer)).toBe(answer);
    });

    test('an empty answer stays empty, and a single sentence is never dropped', () => {
        expect(tidyAnswer('')).toBe('');
        expect(tidyAnswer('Seven days [contract.pdf].')).toBe('Seven days [contract.pdf].');
    });

    test('a repeat that is the last sentence goes cleanly', () => {
        expect(tidyAnswer('The degree is from UBC [degree.pdf]. Your degree is from UBC [degree.pdf].')).toBe(
            'The degree is from UBC [degree.pdf].',
        );
    });
});

describe('isRepeatOf', () => {
    test('needs most of the words and every number to have been said', () => {
        expect(isRepeatOf(factWords('The licence expires 23-12-2025'), factWords('Your licence expires on 23-12-2025'))).toBe(true);
        expect(isRepeatOf(factWords('The licence expires 23-01-2026'), factWords('Your licence expires on 23-12-2025'))).toBe(false);
        expect(isRepeatOf(new Set(), factWords('anything'))).toBe(false);
    });

    test('inflections of a word count as the same word', () => {
        expect(factWords('expiry expires expiration')).toEqual(new Set(['expir']));
    });
});

describe('the prompt', () => {
    test('tells the model to say each fact once', () => {
        const [system] = buildMessages('q', [], '');
        expect(system?.content).toContain('Say each fact once.');
    });
});
