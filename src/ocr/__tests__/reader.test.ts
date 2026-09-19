import { describe, expect, test } from 'bun:test';
import { createReaderPool, workerCountFor } from '@/ocr/reader';
import type { PoolOptions, ScanResult, ScanSource } from '@/ocr/reader';

/**
 * The pool is tested with a stand-in for the engine, so these tests say
 * nothing about how well anything is read — only about the things the pool
 * is responsible for: not starting copies of the engine that nothing needs,
 * never running more of them than it was allowed, sending each page's
 * progress back to whoever asked for that page, and keeping going when one
 * page or one copy of the engine goes wrong.
 */

/** Let every promise that is ready to settle actually settle. */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

const fakeEngine = ({ failToStart = false } = {}) => {
    const running = new Map<
        ScanSource,
        { resolve: (result: ScanResult) => void; reject: (error: unknown) => void; report: (fraction: number) => void }
    >();
    const state = { starts: 0, live: 0, active: 0, peak: 0 };

    const start: PoolOptions['start'] = async (onProgress) => {
        state.starts += 1;
        if (failToStart) throw new Error('The reading engine could not be started');
        state.live += 1;
        return {
            recognize: (image: ScanSource) =>
                new Promise<ScanResult>((resolve, reject) => {
                    state.active += 1;
                    state.peak = Math.max(state.peak, state.active);
                    const done = (): void => {
                        state.active -= 1;
                        running.delete(image);
                    };
                    running.set(image, {
                        resolve: (result) => {
                            done();
                            resolve(result);
                        },
                        reject: (error) => {
                            done();
                            reject(error);
                        },
                        report: onProgress,
                    });
                }),
            terminate: async () => {
                state.live -= 1;
            },
        };
    };

    return {
        state,
        start,
        isReading: (image: ScanSource) => running.has(image),
        finish: (image: ScanSource, text: string, confidence = 90) =>
            running.get(image)?.resolve({ text, confidence }),
        fail: (image: ScanSource, error: Error) => running.get(image)?.reject(error),
        report: (image: ScanSource, fraction: number) => running.get(image)?.report(fraction),
    };
};

const page = (name: string): ScanSource => new Blob([name]) as ScanSource;

describe('workerCountFor', () => {
    test('leaves a core for the screen and never runs more than four copies', () => {
        expect(workerCountFor(1)).toBe(1);
        expect(workerCountFor(2)).toBe(1);
        expect(workerCountFor(4)).toBe(3);
        expect(workerCountFor(8)).toBe(4);
        expect(workerCountFor(32)).toBe(4);
    });

    test('treats a machine that will not say how many cores it has as a small one', () => {
        expect(workerCountFor(Number.NaN)).toBe(1);
        expect(workerCountFor(0)).toBe(1);
        expect(workerCountFor(-4)).toBe(1);
    });
});

describe('the reader pool', () => {
    test('starts nothing at all when no scan ever turns up', async () => {
        const engine = fakeEngine();
        const reader = createReaderPool({ start: engine.start, maxWorkers: 4 });
        await reader.close();
        expect(engine.state.starts).toBe(0);
    });

    test('starts one copy for one page, and a second only when a second page is waiting', async () => {
        const engine = fakeEngine();
        const reader = createReaderPool({ start: engine.start, maxWorkers: 4 });

        const first = page('one');
        const firstRead = reader.readPage(first);
        await settle();
        expect(engine.state.starts).toBe(1);

        const second = page('two');
        const secondRead = reader.readPage(second);
        await settle();
        expect(engine.state.starts).toBe(2);

        engine.finish(first, 'first page');
        engine.finish(second, 'second page');
        expect((await firstRead).text).toBe('first page');
        expect((await secondRead).text).toBe('second page');
        await reader.close();
    });

    test('never runs more copies than it was allowed, and queues the rest', async () => {
        const engine = fakeEngine();
        const reader = createReaderPool({ start: engine.start, maxWorkers: 2 });

        const pages = ['a', 'b', 'c', 'd', 'e'].map(page);
        const reads = pages.map((image) => reader.readPage(image));
        await settle();

        expect(engine.state.starts).toBe(2);
        expect(engine.state.peak).toBe(2);
        expect(engine.isReading(pages[2] as ScanSource)).toBe(false);

        for (const image of pages) {
            engine.finish(image, 'read');
            await settle();
        }
        expect((await Promise.all(reads)).map((r) => r.text)).toEqual([
            'read',
            'read',
            'read',
            'read',
            'read',
        ]);
        expect(engine.state.peak).toBe(2);
        await reader.close();
    });

    test('sends each page its own progress and not another page’s', async () => {
        const engine = fakeEngine();
        const reader = createReaderPool({ start: engine.start, maxWorkers: 2 });

        const first = page('one');
        const second = page('two');
        const seenByFirst: number[] = [];
        const seenBySecond: number[] = [];
        const firstRead = reader.readPage(first, (f) => seenByFirst.push(f));
        const secondRead = reader.readPage(second, (f) => seenBySecond.push(f));
        await settle();

        engine.report(first, 0.25);
        engine.report(second, 0.5);
        engine.report(first, 0.75);
        expect(seenByFirst).toEqual([0.25, 0.75]);
        expect(seenBySecond).toEqual([0.5]);

        engine.finish(first, 'one');
        engine.finish(second, 'two');
        await Promise.all([firstRead, secondRead]);
        await reader.close();
    });

    test('one page that cannot be read does not stop the others', async () => {
        const engine = fakeEngine();
        const reader = createReaderPool({ start: engine.start, maxWorkers: 2 });

        const broken = page('broken');
        const fine = page('fine');
        const brokenRead = reader.readPage(broken);
        const fineRead = reader.readPage(fine);
        await settle();

        engine.fail(broken, new Error('that picture makes no sense'));
        engine.finish(fine, 'a perfectly good page');

        await expect(brokenRead).rejects.toThrow('that picture makes no sense');
        expect((await fineRead).text).toBe('a perfectly good page');

        // The copy of the engine that hit the bad page is still in use, not
        // thrown away and started again.
        const next = page('next');
        const nextRead = reader.readPage(next);
        await settle();
        expect(engine.state.starts).toBe(2);
        engine.finish(next, 'still working');
        expect((await nextRead).text).toBe('still working');
        await reader.close();
    });

    test('stops trying when the engine itself will not start', async () => {
        const engine = fakeEngine({ failToStart: true });
        const reader = createReaderPool({ start: engine.start, maxWorkers: 4 });

        const reads = ['a', 'b', 'c', 'd'].map((name) => reader.readPage(page(name)));
        const outcomes = await Promise.allSettled(reads);
        expect(outcomes.every((o) => o.status === 'rejected')).toBe(true);
        // At worst one attempt per copy it was allowed — never one per page.
        expect(engine.state.starts).toBeLessThanOrEqual(4);

        // And having learned that, it does not try again for the files behind
        // them: they are told straight away rather than left waiting.
        const attemptsSoFar = engine.state.starts;
        const later = await Promise.allSettled(['e', 'f', 'g'].map((name) => reader.readPage(page(name))));
        expect(later.every((o) => o.status === 'rejected')).toBe(true);
        expect(engine.state.starts).toBe(attemptsSoFar);
        await reader.close();
    });

    test('closing stops every copy, and closing twice is harmless', async () => {
        const engine = fakeEngine();
        const reader = createReaderPool({ start: engine.start, maxWorkers: 2 });

        const first = page('one');
        const second = page('two');
        const reads = [reader.readPage(first), reader.readPage(second)];
        await settle();
        engine.finish(first, 'one');
        engine.finish(second, 'two');
        await Promise.all(reads);

        await reader.close();
        expect(engine.state.live).toBe(0);
        await reader.close();
        expect(engine.state.live).toBe(0);
        await expect(reader.readPage(page('late'))).rejects.toThrow();
    });
});
