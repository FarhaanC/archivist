import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportProgressCard, barWidth } from '@/components/import-progress';
import type { ImportProgress } from '@/ingestion/import-files';

const progress = (over: Partial<ImportProgress> = {}): ImportProgress => ({
    done: 0,
    read: 0,
    total: 16,
    failed: 0,
    readerStarting: false,
    inFlight: [],
    secondsLeft: null,
    ...over,
});

const render = (over: Partial<ImportProgress> = {}): string =>
    renderToStaticMarkup(<ImportProgressCard progress={progress(over)} />);

describe('getting ready', () => {
    const html = render({ readerStarting: true });

    test('says what the wait is for, in words', () => {
        expect(html).toContain('Getting the scan reader ready — this happens once.');
        expect(html).toContain('Getting ready');
    });

    test('claims no number, because there is nothing to count', () => {
        expect(html).not.toContain('aria-valuenow');
        expect(html).toContain('progress big unknown');
        expect(html).not.toMatch(/\d+%/);
    });

    test('is still announced as a progress bar with a name a person would use', () => {
        expect(html).toContain('role="progressbar"');
        expect(html).toContain('aria-label="How far through reading your files"');
        expect(html).toContain('aria-valuemin="0"');
        expect(html).toContain('aria-valuemax="100"');
    });
});

describe('reading', () => {
    const html = render({
        done: 5,
        read: 6,
        failed: 1,
        secondsLeft: 130,
        inFlight: [{ file: 'Tenancy contract.pdf', detail: 'page 3 of 7', fraction: 0.4 }],
    });

    test('counts in files, not in anything the machine cares about', () => {
        expect(html).toContain('Reading your files');
        expect(html).toContain('5 of 16 done');
    });

    test('shows the percentage beside the bar', () => {
        // Five files finished plus four tenths of a sixth, out of sixteen.
        expect(html).toContain('>34%<');
        expect(html).toContain('aria-valuenow="34"');
    });

    test('names the file it is on and where it has got to', () => {
        expect(html).toContain('Tenancy contract.pdf');
        expect(html).toContain('page 3 of 7');
    });

    test('counts what could not be read, and promises the detail later', () => {
        expect(html).toContain('1 couldn’t be read — details below when this finishes.');
    });

    test('rounds the time left rather than pretending to precision', () => {
        expect(html).toContain('About 2 minutes left');
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
    });

    test('says nothing about the time when it does not yet know', () => {
        const quiet = render({ done: 1, read: 2, secondsLeft: null });
        expect(quiet).not.toContain('left');
        expect(quiet).not.toContain('calculating');
    });
});

describe('one file on its own', () => {
    const html = render({
        total: 1,
        done: 0,
        read: 0,
        inFlight: [{ file: 'Employment contract.pdf', detail: 'page 3 of 7', fraction: 0.4 }],
    });

    test('names the file instead of counting to one', () => {
        expect(html).toContain('Reading Employment contract.pdf');
        expect(html).not.toContain('1 of 1 done');
    });

    test('does not explain that scans are slow for a single scan', () => {
        expect(html).not.toContain('Scans take a few seconds a page.');
    });
});

describe('finishing', () => {
    const html = render({ done: 14, read: 16 });

    test('sits full and says what is left', () => {
        expect(html).toContain('Finishing up');
        expect(html).toContain('Saving the last of them to your library.');
        expect(html).toContain('aria-valuenow="100"');
        expect(html).toContain('width:100%');
    });
});

describe('done', () => {
    test('the card gets out of the way', () => {
        expect(render({ done: 16, read: 16 })).toBe('');
    });
});

describe('how full the bar is', () => {
    test('counts the files finished plus how far through the ones in hand', () => {
        expect(
            barWidth(
                progress({
                    done: 5,
                    total: 16,
                    inFlight: [
                        { file: 'a', fraction: 0.5 },
                        { file: 'b', fraction: 0.25 },
                    ],
                }),
            ),
        ).toBeCloseTo(5.75 / 16, 5);
    });

    test('never overshoots', () => {
        expect(
            barWidth(progress({ done: 2, total: 2, inFlight: [{ file: 'a', fraction: 1 }] })),
        ).toBe(1);
    });

    test('an empty drop is not a divide by zero', () => {
        expect(barWidth(progress({ total: 0 }))).toBe(0);
    });
});
