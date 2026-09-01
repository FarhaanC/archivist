import { db } from '@/db/get-db';

/**
 * Dexie opens lazily, which makes the first query after a cold start racy —
 * and in tests there is no browser to open it at all. Every entry point that
 * touches the store awaits this first.
 */
export const ensureDbOpen = async (): Promise<void> => {
    if (db.isOpen()) return;
    await db.open();
};
