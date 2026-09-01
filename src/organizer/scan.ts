import type { ScannedFile, ScannedUnit, ScanResult } from '@/organizer/classify';

/**
 * Read-only scan of a dropped folder.
 *
 * The important part is what it refuses to descend into. A code repository, a
 * node_modules tree or an installed application is a single thing whose
 * internal layout is load-bearing; "organizing" its files individually
 * destroys it. Those directories are recorded as atomic units and never
 * walked, so the classifier downstream cannot see their contents at all.
 */

const UNIT_MARKERS: { file: string; kind: string }[] = [
    { file: 'package.json', kind: 'Node project' },
    { file: 'pyproject.toml', kind: 'Python project' },
    { file: 'requirements.txt', kind: 'Python project' },
    { file: 'Cargo.toml', kind: 'Rust project' },
    { file: 'go.mod', kind: 'Go project' },
    { file: 'pom.xml', kind: 'Java project' },
    { file: 'build.gradle', kind: 'Gradle project' },
    { file: 'Gemfile', kind: 'Ruby project' },
    { file: 'composer.json', kind: 'PHP project' },
    { file: 'CMakeLists.txt', kind: 'C/C++ project' },
    { file: '.git', kind: 'Git repository' },
];

const UNIT_DIR_NAMES = new Set([
    'node_modules', '.git', '.svn', 'venv', '.venv', '__pycache__', 'vendor',
    'target', 'build', 'dist', '.next', '.nuxt', '.cache', 'Pods',
]);

const UNIT_DIR_SUFFIXES = ['.app', '.framework', '.xcodeproj', '.bundle', '.asar'];

export const MAX_FILES = 5000;

const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
        const all: FileSystemEntry[] = [];
        const pump = (): void =>
            reader.readEntries((batch) => {
                if (batch.length === 0) {
                    resolve(all);
                    return;
                }
                all.push(...batch);
                pump();
            }, reject);
        pump();
    });

const getFile = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

const looksAtomic = (name: string, children: FileSystemEntry[]): string | null => {
    if (UNIT_DIR_NAMES.has(name)) return 'Build or dependency directory';
    for (const suffix of UNIT_DIR_SUFFIXES) {
        if (name.endsWith(suffix)) return 'Application bundle';
    }
    const childNames = new Set(children.map((c) => c.name));
    for (const marker of UNIT_MARKERS) {
        if (childNames.has(marker.file)) return marker.kind;
    }
    return null;
};

export const scanDirectory = async (root: FileSystemDirectoryEntry): Promise<ScanResult> => {
    const files: ScannedFile[] = [];
    const units: ScannedUnit[] = [];
    let truncated = false;

    const walk = async (dir: FileSystemDirectoryEntry, relative: string): Promise<void> => {
        if (truncated) return;
        const children = await readEntries(dir.createReader());

        for (const child of children) {
            if (truncated) return;
            if (child.name.startsWith('.') && child.isDirectory) continue;

            if (child.isDirectory) {
                const directory = child as FileSystemDirectoryEntry;
                const grandChildren = await readEntries(directory.createReader());
                const kind = looksAtomic(child.name, grandChildren);
                if (kind) {
                    units.push({
                        path: `${relative}/${child.name}`.replace(/^\//, ''),
                        kind,
                        fileCount: grandChildren.length,
                    });
                    continue;
                }
                await walk(directory, `${relative}/${child.name}`);
                continue;
            }

            const file = await getFile(child as FileSystemFileEntry);
            files.push({
                path: `${relative}/${file.name}`.replace(/^\//, ''),
                name: file.name,
                size: file.size,
                dir: relative.replace(/^\//, ''),
            });
            if (files.length >= MAX_FILES) {
                truncated = true;
                return;
            }
        }
    };

    await walk(root, '');
    return { root: root.name, files, units, truncated };
};
