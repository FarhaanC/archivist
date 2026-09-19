import { beforeEach, describe, expect, test } from 'bun:test';
import { db } from '@/db/get-db';
import {
    buildSources,
    chooseSources,
    joinChunks,
    neighbourOrdinals,
    shouldSendWhole,
    WHOLE_DOCUMENT_LIMIT,
} from '@/search/context';
import type { SearchResult } from '@/search/types';

const hit = (id: number, docId: number, filename: string, text: string): SearchResult => ({
    id,
    docId,
    score: '1.50',
    text,
    filename,
    debug: { vector: '0.7', keyword: '0.6' },
});

describe('chooseSources', () => {
    test('takes one source per document, best match first', () => {
        const results = [
            hit(1, 10, 'a.pdf', 'first'),
            hit(2, 10, 'a.pdf', 'second from the same file'),
            hit(3, 11, 'b.pdf', 'other file'),
        ];
        expect(chooseSources(results, 3).map((r) => r.id)).toEqual([1, 3]);
    });

    test('caps how many documents are sent', () => {
        const results = [1, 2, 3, 4, 5].map((n) => hit(n, n, `${n}.pdf`, 'text'));
        expect(chooseSources(results, 3)).toHaveLength(3);
    });

    test('nothing matched means nothing to send', () => {
        expect(chooseSources([], 3)).toEqual([]);
    });
});

describe('neighbourOrdinals', () => {
    test('takes the piece either side', () => {
        expect(neighbourOrdinals(5, 1)).toEqual([4, 5, 6]);
    });

    test('does not ask for pieces before the start of a document', () => {
        expect(neighbourOrdinals(0, 1)).toEqual([0, 1]);
    });

    test('a wider radius takes more', () => {
        expect(neighbourOrdinals(3, 2)).toEqual([1, 2, 3, 4, 5]);
    });
});

describe('shouldSendWhole', () => {
    test('a CV-sized document goes whole', () => {
        expect(shouldSendWhole(4200)).toBe(true);
    });

    test('a long document does not', () => {
        expect(shouldSendWhole(WHOLE_DOCUMENT_LIMIT + 1)).toBe(false);
    });

    test('an empty document is not worth sending', () => {
        expect(shouldSendWhole(0)).toBe(false);
    });
});

describe('joinChunks', () => {
    test('puts pieces back in document order', () => {
        const text = joinChunks([
            { ordinal: 2, text: 'third part.' },
            { ordinal: 0, text: 'First part.' },
            { ordinal: 1, text: 'second part,' },
        ]);
        expect(text).toBe('First part. second part, third part.');
    });

    /**
     * Chunks are stored with an overlap so a fact spanning a boundary stays
     * findable from either side. Joined naively that overlap is read twice.
     */
    test('does not repeat the overlap between consecutive pieces', () => {
        const tail = 'Education University of British Columbia Kelowna Canada';
        const joined = joinChunks([
            { ordinal: 0, text: `Docker CI CD pipelines Git code review ${tail}` },
            { ordinal: 1, text: `${tail} 2021 2025 BSc Computer Science` },
        ]);

        expect(joined).toBe(
            'Docker CI CD pipelines Git code review Education University of British Columbia Kelowna Canada 2021 2025 BSc Computer Science',
        );
        expect(joined.match(/Kelowna/g)).toHaveLength(1);
    });

    test('skips empty pieces', () => {
        expect(joinChunks([{ ordinal: 0, text: 'only this' }, { ordinal: 1, text: '  ' }])).toBe(
            'only this',
        );
    });

    test('nothing in, nothing out', () => {
        expect(joinChunks([])).toBe('');
    });
});

describe('buildSources', () => {
    beforeEach(async () => {
        await db.chunks.clear();
        await db.documents.clear();
    });

    /**
     * The failure this whole module exists for. The employer sits in the piece
     * above the dates, so the matched piece alone gives the model dates with
     * no employer — and it borrows a name from elsewhere.
     */
    test('a long document sends the matched piece with its neighbours', async () => {
        const docId = (await db.documents.add({
            title: 'long-cv.pdf',
            fullText: 'x'.repeat(WHOLE_DOCUMENT_LIMIT + 500),
            uploadedAt: Date.now(),
        })) as number;

        await db.chunks.bulkAdd([
            { docId, ordinal: 0, text: 'Disrupt X, Dubai. AI Engineering', vector: [] },
            { docId, ordinal: 1, text: 'Intern Jun 2024 - Jul 2025.', vector: [] },
            { docId, ordinal: 2, text: 'Built voice agent prototypes.', vector: [] },
            { docId, ordinal: 3, text: 'Unrelated later section.', vector: [] },
        ]);

        const matched = await db.chunks.where({ docId, ordinal: 1 }).first();
        const sources = await buildSources([
            hit(matched?.id as number, docId, 'long-cv.pdf', 'Intern Jun 2024 - Jul 2025.'),
        ]);

        expect(sources).toHaveLength(1);
        expect(sources[0]?.kind).toBe('window');
        // The employer arrives with the dates, which is the entire point.
        expect(sources[0]?.text).toContain('Disrupt X');
        expect(sources[0]?.text).toContain('Jun 2024 - Jul 2025');
        expect(sources[0]?.text).toContain('voice agent');
        // …and the unrelated section two pieces away does not.
        expect(sources[0]?.text).not.toContain('Unrelated later section');
    });

    test('a short document is sent whole, with no boundaries at all', async () => {
        const fullText =
            'Farhaan Chida. Experience: Concert IDC, Aug 2023 - Apr 2024, Software Engineering Intern. Education: UBC Kelowna, 2021-2025.';
        const docId = (await db.documents.add({
            title: 'cv.pdf',
            fullText,
            uploadedAt: Date.now(),
        })) as number;
        await db.chunks.add({ docId, ordinal: 0, text: 'Education: UBC Kelowna', vector: [] });

        const matched = await db.chunks.where({ docId }).first();
        const sources = await buildSources([
            hit(matched?.id as number, docId, 'cv.pdf', 'Education: UBC Kelowna'),
        ]);

        expect(sources[0]?.kind).toBe('whole-document');
        expect(sources[0]?.text).toBe(fullText);
    });

    test('falls back to the matched piece when the store has nothing to add', async () => {
        const sources = await buildSources([hit(999, 999, 'gone.pdf', 'the matched text')]);

        expect(sources).toHaveLength(1);
        expect(sources[0]?.text).toBe('the matched text');
        expect(sources[0]?.kind).toBe('window');
    });

    test('nothing matched produces nothing to send', async () => {
        expect(await buildSources([])).toEqual([]);
    });
});
