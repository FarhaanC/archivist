import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import { STOP_WORDS } from '@/search/constants';

/**
 * The library brain's per-document knowledge profile.
 * Built at upload time (no LLM needed), stored on the document record:
 *   - topics: most characteristic terms of the document
 *   - wordCount
 *   - similarToDocId / diffSummary: relationship to a near-duplicate
 * These profiles power the enriched LIBRARY INVENTORY the AI plans with.
 */

export interface DocProfile {
    topics: string[];
    wordCount: number;
}

export const buildDocProfile = (text: string): DocProfile => {
    const words = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

    const topics = [...freq.entries()]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([w]) => w);

    return { topics, wordCount: words.length };
};

export const saveDocProfile = async (docId: number, profile: DocProfile): Promise<void> => {
    await ensureDbOpen();
    await db.documents.update(docId, { profile } as never);
};

export interface InventoryLine {
    title: string;
    topics?: string[];
    diffSummary?: string;
    similarTitle?: string;
}

/**
 * Enriched inventory for the AI: titles + what each document is about +
 * known near-duplicate relationships (including the actual differences).
 */
export const buildEnrichedInventory = async (): Promise<InventoryLine[]> => {
    await ensureDbOpen();
    const docs = await db.documents.toArray();
    const byId = new Map(docs.map((d) => [d.id ?? 0, d]));
    return docs.map((d) => {
        const rec = d as {
            title: string;
            profile?: DocProfile;
            similarToDocId?: number;
            diffSummary?: string;
        };
        const line: InventoryLine = { title: rec.title };
        if (rec.profile?.topics?.length) line.topics = rec.profile.topics;
        if (rec.similarToDocId) {
            const other = byId.get(rec.similarToDocId);
            if (other) line.similarTitle = other.title;
            if (rec.diffSummary) line.diffSummary = rec.diffSummary;
        }
        return line;
    });
};

export const formatInventoryChunk = (lines: InventoryLine[], maxDocs: number = 60): string => {
    const body = lines
        .slice(0, maxDocs)
        .map((l) => {
            let s = `- ${l.title}`;
            if (l.topics?.length) s += ` [topics: ${l.topics.join(', ')}]`;
            if (l.similarTitle) {
                s += ` [near-duplicate of "${l.similarTitle}"${l.diffSummary ? ` — differs: ${l.diffSummary}` : ''}]`;
            }
            return s;
        })
        .join('\n');
    return `LIBRARY INVENTORY — the user's library contains ${lines.length} documents:\n${body}`;
};
