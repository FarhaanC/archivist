import { useEffect, useState } from 'react';
import {
    compareWith,
    describeKind,
    forgetRuns,
    formatShort,
    formatDuration,
    listRuns,
    summarize,
    toCsv,
    toPlainText,
} from '@/ingestion/import-timing';
import type { ImportRunRecord } from '@/db/types';

/**
 * How long that took.
 *
 * The point of this section is that a person can answer "was that slow?"
 * without a stopwatch and without opening anything a developer would open.
 * It says the number in a sentence, compares it with last time when the two
 * are actually comparable, and keeps the details folded away for whoever
 * wants them.
 *
 * Everything here was measured in this browser and stays in it. Copying and
 * downloading are so the person can paste a number into a message; nothing is
 * sent anywhere.
 */

const formatWhen = (at: number): string =>
    new Date(at).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
    });

const download = (name: string, text: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
};

const Details = ({ run }: { run: ImportRunRecord }): JSX.Element => {
    // Slowest first: the question anyone opening this has is "what took the
    // time?", and the answer should be the first row.
    const rows = [...run.files].sort((a, b) => b.readMs + b.saveMs - (a.readMs + a.saveMs));
    return (
        <>
            <div className="scroll">
                <table className="timings">
                    <thead>
                        <tr>
                            <th>File</th>
                            <th>What it was</th>
                            <th>Pages</th>
                            <th>Reading</th>
                            <th>Saving</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => (
                            <tr key={`${row.file}-${index}`}>
                                <td className="timings-file" title={row.file}>
                                    {row.file}
                                </td>
                                <td>{describeKind(row.kind)}</td>
                                <td>{row.pages ?? '—'}</td>
                                <td>{formatShort(row.readMs)}</td>
                                <td>{formatShort(row.saveMs)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
                {run.engineCopies} {run.engineCopies === 1 ? 'copy' : 'copies'} of the scan reader
                {run.cores > 0 ? ` on a machine with ${run.cores} cores` : ''}
                {run.usedScanReader
                    ? run.firstRun
                        ? ' · first time on this machine, so it had to load the reader'
                        : ' · the reader was already loaded'
                    : ' · no scans, so the reader was never needed'}
                {' · Archivist '}
                {run.appVersion}
            </p>
        </>
    );
};

/**
 * The one line that replaces the progress card the moment an import
 * finishes, directly above the report. Same place on the page, so nothing
 * jumps; the card was a promise about time and this is what it came to.
 */
export const ImportSummary = ({ run }: { run: ImportRunRecord | null }): JSX.Element | null => {
    const [history, setHistory] = useState<ImportRunRecord[]>([]);

    useEffect(() => {
        void listRuns(10).then(setHistory);
    }, [run]);

    if (!run) return null;
    const comparison = compareWith(run, history);

    return (
        <div className="card import-summary">
            <p style={{ margin: 0 }}>{summarize(run)}</p>
            {comparison && (
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                    {comparison}
                </p>
            )}
        </div>
    );
};

export const ImportTimings = ({ run }: { run: ImportRunRecord | null }): JSX.Element | null => {
    const [history, setHistory] = useState<ImportRunRecord[]>([]);
    const [selected, setSelected] = useState<ImportRunRecord | null>(null);
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    const [copied, setCopied] = useState(false);

    const refresh = async (): Promise<void> => setHistory(await listRuns(10));

    useEffect(() => {
        void refresh();
    }, [run]);

    useEffect(() => {
        setSelected(run);
        setCopyFailed(false);
        setCopied(false);
    }, [run]);

    const showing = selected ?? run;
    if (!showing && history.length === 0) return null;

    const copy = async (): Promise<void> => {
        if (!showing) return;
        try {
            await navigator.clipboard.writeText(toPlainText(showing));
            setCopied(true);
            setCopyFailed(false);
        } catch {
            // Browsers refuse the clipboard in plenty of ordinary situations.
            // Showing the text is the same favour by another route.
            setCopyFailed(true);
            setCopied(false);
        }
    };

    return (
        <div className="card">
            <div className="spread" style={{ marginBottom: 8 }}>
                <strong>How long that took</strong>
                {showing && (
                    <span className="small muted">{formatWhen(showing.startedAt)}</span>
                )}
            </div>

            {showing ? (
                <>
                    <p style={{ margin: '0 0 4px' }}>{summarize(showing)}</p>
                    {compareWith(showing, history) && (
                        <p className="small muted" style={{ margin: '0 0 10px' }}>
                            {compareWith(showing, history)}
                        </p>
                    )}

                    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <button className="ghost" onClick={() => setOpen((was) => !was)}>
                            {open ? 'Hide the details' : 'See the details'}
                        </button>
                        <button className="ghost" onClick={() => void copy()}>
                            {copied ? 'Copied' : 'Copy as text'}
                        </button>
                        <button
                            className="ghost"
                            onClick={() =>
                                download(
                                    `archivist-import-${new Date(showing.startedAt)
                                        .toISOString()
                                        .slice(0, 19)
                                        .replace(/[:T]/g, '-')}.csv`,
                                    toCsv(showing),
                                )
                            }
                        >
                            Download as CSV
                        </button>
                    </div>

                    {copyFailed && (
                        <>
                            <p className="small" style={{ color: 'var(--warn)' }}>
                                Couldn’t copy — select the text below instead.
                            </p>
                            <textarea
                                readOnly
                                rows={8}
                                className="mono"
                                value={toPlainText(showing)}
                                onFocus={(event) => event.currentTarget.select()}
                            />
                        </>
                    )}

                    {open && <Details run={showing} />}
                </>
            ) : (
                <p className="small muted" style={{ margin: 0 }}>
                    Nothing has been imported yet this session.
                </p>
            )}

            {history.length > 0 && (
                <>
                    <div className="label" style={{ marginTop: 14 }}>
                        Past imports
                    </div>
                    <ul className="plain">
                        {history.map((past) => (
                            <li key={past.id ?? past.startedAt}>
                                <button
                                    className="ghost timings-past"
                                    aria-pressed={showing?.id === past.id}
                                    onClick={() => {
                                        setSelected(past);
                                        setOpen(true);
                                    }}
                                >
                                    <span>{formatWhen(past.startedAt)}</span>
                                    <span className="small muted">
                                        {past.fileCount} file{past.fileCount === 1 ? '' : 's'}
                                        {past.pages > 0
                                            ? ` · ${past.pages} page${past.pages === 1 ? '' : 's'}`
                                            : ''}
                                        {' · '}
                                        {formatDuration(past.totalMs)}
                                        {' · '}
                                        {past.engineCopies}{' '}
                                        {past.engineCopies === 1 ? 'copy' : 'copies'}
                                        {past.standard ? ' · standard test' : ''}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>

                    {confirming ? (
                        <div className="row" style={{ gap: 8, marginTop: 8 }}>
                            <span className="small">
                                Forget {history.length} past import
                                {history.length === 1 ? '' : 's'}?
                            </span>
                            <button
                                className="ghost"
                                onClick={() => {
                                    void forgetRuns().then(() => {
                                        setConfirming(false);
                                        setSelected(null);
                                        void refresh();
                                    });
                                }}
                            >
                                Yes
                            </button>
                            <button className="ghost" onClick={() => setConfirming(false)}>
                                No
                            </button>
                        </div>
                    ) : (
                        <button
                            className="ghost"
                            style={{ marginTop: 8 }}
                            onClick={() => setConfirming(true)}
                        >
                            Forget these timings
                        </button>
                    )}
                </>
            )}
        </div>
    );
};
