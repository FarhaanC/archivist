import { describe, test, expect, beforeEach } from 'bun:test';

// localStorage stub for the bun test environment
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
};

const { recordQuery, recordEvidenceDocs, recordFailedQuestion, getUserProfileSummary } =
    await import('../usage-memory');

const STOP = new Set(['the', 'what', 'is', 'are', 'for']);

describe('usage memory', () => {
    beforeEach(() => store.clear());

    test('no profile until there is enough signal', () => {
        expect(getUserProfileSummary()).toBe('');
        recordQuery('what is the bluetooth range', STOP);
        expect(getUserProfileSummary()).toBe('');
    });

    test('builds a profile from repeated topics and evidence docs', () => {
        for (let i = 0; i < 3; i++) {
            recordQuery('bluetooth beacon battery specs', STOP);
            recordEvidenceDocs(['M3 Spec.pdf', 'LW003 Guide.pdf']);
        }
        const profile = getUserProfileSummary();
        expect(profile).toContain('bluetooth');
        expect(profile).toContain('M3 Spec.pdf');
    });

    test('failed questions are tracked most-recent-first without duplicates', () => {
        recordFailedQuestion('what is the downlink?');
        recordFailedQuestion('battery life?');
        recordFailedQuestion('what is the downlink?');
        const raw = JSON.parse(store.get('archivist-usage-memory') ?? '{}');
        expect(raw.failedQuestions[0]).toBe('what is the downlink?');
        expect(raw.failedQuestions).toHaveLength(2);
    });

    test('survives corrupted storage', () => {
        store.set('archivist-usage-memory', '{not json');
        expect(getUserProfileSummary()).toBe('');
        recordQuery('bluetooth beacon battery test query', STOP);
        expect(store.get('archivist-usage-memory')).toBeTruthy();
    });
});
