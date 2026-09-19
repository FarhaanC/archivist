import { describe, expect, test } from 'bun:test';
import { isFollowUp } from '@/llm/follow-up';

describe('isFollowUp', () => {
    /**
     * The six questions from the real test on Farhaan's own documents. Every
     * one of them names its own subject; not one of them needs the previous
     * question. Under the old length rule all six were treated as follow-ups,
     * which is the bug this function exists to fix.
     */
    test('an ordinary question that names its subject stands alone', () => {
        const selfContained = [
            'Where did I work as an AI engineer?',
            'What is the notice period in my employment contract?',
            'How much did I pay for my insurance renewal?',
            'Which university is my degree from?',
            'When does my vehicle licence expire?',
            'What does my lease say about my monthly rent?',
        ];

        for (const question of selfContained) {
            expect(isFollowUp(question)).toBe(false);
        }
    });

    test('a question that points back at something already said is a follow-up', () => {
        const followUps = [
            'And the other one?',
            'what about the freelance version',
            'the 2024 one',
            'expiry date?',
            'And the 2024 one?',
            'What about the other one',
            'the other one',
            'which of those is longer',
            'the freelance version?',
            'what about 2024',
            'show me that one',
            'is there a second one as well',
            '?',
        ];

        for (const question of followUps) {
            expect(isFollowUp(question)).toBe(true);
        }
    });

    test('punctuation and capitals make no difference', () => {
        expect(isFollowUp('AND THE OTHER ONE?!')).toBe(true);
        expect(isFollowUp('which university is my degree from')).toBe(false);
    });
});
