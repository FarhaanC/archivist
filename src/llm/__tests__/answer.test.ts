import { describe, expect, test } from 'bun:test';
import { buildMessages, chooseQueries, historyToSend, retrievalQueries } from '@/llm/answer';
import type { ContextSource } from '@/search/context';

/** A source as the pipeline assembles it: a piece expanded with its
 *  neighbours, or a whole short document. */
const hit = (id: number, filename: string, text: string): ContextSource => ({
    docId: id,
    score: '1.50',
    text,
    filename,
    kind: 'window',
    sections: 1,
});

const evidence = [
    hit(1, 'lease.pdf', 'Either party may terminate on sixty days written notice.'),
    hit(2, 'contract.pdf', 'Resignation requires one calendar month of notice.'),
];

const inventory = 'LIBRARY INVENTORY — the user\'s library contains 2 documents:\n- lease.pdf\n- contract.pdf';

describe('buildMessages', () => {
    /**
     * The regression this file exists for. WebLLM throws SystemMessageOrderError
     * for any `system` message at an index other than 0, so a second system
     * message — the library inventory — made every answer fail before a single
     * token was generated, while retrieval carried on working. The failure was
     * caught and turned into an empty string, so the app looked like it simply
     * had nothing to say.
     */
    test('sends exactly one system message, first', () => {
        const messages = buildMessages('When can I leave?', evidence, inventory);
        const systemIndexes = messages
            .map((m, i) => (m.role === 'system' ? i : -1))
            .filter((i) => i !== -1);

        expect(systemIndexes).toEqual([0]);
    });

    test('last message is from the user', () => {
        const messages = buildMessages('When can I leave?', evidence, inventory);
        expect(messages[messages.length - 1]?.role).toBe('user');
    });

    test('folds the library inventory into the system message', () => {
        const messages = buildMessages('When can I leave?', evidence, inventory);
        expect(messages[0]?.content).toContain('LIBRARY INVENTORY');
        expect(messages[0]?.content).toContain('Use only what the excerpts say');
    });

    test('carries every evidence passage and its filename', () => {
        const messages = buildMessages('When can I leave?', evidence, inventory);
        const user = messages[1]?.content ?? '';

        expect(user).toContain('sixty days written notice');
        expect(user).toContain('one calendar month of notice');
        // Labelled by filename, in the bracket form the answer should cite —
        // numbering them invited "According to excerpt [1]" instead.
        expect(user).toContain('[lease.pdf]');
        expect(user).toContain('[contract.pdf]');
        expect(user).not.toContain('[1]');
    });

    test('puts the question last, where the model will not lose it', () => {
        const messages = buildMessages('When can I leave?', evidence, inventory);
        const user = messages[1]?.content ?? '';
        expect(user.trimEnd().endsWith('Question: When can I leave?')).toBe(true);
    });

    test('every message has non-empty string content', () => {
        const messages = buildMessages('When can I leave?', [], '');
        for (const message of messages) {
            expect(typeof message.content).toBe('string');
            expect(message.content.length).toBeGreaterThan(0);
        }
    });
});

describe('buildMessages with conversation history', () => {
    const history = [
        { role: 'user' as const, content: 'What is the notice period?' },
        { role: 'assistant' as const, content: 'Sixty days [lease.pdf].' },
    ];

    test('still sends exactly one system message, first', () => {
        const messages = buildMessages('And the contract?', evidence, inventory, history);
        const systemIndexes = messages
            .map((m, i) => (m.role === 'system' ? i : -1))
            .filter((i) => i !== -1);

        expect(systemIndexes).toEqual([0]);
    });

    test('places prior turns between the system message and the new question', () => {
        const messages = buildMessages('And the contract?', evidence, inventory, history);

        expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
        expect(messages[1]?.content).toBe('What is the notice period?');
        expect(messages[3]).toBeDefined();
        expect(messages[3]?.content).toContain('And the contract?');
    });
});

describe('retrievalQueries', () => {
    const history = [
        { role: 'user' as const, content: 'What does my 2026 resume say about education?' },
        { role: 'assistant' as const, content: 'It lists UBC Kelowna [resume.pdf].' },
    ];

    test('a self-contained question is searched on its own', () => {
        const question =
            'What does my employment contract say about the notice period if I resign?';
        expect(retrievalQueries(question, history)).toEqual([question]);
    });

    /**
     * Rewritten deliberately. This block used to assert that ANY short
     * question was searched both ways, which is exactly the behaviour that
     * turned out to be wrong: "Which university is my degree from?" is short
     * and stands perfectly well on its own. What is searched both ways is now
     * a question that points backwards — see src/llm/follow-up.ts.
     */
    test('a follow-up is searched both ways', () => {
        const followUps = [
            'And the 2024 one?',
            'What about the other one',
            'the other one',
            'which of those is longer',
            'the freelance version?',
            'what about 2024',
            'show me that one',
            '?',
        ];

        for (const question of followUps) {
            const queries = retrievalQueries(question, history);
            expect(queries).toHaveLength(2);
            expect(queries[0]).toBe(question);
            expect(queries[1]).toContain('2026 resume');
            expect(queries[1]).toContain(question);
        }
    });

    /**
     * The regression that prompted this change: an ordinary question was
     * short enough to trip the old length rule, so it was searched twice and
     * the screen announced "2 sub-questions" for a question nobody had split.
     */
    test('an ordinary question is searched once even with history behind it', () => {
        const ordinary = [
            'Where did I work as an AI engineer?',
            'How much did I pay for my insurance renewal?',
            'Which university is my degree from?',
            'When does my vehicle licence expire?',
        ];

        for (const question of ordinary) {
            expect(retrievalQueries(question, history)).toEqual([question]);
        }
    });

    test('with no history there is nothing to lean on', () => {
        expect(retrievalQueries('And the 2024 one?', [])).toEqual(['And the 2024 one?']);
    });

    test('only the most recent question is used', () => {
        const longer = [
            { role: 'user' as const, content: 'What is in my lease?' },
            { role: 'assistant' as const, content: 'A notice period [lease.pdf].' },
            ...history,
        ];
        expect(retrievalQueries('the other one', longer)[1]).toContain('2026 resume');
        expect(retrievalQueries('the other one', longer)[1]).not.toContain('lease');
    });
});

describe('chooseQueries', () => {
    test('uses the plan when the question was genuinely split', () => {
        const planned = ['lease notice period', 'contract resignation terms'];
        expect(chooseQueries(planned, ['expanded form'])).toEqual(planned);
    });

    /**
     * The bug this exists for: a follow-up of "?" was expanded for retrieval
     * into "What is in my resumes ? ?", whose two question marks made the
     * planner treat it as two questions and fan it out into four searches.
     * The planner now only ever sees the question as typed.
     */
    test('falls back to the retrieval queries when there was no plan', () => {
        expect(chooseQueries(['?'], ['?', 'What is in my resumes ?'])).toEqual([
            '?',
            'What is in my resumes ?',
        ]);
    });

    test('an empty plan still yields something to search', () => {
        expect(chooseQueries([], ['anything'])).toEqual(['anything']);
    });
});

describe('historyToSend', () => {
    const history = [
        { role: 'user' as const, content: 'What is the notice period?' },
        { role: 'assistant' as const, content: 'Thirty days [contract.pdf].' },
        { role: 'user' as const, content: 'What does my lease say about rent?' },
        { role: 'assistant' as const, content: 'Six thousand a month [lease.pdf].' },
    ];

    /**
     * The bug: asked when a vehicle licence expired, straight after a
     * question about a notice period, the model opened its answer with "The
     * excerpt does not mention the notice period in your employment
     * contract". It had been handed the whole recent conversation and
     * answered the wrong question first.
     */
    test('a question that stands alone gets a fresh start', () => {
        expect(historyToSend('When does my vehicle licence expire?', history)).toEqual([]);
    });

    test('a follow-up gets the exchange immediately before it, and no more', () => {
        const sent = historyToSend('And the other one?', history);
        expect(sent).toEqual([
            { role: 'user', content: 'What does my lease say about rent?' },
            { role: 'assistant', content: 'Six thousand a month [lease.pdf].' },
        ]);
    });

    test('an empty conversation sends nothing', () => {
        expect(historyToSend('And the other one?', [])).toEqual([]);
    });
});

describe('what the model is shown', () => {
    const history = [
        { role: 'user' as const, content: 'What is the notice period?' },
        { role: 'assistant' as const, content: 'Thirty days [contract.pdf].' },
    ];

    test('no earlier turns for a self-contained question', () => {
        const messages = buildMessages(
            'When does my vehicle licence expire?',
            evidence,
            inventory,
            historyToSend('When does my vehicle licence expire?', history),
        );

        expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
        expect(messages.map((m) => m.content).join('\n')).not.toContain('notice period?');
    });

    test('exactly the last exchange for a follow-up', () => {
        const messages = buildMessages(
            'And the other one?',
            evidence,
            inventory,
            historyToSend('And the other one?', history),
        );

        expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
        expect(messages[1]?.content).toBe('What is the notice period?');
    });
});
