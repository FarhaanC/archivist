import type { ImportOutcome } from '@/ingestion/import-files';

/**
 * What happened to each file you dropped in.
 *
 * Written for someone who does not care what a "near-duplicate" is. The label
 * says whether the file went in; the sentence under it says what that means;
 * and where two files are nearly the same, the differences are listed as
 * ordinary sentences rather than as a diff.
 */

const LABEL: Record<ImportOutcome['status'], { label: string; className: string }> = {
    imported: { label: 'Added', className: 'pill good' },
    'near-duplicate': { label: 'Added', className: 'pill good' },
    duplicate: { label: 'Already saved', className: 'pill' },
    skipped: { label: 'Skipped', className: 'pill' },
    failed: { label: 'Couldn’t read', className: 'pill warn' },
};

/** Whether the file actually went into the library. Near-duplicates do: they
 *  are stored, and merely flagged as close to something already there. */
const wasAdded = (outcome: ImportOutcome): boolean =>
    outcome.status === 'imported' || outcome.status === 'near-duplicate';

const Explanation = ({ outcome }: { outcome: ImportOutcome }): JSX.Element => {
    switch (outcome.status) {
        case 'imported':
            return <span className="small muted">Added to your library.</span>;

        case 'duplicate':
            return (
                <span className="small muted">
                    You already have this one, saved as <strong>{outcome.of}</strong>. It
                    wasn’t added again.
                </span>
            );

        case 'near-duplicate':
            return (
                <div className="small muted">
                    <div>
                        Added. It’s almost the same as <strong>{outcome.of}</strong>, which
                        is already in your library.
                    </div>
                    {outcome.changes.points.length > 0 ? (
                        <>
                            <div style={{ marginTop: 5 }}>What’s different in this one:</div>
                            <ul className="diff-points">
                                {outcome.changes.points.map((point) => (
                                    <li key={point}>{point}</li>
                                ))}
                            </ul>
                            {outcome.changes.minorCount > 0 && (
                                <div>
                                    …and {outcome.changes.minorCount} smaller wording{' '}
                                    {outcome.changes.minorCount === 1 ? 'change' : 'changes'}.
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{ marginTop: 5 }}>
                            The wording is identical — only spacing and punctuation differ.
                        </div>
                    )}
                </div>
            );

        default:
            return <span className="small muted">{outcome.reason}</span>;
    }
};

/** Every file gets a row. A silent skip is how a library quietly loses documents. */
export const ImportReport = ({ report }: { report: ImportOutcome[] }): JSX.Element | null => {
    if (report.length === 0) return null;

    const added = report.filter(wasAdded).length;
    const alreadyHad = report.filter((r) => r.status === 'duplicate').length;
    const notRead = report.length - added - alreadyHad;

    // Counting only the plain 'imported' rows was wrong, and it was the most
    // confusing number on the page: a batch that was mostly near-duplicates
    // reported "2 of 9 added" while quietly adding seven of them.
    const summary = [
        `${added} of ${report.length} added`,
        alreadyHad > 0 ? `${alreadyHad} already saved` : '',
        notRead > 0 ? `${notRead} not read` : '',
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="card">
            <div className="spread" style={{ marginBottom: 8 }}>
                <strong>What happened to your files</strong>
                <span className="small muted">{summary}</span>
            </div>
            <div className="scroll">
                <table className="report">
                    <tbody>
                        {report.map((outcome, index) => (
                            <tr key={`${outcome.file}-${index}`}>
                                <td>
                                    <span className={LABEL[outcome.status].className}>
                                        {LABEL[outcome.status].label}
                                    </span>
                                </td>
                                <td>
                                    <div className="report-file">{outcome.file}</div>
                                    <Explanation outcome={outcome} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
