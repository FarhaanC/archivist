import { describe, expect, test } from 'bun:test';
import { buildMessages, retrievalQuery } from '@/llm/answer';
import type { SearchResult } from '@/search/types';

const hit = (id: number, filename: string, text: string): SearchResult => ({
    id,
    docId: id,
    score: '1.50',
    text,
    filename,
    debug: { vector: '0.5', keyword: '0.5' },
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
        expect(messages[0]?.content).toContain('answer questions using ONLY the excerpts');
    });

    test('carries every evidence passage and its filename', () => {
        const messages = buildMessages('When can I leave?', evidence, inventory);
        const user = messages[1]?.content ?? '';

        expect(user).toContain('sixty days written notice');
        expect(user).toContain('one calendar month of notice');
        expect(user).toContain('(lease.pdf)');
        expect(user).toContain('(contract.pdf)');
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

describe('retrievalQuery', () => {
    const history = [
        { role: 'user' as const, content: 'What does my 2026 resume say about education?' },
        { role: 'assistant' as const, content: 'It lists UBC Kelowna [resume.pdf].' },
    ];

    test('leaves a self-contained question alone', () => {
        const question = 'What does my lease say about subletting the flat?';
        expect(retrievalQuery(question, history)).toBe(question);
    });

    test('carries the previous question into a bare follow-up', () => {
        // "and the 2024 one?" has nothing for an index to match on.
        const expanded = retrievalQuery('And the 2024 one?', history);
        expect(expanded).toContain('2026 resume');
        expect(expanded).toContain('2024');
    });

    test('a follow-up with no history is searched as written', () => {
        expect(retrievalQuery('And the 2024 one?', [])).toBe('And the 2024 one?');
    });
});
