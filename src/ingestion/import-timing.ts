import { db } from '@/db/get-db';
import type { ImportRunRecord, TimedFile, TimedFileKind } from '@/db/types';

/**
 * Timing an import, and saying honestly how much longer it will take.
 *
 * Until now nobody could answer "how long did that take?" without a
 * stopwatch, which meant nobody could tell whether a change had made the app
 * faster or slower. This module answers it. It times every file and every
 * run, keeps the last fifty runs in the person's own browser, and turns what
 * it has measured into a guess at the time left.
 *
 * Two rules run through all of it. Measuring must never be able to break an
 * import — every save is wrapped, and a store that refuses simply means no
 * history. And the guess must never be more precise than the measurement
 * deserves: it comes out as one of four rounded phrases, or as nothing at
 * all. See docs/progress-design-notes.md for where those rules come from.
 */

/** A clock that only ever moves forward, so a laptop waking from sleep or a
 *  clock correction cannot make a stretch of work appear to take no time. */
const now = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

/** The app's own version, for telling one set of numbers from another. */
export const APP_VERSION: string =
    (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null) ?? 'unknown';

/**
 * A first start of the scan reader — engine and languages read from disk and
 * unpacked — takes several seconds. A later one, with the browser already
 * holding the files, is quick. Anything slower than this is taken to be the
 * first time on this machine, which matters because the first run of a
 * morning is never comparable with the ones after it.
 */
export const FIRST_START_MS = 4000;

/** How many past runs to keep. Old ones go as new ones arrive. */
export const KEEP_RUNS = 50;

/** Two runs are only worth comparing when they did roughly the same amount
 *  of reading. Twenty per cent either way. */
export const COMPARABLE_TOLERANCE = 0.2;

/** Padding on every estimate: better to finish early than late. */
const PAD = 1.1;

interface FileInProgress {
    file: string;
    bytes: number;
    kind: TimedFileKind;
    /** Whether reading the file told us what it was. Once it has, a later
     *  failure does not get to rewrite that: a scan that could not be saved
     *  was still a scan, and the outcome column is where the failure
     *  belongs. */
    known: boolean;
    pages?: number;
    readStarted: number;
    readMs: number;
    saveStarted: number;
    saveMs: number;
    outcome?: string;
}

export interface RunRecorderOptions {
    fileCount: number;
    cores: number;
    engineCopies: number;
    /** Set on runs made by the standard timing test, so they are not mixed
     *  in with real imports when comparing. */
    standard?: boolean;
}

/**
 * The live record of one import. The import loop calls into this at four
 * points and otherwise ignores it; everything else here reads what it has
 * collected.
 */
export interface RunRecorder {
    startFile(index: number, file: { name: string; size?: number }): void;
    /** What this file turned out to be, and how many pages had to be read. */
    describeFile(index: number, kind: TimedFileKind, pages?: number): void;
    endRead(index: number): void;
    startSave(index: number): void;
    endFile(index: number, outcome: string): void;
    /** How long the first copy of the scan reader took to start. */
    readerStarted(ms: number): void;
    /** Everything measured so far, for the estimate. */
    soFar(): RunProgressSoFar;
    endRun(): ImportRunRecord;
}

export interface RunProgressSoFar {
    pagesDone: number;
    pagesTotal: number;
    /** Milliseconds since the run began. */
    elapsedMs: number;
    cores: number;
}

export const startRun = ({
    fileCount,
    cores,
    engineCopies,
    standard,
}: RunRecorderOptions): RunRecorder => {
    const startedAt = Date.now();
    const started = now();
    const files = new Map<number, FileInProgress>();
    let readerStartMs: number | null = null;

    const get = (index: number): FileInProgress | undefined => files.get(index);

    return {
        startFile(index, file) {
            files.set(index, {
                file: file.name,
                bytes: file.size ?? 0,
                kind: 'typed',
                known: false,
                readStarted: now(),
                readMs: 0,
                saveStarted: 0,
                saveMs: 0,
            });
        },
        describeFile(index, kind, pages) {
            const entry = get(index);
            if (!entry) return;
            const isFailure = kind === 'failed' || kind === 'skipped';
            if (!isFailure) entry.known = true;
            if (!isFailure || !entry.known) entry.kind = kind;
            if (pages !== undefined) entry.pages = pages;
        },
        endRead(index) {
            const entry = get(index);
            if (entry && entry.readMs === 0) entry.readMs = now() - entry.readStarted;
        },
        startSave(index) {
            const entry = get(index);
            if (entry) entry.saveStarted = now();
        },
        endFile(index, outcome) {
            const entry = get(index);
            if (!entry) return;
            if (entry.saveStarted) entry.saveMs = now() - entry.saveStarted;
            entry.outcome = outcome;
        },
        readerStarted(ms) {
            readerStartMs ??= ms;
        },
        soFar() {
            const entries = [...files.values()];
            const pagesDone = entries
                .filter((entry) => entry.readMs > 0)
                .reduce((sum, entry) => sum + (entry.pages ?? 1), 0);
            const pagesSeen = entries.reduce((sum, entry) => sum + (entry.pages ?? 1), 0);
            return {
                pagesDone,
                pagesTotal: expectedPages(pagesSeen, entries.length, fileCount),
                elapsedMs: now() - started,
                cores,
            };
        },
        endRun() {
            const rows: TimedFile[] = [...files.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, entry]) => ({
                    file: entry.file,
                    bytes: entry.bytes,
                    kind: entry.kind,
                    ...(entry.pages === undefined ? {} : { pages: entry.pages }),
                    readMs: Math.round(entry.readMs),
                    saveMs: Math.round(entry.saveMs),
                    outcome: entry.outcome ?? 'unknown',
                }));
            return {
                startedAt,
                totalMs: Math.round(now() - started),
                fileCount,
                bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
                pages: rows.reduce((sum, row) => sum + (row.pages ?? 0), 0),
                scanCount: rows.filter((row) => row.kind === 'scan-pdf' || row.kind === 'photo')
                    .length,
                engineCopies,
                cores,
                firstRun: readerStartMs !== null && readerStartMs >= FIRST_START_MS,
                usedScanReader: readerStartMs !== null,
                appVersion: APP_VERSION,
                userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
                ...(standard ? { standard: true } : {}),
                files: rows,
            };
        },
    };
};

/**
 * How many pages this run will have to read, all told.
 *
 * Only the files already opened have told us their page count; the rest are
 * guessed at the average of the ones that have. A folder of one-page scans
 * therefore guesses one page each and is right, and a folder of long
 * documents corrects itself within the first file or two.
 */
export const expectedPages = (
    pagesSeen: number,
    filesStarted: number,
    filesTotal: number,
): number => {
    const remaining = Math.max(0, filesTotal - filesStarted);
    if (remaining === 0) return pagesSeen;
    const average = filesStarted > 0 ? pagesSeen / filesStarted : 1;
    return pagesSeen + remaining * Math.max(1, average);
};

export interface EstimateInput extends RunProgressSoFar {
    /** The estimate last shown and how long ago, so a new one cannot climb
     *  faster than the clock. */
    previous?: { seconds: number; agoMs: number };
}

/**
 * Seconds left, or null when there is nothing honest to say.
 *
 * The rate comes from this run once two pages have been read — that is what
 * this machine, with these files, is actually managing. Before that it comes
 * from the last comparable run on a machine with the same number of cores,
 * skipping runs where the scan reader had to start from cold, because those
 * carry several seconds that will not be paid again. With neither, there is
 * no estimate.
 */
export const estimateRemaining = (
    soFar: EstimateInput,
    history: readonly ImportRunRecord[] = [],
): number | null => {
    const remainingPages = soFar.pagesTotal - soFar.pagesDone;
    if (!Number.isFinite(remainingPages) || remainingPages <= 0) return null;

    const rate = secondsPerPage(soFar, history);
    if (rate === null) return null;

    const raw = remainingPages * rate * PAD;

    // An estimate is allowed to fall as fast as it likes and to rise only
    // slowly: the previous estimate, less the time since it was made, is the
    // budget it promised, and a new one may exceed that budget by a quarter.
    // Once that budget is spent the promise has expired and the fresh
    // measurement stands on its own.
    if (soFar.previous) {
        const budget = soFar.previous.seconds - soFar.previous.agoMs / 1000;
        if (budget > 0) return Math.min(raw, budget * 1.25);
    }
    return raw;
};

const secondsPerPage = (
    soFar: RunProgressSoFar,
    history: readonly ImportRunRecord[],
): number | null => {
    if (soFar.pagesDone >= 2 && soFar.elapsedMs > 0) {
        return soFar.elapsedMs / 1000 / soFar.pagesDone;
    }
    const warm = [...history]
        .filter((run) => !run.firstRun && run.pages > 0 && run.cores === soFar.cores)
        .sort((a, b) => b.startedAt - a.startedAt)[0];
    return warm ? warm.totalMs / 1000 / warm.pages : null;
};

/**
 * The estimate in words. Four phrases and nothing finer, because a number
 * like "1 minute 47 seconds" claims an accuracy no estimate of this kind
 * has. A null here means the card shows no estimate line at all.
 */
export const describeRemaining = (seconds: number | null): string | null => {
    if (seconds === null || !Number.isFinite(seconds)) return null;
    if (seconds >= 90) return `About ${Math.max(2, Math.round(seconds / 60))} minutes left`;
    if (seconds >= 30) return 'About a minute left';
    if (seconds >= 8) return 'Under 30 seconds left';
    return 'Nearly done';
};

/** Which of the card's four looks to show. */
export type ImportPhase = 'getting-ready' | 'reading' | 'finishing' | 'done';

export const phaseOf = ({
    read,
    done,
    total,
    readerStarting,
}: {
    read: number;
    done: number;
    total: number;
    readerStarting: boolean;
}): ImportPhase => {
    if (total > 0 && done >= total) return 'done';
    // Nothing has been read yet and the scan reader is still waking up, so
    // there is nothing to count and no point pretending otherwise.
    if (readerStarting && read === 0) return 'getting-ready';
    if (total > 0 && read >= total) return 'finishing';
    return 'reading';
};

/** A bar that has not changed for this long looks broken, so it is given a
 *  gentle pulse to show it is still alive. */
export const PULSE_AFTER_MS = 2000;

export const shouldPulse = (msSinceLastChange: number): boolean =>
    msSinceLastChange >= PULSE_AFTER_MS;

// --- Saying it in words -----------------------------------------------------

/** "4.2 s" — for the per-file table, where the differences are small. */
export const formatShort = (ms: number): string => {
    const seconds = ms / 1000;
    if (seconds < 0.05) return 'under 0.1 s';
    return `${seconds.toFixed(1)} s`;
};

/** "48 seconds", "2 minutes 10 seconds" — for sentences people read. */
export const formatDuration = (ms: number): string => {
    if (ms < 1000) return 'under a second';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    const minutePart = `${minutes} minute${minutes === 1 ? '' : 's'}`;
    if (rest === 0) return minutePart;
    return `${minutePart} ${rest} second${rest === 1 ? '' : 's'}`;
};

/**
 * The one line shown as soon as an import finishes. Every number in it is
 * something the person watched happen.
 */
export const summarize = (run: ImportRunRecord): string => {
    const files = `${run.fileCount} file${run.fileCount === 1 ? '' : 's'}`;
    const detail: string[] = [];
    if (run.scanCount > 0) {
        detail.push(`${run.scanCount} scan${run.scanCount === 1 ? '' : 's'}`);
        if (run.pages > 0) detail.push(`${run.pages} page${run.pages === 1 ? '' : 's'}`);
    }
    const bracket = detail.length > 0 ? ` (${detail.join(', ')})` : '';
    const head = `Read ${files}${bracket} in ${formatDuration(run.totalMs)}`;
    if (run.pages < 2) return `${head}.`;
    const perPage = run.totalMs / run.pages / 1000;
    return `${head} — about ${perPage < 10 ? perPage.toFixed(1) : Math.round(perPage)} seconds a page.`;
};

/**
 * The most recent earlier run, and whether it is worth comparing with. Two
 * runs over very different amounts of reading tell you nothing about each
 * other, and saying so is better than a comparison that flatters or alarms.
 */
export const compareWith = (
    run: ImportRunRecord,
    history: readonly ImportRunRecord[],
): string | null => {
    const earlier = [...history]
        // A run that has not been saved yet has no id, and then there is
        // nothing to tell it apart from by id — only by when it started.
        .filter(
            (other) =>
                other.startedAt < run.startedAt &&
                (run.id === undefined || other.id !== run.id),
        )
        .sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!earlier) return null;
    if (!isComparable(run.pages, earlier.pages)) return 'Last time was a different set of files.';
    return `Last time: ${formatDuration(earlier.totalMs)}.`;
};

export const isComparable = (pages: number, otherPages: number): boolean => {
    if (pages === 0 && otherPages === 0) return true;
    if (pages === 0 || otherPages === 0) return false;
    return Math.abs(pages - otherPages) / pages <= COMPARABLE_TOLERANCE;
};

const KIND_WORDS: Record<TimedFileKind, string> = {
    typed: 'Typed document',
    'scan-pdf': 'Scan',
    photo: 'Photo',
    skipped: 'Not a document',
    failed: "Couldn't be read",
};

export const describeKind = (kind: TimedFileKind): string => KIND_WORDS[kind] ?? kind;

/** Plain text for the clipboard. Nothing is sent anywhere; this is for
 *  pasting into a note or a message. */
export const toPlainText = (run: ImportRunRecord): string => {
    const lines = [
        summarize(run),
        `Started ${new Date(run.startedAt).toLocaleString()}`,
        `${run.engineCopies} copies of the scan reader, ${run.cores} cores` +
            (run.usedScanReader ? (run.firstRun ? ', first run on this machine' : ', warm') : ''),
        `Archivist ${run.appVersion}`,
        '',
    ];
    for (const row of [...run.files].sort((a, b) => b.readMs + b.saveMs - (a.readMs + a.saveMs))) {
        const pages = row.pages ? `, ${row.pages} page${row.pages === 1 ? '' : 's'}` : '';
        lines.push(
            `${row.file} — ${describeKind(row.kind)}${pages}, read ${formatShort(row.readMs)}, saved ${formatShort(row.saveMs)}`,
        );
    }
    return lines.join('\n');
};

/** One row per file, for a spreadsheet. */
export const toCsv = (run: ImportRunRecord): string => {
    const header = ['File', 'Kind', 'Pages', 'Read seconds', 'Save seconds', 'Outcome', 'Bytes'];
    const rows = run.files.map((row) => [
        row.file,
        describeKind(row.kind),
        row.pages === undefined ? '' : String(row.pages),
        (row.readMs / 1000).toFixed(2),
        (row.saveMs / 1000).toFixed(2),
        row.outcome,
        String(row.bytes),
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
};

/** A file called `Invoice, final "v2".pdf` must survive the trip into a
 *  spreadsheet without taking the rest of the row with it. */
const csvCell = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

// --- Keeping them ----------------------------------------------------------

/**
 * Save a run, and drop the oldest if there are now too many. A store that
 * will not take it — a full disk, a private window with storage switched
 * off — costs the person their history and nothing else, so it is noted in
 * the console and otherwise ignored.
 */
export const recordRun = async (run: ImportRunRecord): Promise<number | null> => {
    try {
        const id = (await db.importRuns.add(run)) as number | undefined;
        const count = await db.importRuns.count();
        if (count > KEEP_RUNS) {
            const stale = await db.importRuns
                .orderBy('startedAt')
                .limit(count - KEEP_RUNS)
                .primaryKeys();
            await db.importRuns.bulkDelete(stale);
        }
        return id ?? null;
    } catch (error) {
        console.warn('[Timing] Could not save how long that import took:', error);
        return null;
    }
};

export const listRuns = async (limit = 10): Promise<ImportRunRecord[]> => {
    try {
        return await db.importRuns.orderBy('startedAt').reverse().limit(limit).toArray();
    } catch (error) {
        console.warn('[Timing] Could not read past imports:', error);
        return [];
    }
};

export const forgetRuns = async (): Promise<void> => {
    try {
        await db.importRuns.clear();
    } catch (error) {
        console.warn('[Timing] Could not clear past imports:', error);
    }
};
