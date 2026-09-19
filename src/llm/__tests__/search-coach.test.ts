import { describe, expect, test } from 'bun:test';
import { looksLikeRefusal } from '@/llm/search-coach';

describe('looksLikeRefusal', () => {
    /**
     * The one that got through. Asked "When did I work at Concert IDC?", with
     * "Concert IDC · Aug 2023 – Apr 2024" highlighted in the evidence beside
     * it, the model answered this — and the coach stayed silent, because it
     * was watching for "cannot answer" and got "cannot provide".
     */
    test('catches the phrasing that slipped through', () => {
        expect(
            looksLikeRefusal(
                'I cannot provide a direct answer to the question of when you worked at Concert IDC.',
            ),
        ).toBe(true);
    });

    test('catches the usual ways a model gives up', () => {
        const refusals = [
            'I cannot answer that from the excerpts.',
            "I can't determine the notice period from these documents.",
            'I am unable to find that information.',
            "I don't have enough information to answer.",
            'The excerpts do not contain the answer.',
            'The provided documents do not mention a salary.',
            'That is not specified in the excerpts.',
            'Nothing in the passages covers this.',
            'There is no relevant information about a master’s degree.',
            'Unable to determine the start date.',
        ];
        for (const answer of refusals) {
            expect(looksLikeRefusal(answer)).toBe(true);
        }
    });

    /**
     * The failure that matters more than a missed refusal: treating a real
     * answer as one. "You cannot end the lease early" is an answer, and
     * flagging it would tell the user their working search had failed.
     */
    test('does not fire on real answers containing "cannot"', () => {
        const answers = [
            'You cannot end the lease early without sixty days notice [lease.pdf].',
            'The contract says you can not transfer the licence [contract.pdf].',
            'You worked at Concert IDC from Aug 2023 to Apr 2024 [resume.pdf].',
            'Your degree is a BSc in Computer Science from UBC [resume.pdf].',
            'The policy does not contain an exception for weekends, so it applies [policy.pdf].',
        ];
        for (const answer of answers) {
            expect(looksLikeRefusal(answer)).toBe(false);
        }
    });

    test('an empty answer is not a refusal — it is a different failure', () => {
        expect(looksLikeRefusal('')).toBe(false);
    });
});
