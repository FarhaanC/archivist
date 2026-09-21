import { describe, expect, test, beforeEach } from 'bun:test';
import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import {
    compareWith,
    describeRemaining,
    estimateRemaining,
    expectedPages,
    forgetRuns,
    formatDuration,
    formatShort,
    isComparable,
    KEEP_RUNS,
    listRuns,
    phaseOf,
    recordRun,
    shouldPulse,
    startRun,
    summarize,
    toCsv,
    toPlainText,
} from '@/ingestion/import-timing';
import type { ImportRunRecord } from '@/db/types';

const aRun = (over: Partial<ImportRunRecord> = {}): ImportRunRecord => ({
    startedAt: 1_700_000_000_000,
    totalMs: 30_000,
    fileCount: 5,
    bytes: 1000,
    pages: 10,
    scanCount: 5,
    engineCopies: 3,
    cores: 8,
    firstRun: false,
    usedScanReader: true,
    appVersion: '0.1.0',
    userAgent: 'test',
    files: [],
    ...over,
});

describe('guessing how much longer', () => {
    test('uses this run once two pages have been read', () => {
        // Four pages in eight seconds is two seconds a page; six pages left.
        const seconds = estimateRemaining({
            pagesDone: 4,
            pagesTotal: 10,
            elapsedMs: 8000,
            cores: 8,
        });
        expect(seconds).toBeCloseTo(13.2, 1);
    });

    test('falls back to the last warm run on the same machine', () => {
        const seconds = estimateRemaining(
            { pagesDone: 1, pagesTotal: 6, elapsedMs: 500, cores: 8 },
            [aRun({ pages: 10, totalMs: 30_000, cores: 8 })],
        );
        // Three seconds a page from history, five pages left, plus padding.
        expect(seconds).toBeCloseTo(16.5, 1);
    });

    test('ignores a run where the scan reader had to load from cold', () => {
        expect(
            estimateRemaining({ pagesDone: 0, pagesTotal: 6, elapsedMs: 0, cores: 8 }, [
                aRun({ firstRun: true }),
            ]),
        ).toBeNull();
    });

    test('ignores a run measured on a machine with a different number of cores', () => {
        expect(
            estimateRemaining({ pagesDone: 0, pagesTotal: 6, elapsedMs: 0, cores: 4 }, [aRun()]),
        ).toBeNull();
    });

    test('says nothing when there is nothing to go on', () => {
        expect(estimateRemaining({ pagesDone: 0, pagesTotal: 6, elapsedMs: 0, cores: 8 })).toBeNull();
    });

    test('says nothing when there is nothing left to read', () => {
        expect(
            estimateRemaining({ pagesDone: 10, pagesTotal: 10, elapsedMs: 9000, cores: 8 }),
        ).toBeNull();
    });

    test('will not let the guess climb faster than the clock', () => {
        // Reading has slowed to a crawl, so the honest number is minutes.
        // The previous guess promised 100 seconds and 10 have gone by, so the
        // most it may now say is 90 seconds plus a quarter.
        const seconds = estimateRemaining({
            pagesDone: 2,
            pagesTotal: 200,
            elapsedMs: 60_000,
            cores: 8,
            previous: { seconds: 100, agoMs: 10_000 },
        });
        expect(seconds).toBeCloseTo(112.5, 1);
    });

    test('lets a spent promise go, rather than insisting on zero', () => {
        const seconds = estimateRemaining({
            pagesDone: 2,
            pagesTotal: 12,
            elapsedMs: 4000,
            cores: 8,
            previous: { seconds: 5, agoMs: 10_000 },
        });
        expect(seconds).toBeCloseTo(22, 0);
    });
});

describe('saying it in words', () => {
    test.each([
        [200, 'About 3 minutes left'],
        [100, 'About 2 minutes left'],
        [90, 'About 2 minutes left'],
        [89, 'About a minute left'],
        [30, 'About a minute left'],
        [29, 'Under 30 seconds left'],
        [8, 'Under 30 seconds left'],
        [7.9, 'Nearly done'],
        [0, 'Nearly done'],
    ])('%p seconds reads as %p', (seconds, expected) => {
        expect(describeRemaining(seconds)).toBe(expected);
    });

    test('nothing to say means no line at all', () => {
        expect(describeRemaining(null)).toBeNull();
        expect(describeRemaining(Number.NaN)).toBeNull();
    });

    test('never anything more precise than those four phrases', () => {
        const said = new Set<string>();
        for (let seconds = 0; seconds < 600; seconds += 0.5) {
            const phrase = describeRemaining(seconds);
            if (phrase) said.add(phrase.replace(/About \d+ minutes left/, 'About N minutes left'));
        }
        expect([...said].sort()).toEqual([
            'About N minutes left',
            'About a minute left',
            'Nearly done',
            'Under 30 seconds left',
        ]);
    });

    test('durations are read out, not counted out', () => {
        expect(formatDuration(48_000)).toBe('48 seconds');
        expect(formatDuration(130_000)).toBe('2 minutes 10 seconds');
        expect(formatDuration(120_000)).toBe('2 minutes');
        expect(formatDuration(1000)).toBe('1 second');
        expect(formatDuration(300)).toBe('under a second');
    });

    test('the table shows tenths of a second', () => {
        expect(formatShort(4200)).toBe('4.2 s');
        expect(formatShort(20)).toBe('under 0.1 s');
    });

    test('the summary says what was read and how fast', () => {
        expect(
            summarize(aRun({ fileCount: 12, scanCount: 9, pages: 31, totalMs: 48_000 })),
        ).toBe('Read 12 files (9 scans, 31 pages) in 48 seconds — about 1.5 seconds a page.');
    });

    test('a single typed file gets no rate it cannot support', () => {
        expect(
            summarize(aRun({ fileCount: 1, scanCount: 0, pages: 0, totalMs: 900 })),
        ).toBe('Read 1 file in under a second.');
    });
});

describe('comparing with last time', () => {
    test('twenty per cent either way counts as the same amount of work', () => {
        expect(isComparable(10, 12)).toBe(true);
        expect(isComparable(10, 8)).toBe(true);
        expect(isComparable(10, 13)).toBe(false);
        expect(isComparable(0, 0)).toBe(true);
        expect(isComparable(0, 5)).toBe(false);
    });

    test('says the time when the runs are comparable', () => {
        const run = aRun({ startedAt: 2000, pages: 10 });
        const earlier = aRun({ startedAt: 1000, pages: 11, totalMs: 130_000 });
        expect(compareWith(run, [earlier])).toBe('Last time: 2 minutes 10 seconds.');
    });

    test('refuses to compare a different amount of work', () => {
        const run = aRun({ startedAt: 2000, pages: 10 });
        const earlier = aRun({ startedAt: 1000, pages: 40 });
        expect(compareWith(run, [earlier])).toBe('Last time was a different set of files.');
    });

    test('says nothing at all when there is no last time', () => {
        expect(compareWith(aRun({ startedAt: 2000 }), [])).toBeNull();
    });
});

describe('guessing the total number of pages', () => {
    test('assumes the files not yet opened look like the ones that were', () => {
        expect(expectedPages(6, 3, 12)).toBe(24);
    });

    test('assumes one page each before anything has been opened', () => {
        expect(expectedPages(0, 0, 5)).toBe(5);
    });

    test('stops guessing once every file has been opened', () => {
        expect(expectedPages(31, 12, 12)).toBe(31);
    });
});

describe('which look the card wears', () => {
    test('waiting for the scan reader, with nothing read yet', () => {
        expect(phaseOf({ read: 0, done: 0, total: 5, readerStarting: true })).toBe('getting-ready');
    });

    test('reading, once something has been', () => {
        expect(phaseOf({ read: 1, done: 0, total: 5, readerStarting: true })).toBe('reading');
        expect(phaseOf({ read: 2, done: 1, total: 5, readerStarting: false })).toBe('reading');
    });

    test('finishing, when everything has been read but not everything saved', () => {
        expect(phaseOf({ read: 5, done: 3, total: 5, readerStarting: false })).toBe('finishing');
    });

    test('done, when everything is done', () => {
        expect(phaseOf({ read: 5, done: 5, total: 5, readerStarting: false })).toBe('done');
    });
});

describe('showing the bar is alive', () => {
    test('two seconds without a change earns a pulse', () => {
        expect(shouldPulse(1999)).toBe(false);
        expect(shouldPulse(2000)).toBe(true);
    });
});

describe('taking the numbers away with you', () => {
    const run = aRun({
        files: [
            {
                file: 'Invoice, "final" v2.pdf',
                bytes: 120,
                kind: 'scan-pdf',
                pages: 3,
                readMs: 9100,
                saveMs: 400,
                outcome: 'imported',
            },
            { file: 'notes.txt', bytes: 20, kind: 'typed', readMs: 12, saveMs: 300, outcome: 'imported' },
        ],
    });

    test('a comma or a quote in a file name cannot take the row with it', () => {
        const csv = toCsv(run);
        expect(csv.split('\r\n')[1]).toStartWith('"Invoice, ""final"" v2.pdf",Scan,3,9.10,0.40,imported,120');
    });

    test('the header names things in words, not in fields', () => {
        expect(toCsv(run).split('\r\n')[0]).toBe(
            'File,Kind,Pages,Read seconds,Save seconds,Outcome,Bytes',
        );
    });

    test('the copied text leads with the summary and lists the slowest first', () => {
        const lines = toPlainText(run).split('\n');
        expect(lines[0]).toStartWith('Read 5 files');
        expect(lines[5]).toStartWith('Invoice, "final" v2.pdf — Scan, 3 pages, read 9.1 s');
        expect(lines[6]).toStartWith('notes.txt — Typed document');
    });
});

describe('keeping past runs', () => {
    beforeEach(async () => {
        await ensureDbOpen();
        await forgetRuns();
    });

    test('keeps the newest fifty and drops the rest', async () => {
        for (let index = 0; index < KEEP_RUNS + 5; index++) {
            await recordRun(aRun({ startedAt: 1000 + index }));
        }
        expect(await db.importRuns.count()).toBe(KEEP_RUNS);
        const oldest = await db.importRuns.orderBy('startedAt').first();
        expect(oldest?.startedAt).toBe(1005);
    });

    test('hands back the newest first', async () => {
        await recordRun(aRun({ startedAt: 1000 }));
        await recordRun(aRun({ startedAt: 3000 }));
        await recordRun(aRun({ startedAt: 2000 }));
        expect((await listRuns(10)).map((run) => run.startedAt)).toEqual([3000, 2000, 1000]);
    });

    test('forgetting really forgets', async () => {
        await recordRun(aRun());
        await forgetRuns();
        expect(await listRuns()).toHaveLength(0);
    });
});

describe('the recorder itself', () => {
    test('times each file separately and adds up the run', () => {
        const timing = startRun({ fileCount: 2, cores: 8, engineCopies: 3 });
        timing.startFile(0, { name: 'a.pdf', size: 100 });
        timing.describeFile(0, 'scan-pdf', 3);
        timing.endRead(0);
        timing.startSave(0);
        timing.endFile(0, 'imported');

        timing.startFile(1, { name: 'b.txt', size: 10 });
        timing.describeFile(1, 'typed');
        timing.endRead(1);
        timing.startSave(1);
        timing.endFile(1, 'duplicate');

        const run = timing.endRun();
        expect(run.fileCount).toBe(2);
        expect(run.bytes).toBe(110);
        expect(run.pages).toBe(3);
        expect(run.scanCount).toBe(1);
        expect(run.files.map((file) => file.outcome)).toEqual(['imported', 'duplicate']);
        // Nothing was slow enough to be worth a stopwatch, but the run must
        // still be a whole number of milliseconds and not a negative one.
        expect(run.totalMs).toBeGreaterThanOrEqual(0);
    });

    test('records how many reads a hard picture cost, and nothing for easy ones', () => {
        const timing = startRun({ fileCount: 2, cores: 8, engineCopies: 1 });
        timing.startFile(0, { name: 'licence.jpg', size: 100 });
        timing.describeFile(0, 'photo', 1);
        timing.readsTaken(0, 3);
        timing.endRead(0);
        timing.endFile(0, 'imported');

        timing.startFile(1, { name: 'clean-scan.pdf', size: 100 });
        timing.describeFile(1, 'scan-pdf', 6);
        timing.endRead(1);
        timing.endFile(1, 'imported');

        const run = timing.endRun();
        expect(run.files[0]?.attempts).toBe(3);
        // A file nothing was retried on says nothing at all, so the table
        // shows the ordinary single read.
        expect(run.files[1]?.attempts).toBeUndefined();
    });

    test('the hardest page of a document is the one reported', () => {
        const timing = startRun({ fileCount: 1, cores: 8, engineCopies: 1 });
        timing.startFile(0, { name: 'mixed.pdf', size: 100 });
        timing.describeFile(0, 'scan-pdf', 4);
        timing.readsTaken(0, 3);
        timing.readsTaken(0, 2); // a later, easier page
        timing.endRead(0);
        timing.endFile(0, 'imported');

        expect(timing.endRun().files[0]?.attempts).toBe(3);
    });

    test('a file that failed to save was still whatever it was', () => {
        const timing = startRun({ fileCount: 2, cores: 8, engineCopies: 1 });
        timing.startFile(0, { name: 'scan.pdf' });
        timing.describeFile(0, 'scan-pdf', 4);
        timing.endRead(0);
        // The words were read fine; saving them is what went wrong.
        timing.describeFile(0, 'failed');
        timing.endFile(0, 'failed');

        // This one never got as far as being read at all.
        timing.startFile(1, { name: 'setup.exe' });
        timing.endRead(1);
        timing.describeFile(1, 'skipped');
        timing.endFile(1, 'skipped');

        const run = timing.endRun();
        expect(run.files.map((file) => file.kind)).toEqual(['scan-pdf', 'skipped']);
        expect(run.scanCount).toBe(1);
        expect(run.pages).toBe(4);
    });

    test('a first, slow start of the scan reader marks the run as a cold one', () => {
        const cold = startRun({ fileCount: 1, cores: 8, engineCopies: 1 });
        cold.readerStarted(6000);
        expect(cold.endRun().firstRun).toBe(true);

        const warm = startRun({ fileCount: 1, cores: 8, engineCopies: 1 });
        warm.readerStarted(200);
        const record = warm.endRun();
        expect(record.firstRun).toBe(false);
        expect(record.usedScanReader).toBe(true);
    });

    test('a batch with no scans never went near the reader', () => {
        expect(startRun({ fileCount: 1, cores: 8, engineCopies: 1 }).endRun().usedScanReader).toBe(
            false,
        );
    });

    test('reports how far along it is while it runs', () => {
        const timing = startRun({ fileCount: 4, cores: 8, engineCopies: 2 });
        timing.startFile(0, { name: 'a.pdf' });
        timing.describeFile(0, 'scan-pdf', 4);
        timing.endRead(0);
        const soFar = timing.soFar();
        expect(soFar.pagesDone).toBe(4);
        // Four pages seen across one file, three files still to come.
        expect(soFar.pagesTotal).toBe(16);
    });
});
