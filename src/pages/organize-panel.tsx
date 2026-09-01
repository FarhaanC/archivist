import { useState } from 'react';
import { buildPlan, type OrganizePlan } from '@/organizer/classify';
import { scanDirectory } from '@/organizer/scan';

/**
 * Organizer, phase 1: propose a filing plan and show it. Nothing is written,
 * moved or deleted here — the plan is the deliverable, and a human approves
 * (or doesn't) before any phase 2 ever touches a file.
 */
export const OrganizePanel = (): JSX.Element => {
    const [plan, setPlan] = useState<OrganizePlan | null>(null);
    const [scanning, setScanning] = useState(false);
    const [dragging, setDragging] = useState(false);

    const handleDrop = async (transfer: DataTransfer): Promise<void> => {
        const entry = [...transfer.items]
            .map((item) => item.webkitGetAsEntry())
            .find((candidate): candidate is FileSystemDirectoryEntry => !!candidate?.isDirectory);
        if (!entry) return;
        setScanning(true);
        try {
            setPlan(buildPlan(await scanDirectory(entry)));
        } finally {
            setScanning(false);
        }
    };

    return (
        <>
            <div
                className={dragging ? 'dropzone over' : 'dropzone'}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void handleDrop(event.dataTransfer);
                }}
            >
                <p style={{ margin: 0 }}>
                    {scanning ? 'Scanning…' : 'Drop a folder to see how it would be filed'}
                </p>
                <p className="small" style={{ marginBottom: 0 }}>
                    Read-only. Nothing is moved, copied or deleted.
                </p>
            </div>

            {plan && (
                <>
                    {plan.truncated && (
                        <div className="card small" style={{ color: 'var(--warn)' }}>
                            Stopped after the first 5,000 files — this is a preview of a large folder.
                        </div>
                    )}

                    {Object.entries(plan.groups).map(([category, files]) => (
                        <div className="card" key={category}>
                            <div className="spread" style={{ marginBottom: 6 }}>
                                <strong>{category}</strong>
                                <span className="pill">{files.length}</span>
                            </div>
                            <ul className="plain small">
                                {files.slice(0, 12).map((file) => (
                                    <li key={file.path}>
                                        {file.name}
                                        {file.dir && <span className="muted"> — {file.dir}</span>}
                                    </li>
                                ))}
                                {files.length > 12 && (
                                    <li className="muted">and {files.length - 12} more</li>
                                )}
                            </ul>
                        </div>
                    ))}

                    {plan.excludedUnits.length > 0 && (
                        <div className="card">
                            <strong className="small">Left intact</strong>
                            <p className="small muted" style={{ marginTop: 4 }}>
                                Projects and application bundles are single units — filing their
                                contents individually would break them.
                            </p>
                            <ul className="plain small">
                                {plan.excludedUnits.map((unit) => (
                                    <li key={unit.path}>
                                        {unit.path} <span className="pill">{unit.kind}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {plan.untouched.length > 0 && (
                        <div className="card">
                            <strong className="small">Not touched ({plan.untouched.length})</strong>
                            <ul className="plain small">
                                {plan.untouched.slice(0, 10).map((file) => (
                                    <li key={`${file.dir}/${file.name}`}>
                                        {file.name} <span className="muted">— {file.reason}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </>
    );
};
