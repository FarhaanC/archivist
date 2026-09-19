import { describe, expect, test } from 'bun:test';
import { mapWithLimit } from '@/lib/map-with-limit';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithLimit', () => {
    test('gives the answers back in the order it was asked, not the order they finished', async () => {
        const results = await mapWithLimit([30, 10, 20], 3, async (ms, index) => {
            await wait(ms);
            return index;
        });
        expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([0, 1, 2]);
    });

    test('never has more than the given number of jobs going at once', async () => {
        let running = 0;
        let peak = 0;
        await mapWithLimit(Array.from({ length: 9 }, (_, i) => i), 3, async () => {
            running += 1;
            peak = Math.max(peak, running);
            await wait(5);
            running -= 1;
        });
        expect(peak).toBe(3);
    });

    test('one failure does not stop the rest', async () => {
        const results = await mapWithLimit([1, 2, 3], 2, async (value) => {
            if (value === 2) throw new Error('that one is damaged');
            return value * 10;
        });
        expect(results[0]).toEqual({ status: 'fulfilled', value: 10 });
        expect(results[1]?.status).toBe('rejected');
        expect(results[2]).toEqual({ status: 'fulfilled', value: 30 });
    });

    test('copes with an empty list and with a nonsense limit', async () => {
        expect(await mapWithLimit([], 4, async () => 1)).toEqual([]);
        const results = await mapWithLimit([1, 2], 0, async (value) => value);
        expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([1, 2]);
    });
});
