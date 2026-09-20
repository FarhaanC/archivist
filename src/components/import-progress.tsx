import { useEffect, useRef, useState } from 'react';
import { describeRemaining, phaseOf, shouldPulse, PULSE_AFTER_MS } from '@/ingestion/import-timing';
import type { ImportPhase } from '@/ingestion/import-timing';
import type { ImportProgress } from '@/ingestion/import-files';

/**
 * What you see while Archivist is reading your files.
 *
 * The card has three different looks rather than one bar doing everything,
 * because the three waits are not the same kind of wait. Loading the scan
 * reader has nothing to count, so it does not pretend to: it says what it is
 * doing and shows a bar with no number on it. Reading has plenty to count, so
 * it counts — files, pages, a percentage, and a rounded guess at the time
 * left. Saving the tail end has almost nothing left to say, so it says
 * "Finishing up" and leaves the bar full.
 *
 * The rules this follows, and where each came from, are written down in
 * docs/progress-design-notes.md. The short version: never go backwards, never
 * sit still without saying why, round the estimate hard, and count in files
 * and pages rather than in anything the machine cares about.
 */

/** How often the estimate may be read out to a screen reader. Any faster and
 *  the announcements talk over each other and over everything else. */
const ANNOUNCE_EVERY_MS = 5000;

/**
 * How full the bar is: the files already finished with, plus however far
 * through the files being read right now. Capped at whole, because a bar that
 * overshoots and a bar that goes backwards both read as something having gone
 * wrong.
 */
export const barWidth = (progress: ImportProgress): number => {
    if (progress.total === 0) return 0;
    const reading = progress.inFlight.reduce((sum, file) => sum + file.fraction, 0);
    return Math.min(1, (progress.done + reading) / progress.total);
};

/** Everything on the card that can change. Used only to notice when nothing
 *  has, so the bar can show it is still alive. */
const signatureOf = (progress: ImportProgress): string =>
    [
        progress.done,
        progress.read,
        progress.failed,
        progress.readerStarting,
        describeRemaining(progress.secondsLeft) ?? '',
        progress.inFlight.map((file) => `${file.file}:${file.detail}:${file.fraction.toFixed(2)}`),
    ].join('|');

/** A value that is allowed to reach the screen reader only now and then. */
const useThrottled = <T,>(value: T, everyMs: number): T => {
    const [shown, setShown] = useState(value);
    const shownAt = useRef(0);

    useEffect(() => {
        if (value === shown) return;
        const wait = Math.max(0, shownAt.current + everyMs - Date.now());
        if (wait === 0) {
            shownAt.current = Date.now();
            setShown(value);
            return;
        }
        const timer = setTimeout(() => {
            shownAt.current = Date.now();
            setShown(value);
        }, wait);
        return () => clearTimeout(timer);
    }, [value, shown, everyMs]);

    return shown;
};

/** True once nothing on the card has changed for long enough to look stuck. */
const useStalled = (signature: string): boolean => {
    const [stalled, setStalled] = useState(false);
    const changedAt = useRef(Date.now());

    useEffect(() => {
        changedAt.current = Date.now();
        setStalled(false);
        const timer = setInterval(() => {
            setStalled(shouldPulse(Date.now() - changedAt.current));
        }, PULSE_AFTER_MS / 4);
        return () => clearInterval(timer);
    }, [signature]);

    return stalled;
};

const HEADLINES: Record<Exclude<ImportPhase, 'done'>, string> = {
    'getting-ready': 'Getting ready',
    reading: 'Reading your files',
    finishing: 'Finishing up',
};

export const ImportProgressCard = ({ progress }: { progress: ImportProgress }): JSX.Element | null => {
    const phase = phaseOf(progress);
    // The bar is only ever allowed to move forward.
    const furthest = useRef(0);
    const stalled = useStalled(signatureOf(progress));

    const estimate = describeRemaining(progress.secondsLeft);
    const announced = useThrottled(estimate, ANNOUNCE_EVERY_MS);

    if (phase === 'done') {
        furthest.current = 0;
        return null;
    }

    if (phase === 'reading') furthest.current = Math.max(furthest.current, barWidth(progress));
    const fraction = phase === 'finishing' ? 1 : phase === 'getting-ready' ? 0 : furthest.current;
    const percent = Math.round(fraction * 100);

    const single = progress.total === 1;
    const onlyFile = progress.inFlight[0];
    const headline =
        phase === 'reading' && single && onlyFile
            ? `Reading ${onlyFile.file}`
            : HEADLINES[phase];

    return (
        <div className="card import-progress">
            <div className="spread" style={{ marginBottom: 8, alignItems: 'baseline' }}>
                <strong className="import-headline" title={single && onlyFile ? onlyFile.file : undefined}>
                    {headline}
                </strong>
                {phase === 'reading' && !single && (
                    <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
                        {progress.done} of {progress.total} done
                    </span>
                )}
            </div>

            <div className="progress-row">
                <div
                    className={
                        'progress big' +
                        (phase === 'getting-ready' ? ' unknown' : '') +
                        (stalled && phase !== 'getting-ready' ? ' alive' : '')
                    }
                    role="progressbar"
                    aria-label="How far through reading your files"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    // Left off entirely while there is nothing to count, which
                    // is how a screen reader is told "unknown" rather than
                    // being told a number that means nothing.
                    {...(phase === 'getting-ready' ? {} : { 'aria-valuenow': percent })}
                >
                    <div style={phase === 'getting-ready' ? undefined : { width: `${percent}%` }} />
                </div>
                {phase === 'reading' && (
                    <span className="progress-percent small muted">{percent}%</span>
                )}
            </div>

            {phase === 'getting-ready' && (
                <p className="small muted import-note">
                    Getting the scan reader ready — this happens once.
                </p>
            )}

            {phase === 'reading' && (
                <>
                    {progress.inFlight.map((file) => (
                        <div key={file.file} className="import-file">
                            <div className="small muted import-file-line">
                                <span className="import-file-name" title={file.file}>
                                    {file.file}
                                </span>
                                {file.detail && <span className="import-file-detail"> — {file.detail}</span>}
                            </div>
                            <div className="progress thin" aria-hidden="true">
                                <div style={{ width: `${Math.round(file.fraction * 100)}%` }} />
                            </div>
                        </div>
                    ))}
                    {progress.inFlight.length > 0 && !single && (
                        <p className="small muted import-note">Scans take a few seconds a page.</p>
                    )}
                </>
            )}

            {phase === 'finishing' && (
                <p className="small muted import-note">
                    Saving the last of them to your library.
                </p>
            )}

            {progress.failed > 0 && (
                <p className="small import-note" style={{ color: 'var(--warn)' }}>
                    {progress.failed} couldn’t be read — details below when this finishes.
                </p>
            )}

            {/* The estimate, and the only thing here a screen reader is told
                about as it changes. Held back to one announcement every few
                seconds so it does not talk over itself. */}
            <p
                className="small muted import-note import-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >
                {announced ?? ''}
            </p>
        </div>
    );
};
