import type { ImportOutcome } from '@/ingestion/import-files';

/**
 * What happened to each file you dropped in.
 *
 * Written for someone who does not care what a "near-duplicate" is. The label
 * says whether the file went in; the sentence under it says what that means;
 * and where two files are nearly the same, the differences are listed as
 * ordinary sentences rather than as a diff.
 */

/** The pill. For files that didn't go in, the wording comes from the problem
 *  itself: a scan is a document we "couldn't read", an installer is "not a
 *  document" — the difference between "this needs fixing" and "ignore this". */
const labelFor = (outcome: ImportOutcome): { label: string; className: string } => {
    switch (outcome.status) {
        case 'imported':
        case 'near-duplicate':
            return { label: 'Added', className: 'pill good' };
        case 'duplicate':
            return { label: 'Already saved', className: 'pill' };
        default:
            return {
                label: outcome.problem.label,
                className: outcome.problem.label === 'Not a document' ? 'pill' : 'pill warn',
            };
    }
};

/** Whether the file actually went into the library. Near-duplicates do: they
 *  are stored, and merely flagged as close to something already there. */
const wasAdded = (outcome: ImportOutcome): boolean =>
    outcome.status === 'imported' || outcome.status === 'near-duplicate';

const Explanation = ({ outcome }: { outcome: ImportOutcome }): JSX.Element => {
    switch (outcome.status) {
        case 'imported':
            if (!outcome.readAsScan) {
                return <span className="small muted">Added to your library.</span>;
            }
            // The extra clause is earned only where looking again actually
            // produced a better reading. A second look that was tried and did
            // not help changed nothing the person can see, so announcing it
            // would be noise about the app's own effort.
            return outcome.secondLook?.improved ? (
                <span className="small muted">
                    Added. This one was a scan and hard to read, so it was read{' '}
                    {outcome.secondLook.attempts === 2 ? 'twice' : 'three times'} and the
                    clearer reading kept — the odd word may still be wrong, and the
                    passages shown with an answer will tell you.
                </span>
            ) : (
                <span className="small muted">
                    Added. This one was a scan, so the words were read off the picture of
                    the page — the odd one may be wrong, and the passages shown with an
                    answer will tell you.
                </span>
            );

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
            return (
                <div className="small muted">
                    <div>{outcome.problem.headline}</div>
                    <div style={{ marginTop: 5 }}>
                        <strong>What you can do:</strong> {outcome.problem.whatToDo}
                    </div>
                </div>
            );
    }
};

/** Every file gets a row. A silent skip is how a library quietly loses documents. */
export const ImportReport = ({ report }: { report: ImportOutcome[] }): JSX.Element | null => {
    if (report.length === 0) return null;

    const added = report.filter(wasAdded).length;
    const alreadyHad = report.filter((r) => r.status === 'duplicate').length;
    const notDocuments = report.filter(
        (r) => (r.status === 'skipped' || r.status === 'failed') && r.problem.label === 'Not a document',
    ).length;
    const couldNotRead = report.length - added - alreadyHad - notDocuments;

    // Counting only the plain 'imported' rows was wrong, and it was the most
    // confusing number on the page: a batch that was mostly near-duplicates
    // reported "2 of 9 added" while quietly adding seven of them. "14 not read"
    // was the next confusing number — it lumped four installers in with ten
    // real documents, so the total looked far worse than it was.
    const summary = [
        `${added} of ${report.length} added`,
        alreadyHad > 0 ? `${alreadyHad} already saved` : '',
        couldNotRead > 0 ? `${couldNotRead} couldn’t be read` : '',
        notDocuments > 0 ? `${notDocuments} ${notDocuments === 1 ? 'wasn’t' : 'weren’t'} documents` : '',
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="card">
            <div className="spread" style={{ marginBottom: 8 }}>
                <strong>What happened to your files</strong>
                <span className="small muted">{summary}</span>
            </div>
            <div>
                <table className="report">
                    <tbody>
                        {report.map((outcome, index) => (
                            <tr key={`${outcome.file}-${index}`}>
                                <td>
                                    <span className={labelFor(outcome).className}>
                                        {labelFor(outcome).label}
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
