import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import type { ConversationRecord, MessageRecord } from '@/db/types';

/**
 * Saved conversations.
 *
 * The rule this file exists to enforce: nothing is ever removed except by an
 * explicit delete. There is no expiry, no cap on how many chats are kept, no
 * cleanup pass, and no pruning of old turns. A conversation the user did not
 * delete is still there.
 */

/** A conversation's name, taken from its first question. */
export const titleFromQuestion = (question: string, maxLength: number = 60): string => {
    const clean = question.replace(/\s+/g, ' ').trim();
    if (!clean) return 'New chat';
    if (clean.length <= maxLength) return clean;
    const cut = clean.lastIndexOf(' ', maxLength);
    return `${clean.slice(0, cut > maxLength / 2 ? cut : maxLength).trim()}…`;
};

/** Newest first. */
export const listConversations = async (): Promise<ConversationRecord[]> => {
    await ensureDbOpen();
    const all = await db.conversations.toArray();
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const createConversation = async (title: string): Promise<number> => {
    await ensureDbOpen();
    const now = Date.now();
    return (await db.conversations.add({ title, createdAt: now, updatedAt: now })) as number;
};

export const renameConversation = async (id: number, title: string): Promise<void> => {
    await ensureDbOpen();
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    await db.conversations.update(id, { title: clean, updatedAt: Date.now() });
};

/** Delete a conversation and its turns. The only thing that removes a chat. */
export const deleteConversation = async (id: number): Promise<void> => {
    await ensureDbOpen();
    await db.transaction('rw', db.conversations, db.messages, async () => {
        await db.messages.where('conversationId').equals(id).delete();
        await db.conversations.delete(id);
    });
};

/** In order. */
export const getMessages = async (conversationId: number): Promise<MessageRecord[]> => {
    await ensureDbOpen();
    const rows = await db.messages.where('conversationId').equals(conversationId).toArray();
    return rows.sort((a, b) => a.ordinal - b.ordinal);
};

export const appendMessage = async (
    message: Omit<MessageRecord, 'id' | 'ordinal' | 'createdAt'>,
): Promise<MessageRecord> => {
    await ensureDbOpen();
    const existing = await db.messages
        .where('conversationId')
        .equals(message.conversationId)
        .count();

    const row: MessageRecord = { ...message, ordinal: existing, createdAt: Date.now() };
    const id = (await db.messages.add(row)) as number;
    await db.conversations.update(message.conversationId, { updatedAt: Date.now() });
    return { ...row, id };
};

/**
 * Prior turns as the model should see them, oldest first, capped.
 *
 * The cap is about the context window, not about tidiness: these models hold
 * roughly 4,000 tokens in total and the evidence passages need most of it, so
 * only the last few turns come along. The full conversation stays on disk.
 */
export const historyForModel = (
    messages: MessageRecord[],
    maxTurns: number = 6,
): { role: 'user' | 'assistant'; content: string }[] =>
    messages
        .filter((m) => m.content.trim().length > 0)
        .slice(-maxTurns)
        .map((m) => ({ role: m.role, content: m.content }));
