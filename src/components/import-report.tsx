import type { ImportOutcome } from '@/ingestion/import-files';

const PILL: Record<ImportOutcome['status'], { label: string; className: string }> = {
    imported: { label: 'imported', className: 'pill good' },
    'near-duplicate': { label: 'near-duplicate', className: 'pill warn' },
    duplicate: { label: 'duplicate', className: 'pill' },
    skipped: { label: 'skipped', className: 'pill' },
    failed: { label: 'failed', className: 'pill warn' },
};

const detail = (outcome: ImportOutcome): string => {
    switch (outcome.status) {
        case 'imported':
            return '';
        case 'duplicate':
            return `Identical content to “${outcome.of}” — not imported again.`;
        case 'near-duplicate':
            return `Nearly identical to “${outcome.of}”. ${outcome.diff}`;
        default:
            return outcome.reason;
    }
};

/** Every file gets a row. A silent skip is how a library quietly loses documents. */
export const ImportReport = ({ report }: { report: ImportOutcome[] }): JSX.Element | null => {
    if (report.length === 0) return null;
    const imported = report.filter((r) => r.status === 'imported').length;

    return (
        <div className="card">
            <div className="spread" style={{ marginBottom: 8 }}>
                <strong>Import report</strong>
                <span className="small muted">
                    {imported} of {report.length} added
                </span>
            </div>
            <div className="scroll">
                <table className="report">
                    <tbody>
                        {report.map((outcome, index) => (
                            <tr key={`${outcome.file}-${index}`}>
                                <td>
                                    <span className={PILL[outcome.status].className}>
                                        {PILL[outcome.status].label}
                                    </span>
                                </td>
                                <td>
                                    <div>{outcome.file}</div>
                                    {detail(outcome) && (
                                        <div className="small muted">{detail(outcome)}</div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
