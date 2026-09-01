import 'fake-indexeddb/auto';
import { describe, test, expect } from 'bun:test';
import { ingestDocument } from '@/ingestion/ingest-document';
import { findExactDuplicate, findNearDuplicate } from '@/ingestion/dedupe';
import { wordDiff, summarizeDiff } from '../word-diff';

/**
 * End-to-end check of the library brain's duplicate pipeline against the real
 * ingestion code and (fake) IndexedDB, using a deterministic stub embedder.
 */

const dim = 128;
const embed = (t: string): Float32Array => {
    const v = new Float32Array(dim);
    const s = t.toLowerCase();
    for (let i = 0; i < s.length - 2; i++) {
        const h = (s.charCodeAt(i) * 31 + s.charCodeAt(i + 1)) * 31 + s.charCodeAt(i + 2);
        v[Math.abs(h) % dim] = (v[Math.abs(h) % dim] ?? 0) + 1;
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return v.map((x) => x / norm);
};
const worker = { getEmbedding: async (t: string) => embed(t) } as never;

const V1 =
    'The M3 Industrial Beacon supports Bluetooth 5.0 with a transmission range of 100 meters. Battery life is 5 years using a CR2477 cell. Operating temperature -40 to 85 C.';
const V2 = V1.replace('100 meters', '120 meters').replace('5 years', '7 years');
const UNRELATED =
    'Flight to Lisbon departs June 3rd. Hotel check-in after 3pm. Remember to book the Sintra day trip and try the famous pastries near the main square.';

describe('library brain: duplicate pipeline', () => {
    test('full flow: exact dup, near dup with diff, unrelated untouched', async () => {
        await ingestDocument({ fileObj: { name: 'm3-v1.txt' }, text: V1, workerClient: worker });

        // Exact duplicate caught despite formatting/case differences
        const exact = await findExactDuplicate('  ' + V1.toUpperCase() + '  ');
        expect(exact?.title).toBe('m3-v1.txt');

        // V2 is not an exact duplicate…
        expect(await findExactDuplicate(V2)).toBeNull();

        // …but is a near duplicate, and the diff names the real changes
        const v2Id = await ingestDocument({ fileObj: { name: 'm3-v2.txt' }, text: V2, workerClient: worker });
        const near = await findNearDuplicate(V2, v2Id as number, (t) => Promise.resolve(embed(t)));
        expect(near?.title).toBe('m3-v1.txt');
        expect(near!.similarity).toBeGreaterThan(0.95);

        const diff = summarizeDiff(wordDiff(V1, V2));
        expect(diff).toContain('"100" → "120"');
        expect(diff).toContain('"5" → "7"');

        // Unrelated content is not flagged
        const unId = await ingestDocument({ fileObj: { name: 'trip.txt' }, text: UNRELATED, workerClient: worker });
        const unNear = await findNearDuplicate(UNRELATED, unId as number, (t) => Promise.resolve(embed(t)));
        expect(unNear).toBeNull();
    });
});
