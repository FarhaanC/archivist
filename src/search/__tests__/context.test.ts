import { beforeEach, describe, expect, test } from 'bun:test';
import { db } from '@/db/get-db';
import {
    buildSources,
    chooseSources,
    extraSections,
    groupRuns,
    joinChunks,
    neighbourOrdinals,
    SECTION_GAP,
    shouldSendWhole,
    WHOLE_DOCUMENT_LIMIT,
} from '@/search/context';
import type { SearchResult } from '@/search/types';

const hit = (id: number, docId: number, filename: string, text: string, score = '1.50'): SearchResult => ({
    id,
    docId,
    score,
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

describe('extraSections', () => {
    test('keeps a second strong match from the same document', () => {
        const results = [
            hit(1, 10, 'contract.pdf', 'seven-day notice', '1.63'),
            hit(2, 10, 'contract.pdf', 'thirty days notice', '1.55'),
            hit(3, 11, 'letter.pdf', 'other file', '1.50'),
        ];
        const chosen = chooseSources(results, 3);
        expect(extraSections(results, chosen).map((r) => r.id)).toEqual([2]);
    });

    test('drops a weak second match', () => {
        const results = [
            hit(1, 10, 'contract.pdf', 'strong', '1.63'),
            hit(2, 10, 'contract.pdf', 'weak', '0.90'),
        ];
        expect(extraSections(results, chooseSources(results, 3))).toEqual([]);
    });

    test('never takes more than the cap per document', () => {
        const results = [1, 2, 3, 4].map((n) => hit(n, 10, 'contract.pdf', `part ${n}`, '1.60'));
        expect(extraSections(results, chooseSources(results, 3))).toHaveLength(1);
    });
});

describe('groupRuns', () => {
    test('adjacent pieces become one run, distant ones separate runs', () => {
        expect(groupRuns([5, 3, 4, 9, 10, 11])).toEqual([[3, 4, 5], [9, 10, 11]]);
    });

    test('duplicates are harmless', () => {
        expect(groupRuns([2, 2, 3])).toEqual([[2, 3]]);
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

    /**
     * The notice-period case. Two sections of one contract answer the same
     * question under two conditions; the second must reach the model.
     */
    test('a long document sends two strong matches as two sections with a visible gap', async () => {
        const docId = (await db.documents.add({
            title: 'contract.pdf',
            fullText: 'x'.repeat(WHOLE_DOCUMENT_LIMIT + 500),
            uploadedAt: Date.now(),
        })) as number;
        await db.chunks.bulkAdd([
            { docId, ordinal: 0, text: 'Opening.', vector: [] },
            { docId, ordinal: 1, text: 'Probation: Seven-day Notice.', vector: [] },
            { docId, ordinal: 2, text: 'Emails to customers are not allowed.', vector: [] },
            { docId, ordinal: 3, text: 'Salary is paid monthly.', vector: [] },
            { docId, ordinal: 4, text: 'Confidentiality applies.', vector: [] },
            { docId, ordinal: 5, text: 'Post probation: Thirty days Notice.', vector: [] },
            { docId, ordinal: 6, text: 'Holidays: one month.', vector: [] },
            { docId, ordinal: 7, text: 'Signed.', vector: [] },
        ]);
        const first = await db.chunks.where({ docId, ordinal: 1 }).first();
        const second = await db.chunks.where({ docId, ordinal: 5 }).first();

        const sources = await buildSources([
            hit(first?.id as number, docId, 'contract.pdf', 'Probation: Seven-day Notice.', '1.63'),
            hit(second?.id as number, docId, 'contract.pdf', 'Post probation: Thirty days Notice.', '1.55'),
        ]);

        expect(sources).toHaveLength(1);
        expect(sources[0]?.sections).toBe(2);
        expect(sources[0]?.text).toContain('Seven-day Notice');
        expect(sources[0]?.text).toContain('Thirty days Notice');
        expect(sources[0]?.text).toContain(SECTION_GAP.trim());
        expect(sources[0]?.text).not.toContain('Salary is paid monthly');
    });

    test('two matches that sit next to each other merge into one longer window', async () => {
        const docId = (await db.documents.add({
            title: 'contract.pdf',
            fullText: 'x'.repeat(WHOLE_DOCUMENT_LIMIT + 500),
            uploadedAt: Date.now(),
        })) as number;
        await db.chunks.bulkAdd([0, 1, 2, 3, 4].map((n) => ({ docId, ordinal: n, text: `Piece ${n}.`, vector: [] })));
        const a = await db.chunks.where({ docId, ordinal: 1 }).first();
        const b = await db.chunks.where({ docId, ordinal: 3 }).first();

        const sources = await buildSources([
            hit(a?.id as number, docId, 'contract.pdf', 'Piece 1.', '1.60'),
            hit(b?.id as number, docId, 'contract.pdf', 'Piece 3.', '1.58'),
        ]);

        expect(sources[0]?.sections).toBe(1);
        expect(sources[0]?.text).toBe('Piece 0. Piece 1. Piece 2. Piece 3. Piece 4.');
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
