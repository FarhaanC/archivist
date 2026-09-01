/**
 * Usage memory — the agents' feedback loop into the library brain.
 * Tracks how this user actually works: what they ask about, which documents
 * end up answering, and where search keeps failing. A compact profile is fed
 * back into query planning and the search coach.
 * Stored locally (localStorage); nothing leaves the device.
 */

const KEY = 'archivist-usage-memory';

interface UsageMemory {
    /** term -> times asked about */
    topicCounts: Record<string, number>;
    /** doc title -> times used as evidence in an answer */
    evidenceDocCounts: Record<string, number>;
    /** questions where the coach fired (failed turns), newest first */
    failedQuestions: string[];
    updatedAt: number;
}

const load = (): UsageMemory => {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw) as UsageMemory;
    } catch { /* corrupted -> reset */ }
    return { topicCounts: {}, evidenceDocCounts: {}, failedQuestions: [], updatedAt: 0 };
};

const save = (m: UsageMemory): void => {
    m.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* full -> skip */ }
};

const cap = (rec: Record<string, number>, max: number): Record<string, number> => {
    const entries = Object.entries(rec);
    if (entries.length <= max) return rec;
    return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, max));
};

export const recordQuery = (query: string, stopWords: Set<string>): void => {
    const m = load();
    for (const w of query.toLowerCase().split(/[^\p{L}\p{N}-]+/u)) {
        if (w.length > 2 && !stopWords.has(w)) {
            m.topicCounts[w] = (m.topicCounts[w] ?? 0) + 1;
        }
    }
    m.topicCounts = cap(m.topicCounts, 200);
    save(m);
};

export const recordEvidenceDocs = (titles: string[]): void => {
    const m = load();
    for (const t of new Set(titles)) {
        m.evidenceDocCounts[t] = (m.evidenceDocCounts[t] ?? 0) + 1;
    }
    m.evidenceDocCounts = cap(m.evidenceDocCounts, 100);
    save(m);
};

export const recordFailedQuestion = (question: string): void => {
    const m = load();
    m.failedQuestions = [question, ...m.failedQuestions.filter((q) => q !== question)].slice(0, 20);
    save(m);
};

/**
 * Compact one-paragraph profile of how this user works, for injection into
 * planner / coach prompts. Empty string until enough signal exists.
 */
export const getUserProfileSummary = (): string => {
    const m = load();
    const topTopics = Object.entries(m.topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([w]) => w);
    const topDocs = Object.entries(m.evidenceDocCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t]) => t);
    if (topTopics.length < 3 && topDocs.length < 2) return '';

    const parts: string[] = [];
    if (topTopics.length) parts.push(`The user frequently asks about: ${topTopics.join(', ')}.`);
    if (topDocs.length) parts.push(`Documents that most often answer their questions: ${topDocs.join('; ')}.`);
    return parts.join(' ');
};
