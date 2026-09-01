import { beforeEach, describe, expect, test } from 'bun:test';
import { db } from '@/db/get-db';
import {
    appendMessage,
    createConversation,
    deleteConversation,
    getMessages,
    historyForModel,
    listConversations,
    renameConversation,
    titleFromQuestion,
} from '@/chat/store';
import type { MessageRecord } from '@/db/types';

beforeEach(async () => {
    await db.messages.clear();
    await db.conversations.clear();
});

describe('titleFromQuestion', () => {
    test('uses the question when it is short', () => {
        expect(titleFromQuestion('What is my notice period?')).toBe('What is my notice period?');
    });

    test('truncates on a word boundary', () => {
        const title = titleFromQuestion(
            'What does my employment contract say about the notice period if I resign',
            30,
        );
        expect(title.endsWith('…')).toBe(true);
        expect(title.replace('…', '').split(' ').pop()).not.toBe('');
        expect(title.length).toBeLessThanOrEqual(31);
    });

    test('never produces an empty name', () => {
        expect(titleFromQuestion('   ')).toBe('New chat');
    });
});

describe('conversation storage', () => {
    test('a conversation survives being written and read back', async () => {
        const id = await createConversation('First chat');
        await appendMessage({ conversationId: id, role: 'user', content: 'Hello?' });
        await appendMessage({ conversationId: id, role: 'assistant', content: 'Hi.' });

        const messages = await getMessages(id);
        expect(messages.map((m) => m.content)).toEqual(['Hello?', 'Hi.']);
        expect(messages.map((m) => m.ordinal)).toEqual([0, 1]);
    });

    test('lists newest first', async () => {
        const older = await createConversation('Older');
        await new Promise((resolve) => setTimeout(resolve, 5));
        const newer = await createConversation('Newer');

        const listed = await listConversations();
        expect(listed.map((c) => c.id)).toEqual([newer, older]);
    });

    test('a new message moves its conversation to the top', async () => {
        const first = await createConversation('First');
        await new Promise((resolve) => setTimeout(resolve, 5));
        await createConversation('Second');
        await new Promise((resolve) => setTimeout(resolve, 5));

        await appendMessage({ conversationId: first, role: 'user', content: 'still here' });
        const listed = await listConversations();
        expect(listed[0]?.id).toBe(first);
    });

    test('renaming keeps the messages', async () => {
        const id = await createConversation('Old name');
        await appendMessage({ conversationId: id, role: 'user', content: 'kept' });

        await renameConversation(id, 'New name');
        const listed = await listConversations();

        expect(listed[0]?.title).toBe('New name');
        expect((await getMessages(id)).length).toBe(1);
    });

    test('renaming to blank is ignored rather than wiping the name', async () => {
        const id = await createConversation('Real name');
        await renameConversation(id, '   ');
        expect((await listConversations())[0]?.title).toBe('Real name');
    });

    /**
     * The guarantee that matters most here: chats are only ever removed by an
     * explicit delete, and deleting one leaves every other chat alone.
     */
    test('nothing disappears except what is explicitly deleted', async () => {
        const keep = await createConversation('Keep me');
        const drop = await createConversation('Delete me');
        await appendMessage({ conversationId: keep, role: 'user', content: 'safe' });
        await appendMessage({ conversationId: drop, role: 'user', content: 'doomed' });

        await deleteConversation(drop);

        expect((await listConversations()).map((c) => c.id)).toEqual([keep]);
        expect((await getMessages(keep)).map((m) => m.content)).toEqual(['safe']);
        expect(await getMessages(drop)).toEqual([]);
    });

    test('many turns all persist', async () => {
        const id = await createConversation('Long one');
        for (let i = 0; i < 40; i++) {
            await appendMessage({ conversationId: id, role: 'user', content: `q${i}` });
        }
        expect((await getMessages(id)).length).toBe(40);
    });
});

describe('historyForModel', () => {
    const turn = (role: 'user' | 'assistant', content: string): MessageRecord => ({
        conversationId: 1,
        ordinal: 0,
        role,
        content,
        createdAt: 0,
    });

    test('keeps only the most recent turns, oldest first', () => {
        const messages = Array.from({ length: 12 }, (_, i) =>
            turn(i % 2 === 0 ? 'user' : 'assistant', `m${i}`),
        );
        const history = historyForModel(messages, 4);

        expect(history.map((h) => h.content)).toEqual(['m8', 'm9', 'm10', 'm11']);
    });

    test('drops empty turns, which would confuse the template', () => {
        const history = historyForModel([turn('user', 'real'), turn('assistant', '   ')]);
        expect(history).toEqual([{ role: 'user', content: 'real' }]);
    });
});
