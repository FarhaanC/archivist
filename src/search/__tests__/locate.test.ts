import { describe, expect, test } from 'bun:test';
import { evidenceWords, findSupportingSentence, findSupportingSentences, splitSentences } from '@/search/locate';

const CONTRACT =
    'This contract begins on 01 October 2025 and ends on 30 September 2027 until further notice. ' +
    'I also agree that the company has the right to take disciplinary measures including termination of contract in case of ill-behaviour. ' +
    'Probation Clause: the company will hire employees based on the contracts given. ' +
    'First three months of contract are probation for employees. ' +
    'During this period both the company and Employee have the option to terminate the contract with Seven-day Notice. ' +
    'The Employee dues will be immediately paid upon completion of handover. ' +
    'Post three months of contract the company and Employees have the option to terminate the contract or resign with Thirty (30) days Notice.';

const RECEIPT =
    'Telr Secure Payments\nAl Ittihad Al Watani General Insurance\nTotal : AED 1,496.25\nDescription: Renewal DXB-MVA-2024- 15134\nTransaction completed';

const slice = (text: string, range: { start: number; end: number } | null): string =>
    range ? text.slice(range.start, range.end) : '';

describe('splitSentences', () => {
    test('splits on sentence ends and line breaks, keeping positions', () => {
        const sentences = splitSentences('One here. Two here!\nThree here');
        expect(sentences.map((s) => s.text)).toEqual(['One here.', 'Two here!', 'Three here']);
        for (const s of sentences) expect('One here. Two here!\nThree here'.slice(s.start, s.end)).toBe(s.text);
    });

    test('handles runs of terminators and a trailing sentence', () => {
        expect(splitSentences('Really?! Yes... fine').map((s) => s.text)).toEqual(['Really?!', 'Yes...', 'fine']);
    });

    test('does not split on a decimal point', () => {
        expect(splitSentences('Total AED 1,496.25 paid').map((s) => s.text)).toEqual(['Total AED 1,496.25 paid']);
    });
});

describe('evidenceWords', () => {
    test('keeps numbers, amounts and short capitals, drops filler and citations', () => {
        expect(evidenceWords('The notice period is Seven days. [contract.pdf]')).toEqual(['notice', 'period', 'seven', 'day']);
        expect(evidenceWords('Total: AED 1,496.25')).toEqual(['total', 'aed', '1496.25']);
    });
});

describe('findSupportingSentences', () => {
    test('an answer with two conditions marks both sentences', () => {
        const ranges = findSupportingSentences(
            CONTRACT,
            'Seven days during the first three months of probation, and thirty (30) days after that.',
            'What is the notice period?',
        );
        const texts = ranges.map((r) => slice(CONTRACT, r));
        expect(texts.some((t) => t.includes('Seven-day Notice'))).toBe(true);
        expect(texts.some((t) => t.includes('Thirty (30) days Notice'))).toBe(true);
    });

    test('a one-part answer marks one sentence', () => {
        const ranges = findSupportingSentences(RECEIPT, 'You paid AED 1,496.25.', 'How much did I pay?');
        expect(ranges).toHaveLength(1);
    });
});

describe('findSupportingSentence', () => {
    test('the notice-period case: points at the seven-day sentence, not the first "notice"', () => {
        const range = findSupportingSentence(CONTRACT, 'The notice period is Seven days.', 'What is the notice period in my employment contract?');
        expect(slice(CONTRACT, range)).toContain('Seven-day Notice');
    });

    test('a number in the answer wins outright', () => {
        const range = findSupportingSentence(RECEIPT, 'You paid AED 1,496.25 for the renewal.', 'How much did I pay?');
        expect(slice(RECEIPT, range)).toBe('Total : AED 1,496.25');
    });

    test('falls back to the question when the answer matches nothing', () => {
        const range = findSupportingSentence(CONTRACT, 'The excerpt does not mention it.', 'What does the contract say about probation?');
        expect(slice(CONTRACT, range).toLowerCase()).toContain('probation');
    });

    test('returns null when neither the answer nor the question matches', () => {
        expect(findSupportingSentence(CONTRACT, 'Nothing relevant here.', 'lease rent?')).toBeNull();
    });

    test('one shared ordinary word is not support', () => {
        const range = findSupportingSentence(CONTRACT, 'The employee is happy.', '');
        expect(range).toBeNull();
    });
});
