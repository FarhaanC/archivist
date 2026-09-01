/**
 * Helpers for bulk uploads: filter supported types and recursively collect
 * files from dropped folders (DataTransfer directory entries).
 */

/** Documents with dedicated parsers */
const DOCUMENT_EXTENSIONS = ["pdf", "docx", "xlsx", "xls", "ods", "pptx"];

/** Anything text-like is parsed as plain text and indexed */
const TEXT_EXTENSIONS = [
    "txt", "md", "markdown", "csv", "tsv", "json", "log",
    "html", "htm", "xml", "yaml", "yml", "ini", "toml",
    // common code files — useful for indexing snippets/docs
    "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "h", "cs",
    "rb", "go", "rs", "php", "sql", "sh", "bat", "ps1",
];

/** Recognized when organizing a folder, but not indexed: Archivist has no
 *  OCR or transcription yet, so these are filed, never read. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "webm", "ogg", "flac"];

/** Types the ingestion pipeline can actually read. */
export const SUPPORTED_EXTENSION_GROUPS = {
    Documents: DOCUMENT_EXTENSIONS,
    "Text & code": TEXT_EXTENSIONS,
} as const;

const ORGANIZABLE_EXTENSIONS = new Set([
    ...DOCUMENT_EXTENSIONS,
    ...TEXT_EXTENSIONS,
    ...IMAGE_EXTENSIONS,
    ...AUDIO_EXTENSIONS,
]);

/** Wider than isSupportedFile: the organizer files photos and recordings it
 *  cannot read, because leaving them unsorted defeats the point. */
export const isOrganizableFile = (name: string): boolean => {
    if (name.startsWith(".")) return false;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return ORGANIZABLE_EXTENSIONS.has(ext);
};

const SUPPORTED_EXTENSIONS = new Set([
    ...DOCUMENT_EXTENSIONS,
    ...TEXT_EXTENSIONS,
]);

/** Lowercased extension including the leading dot, or "" if there is none. */
export const extensionOf = (name: string): string => {
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

/** For <input accept="...">  */
export const ACCEPT_ATTR = [...SUPPORTED_EXTENSIONS]
    .map((e) => `.${e}`)
    .join(",");

export const isSupportedFile = (name: string): boolean => {
    if (name.startsWith(".")) return false; // hidden files
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return SUPPORTED_EXTENSIONS.has(ext);
};

export interface CollectedFiles {
    files: File[];
    /** Names of files that were skipped because their type is unsupported */
    skipped: string[];
}

const readAllEntries = (
    reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

const entryToFile = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

const walkEntry = async (
    entry: FileSystemEntry,
    out: File[]
): Promise<void> => {
    if (entry.name.startsWith(".")) return; // hidden files/folders
    if (entry.isFile) {
        try {
            out.push(await entryToFile(entry as FileSystemFileEntry));
        } catch (err) {
            console.warn(`[Upload] Could not read entry ${entry.fullPath}:`, err);
        }
    } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        // readEntries returns batches (Chromium caps at 100) — drain until empty
        let batch: FileSystemEntry[];
        do {
            batch = await readAllEntries(reader);
            for (const child of batch) {
                await walkEntry(child, out);
            }
        } while (batch.length > 0);
    }
};

const partition = (all: File[]): CollectedFiles => {
    const files: File[] = [];
    const skipped: string[] = [];
    for (const f of all) {
        if (isSupportedFile(f.name)) files.push(f);
        else skipped.push(f.name);
    }
    return { files, skipped };
};

/**
 * Collect all files from a drop event, walking into dropped folders.
 */
export const collectFilesFromDataTransfer = async (
    dt: DataTransfer
): Promise<CollectedFiles> => {
    const collected: File[] = [];
    const entries = Array.from(dt.items)
        .map((item) =>
            typeof item.webkitGetAsEntry === "function"
                ? item.webkitGetAsEntry()
                : null
        )
        .filter((e): e is FileSystemEntry => e !== null);

    if (entries.length > 0) {
        for (const entry of entries) {
            await walkEntry(entry, collected);
        }
    } else {
        collected.push(...Array.from(dt.files));
    }

    return partition(collected);
};

/** Filter a FileList (from an <input multiple> or webkitdirectory input). */
export const collectFilesFromInput = (list: FileList): CollectedFiles =>
    partition(Array.from(list));
