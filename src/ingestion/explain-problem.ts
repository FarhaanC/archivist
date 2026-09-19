import {
    PasswordProtectedError,
    ScannedPdfError,
    UnreadableImageError,
    UnsupportedFileError,
} from '@/parsers/types';

/**
 * Why a file could not be added, in words for someone who has never heard of
 * a text layer.
 *
 * Every explanation has the same three parts: what the file *is* (a photo of a
 * page, a locked PDF, a program), why that means it can't be read, and what
 * the person can do right now. "Run it through OCR before importing" failed
 * that test — it named the problem correctly and left the reader with nothing
 * to do. The technical cause is kept in `kind` for anyone who wants it; the
 * sentences are the product.
 */

export type ProblemKind =
    | 'scanned-pdf'
    | 'locked-pdf'
    | 'image'
    | 'audio'
    | 'video'
    | 'program'
    | 'archive'
    | 'unknown-type'
    | 'empty'
    | 'offline'
    | 'damaged';

export interface ImportProblem {
    kind: ProblemKind;
    /** Short label for the pill: whether this is a document we can't read yet,
     *  or something that was never a document to begin with. */
    label: 'Couldn’t read' | 'Not a document';
    /** What the file is and why it couldn't be read. One or two sentences. */
    headline: string;
    /** Something the person can actually do. Present tense, no jargon. */
    whatToDo: string;
}

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'heic', 'heif', 'tif', 'tiff']);
const AUDIO = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma', 'opus']);
const VIDEO = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'wmv']);
const PROGRAM = new Set(['exe', 'msi', 'dmg', 'pkg', 'apk', 'app', 'deb', 'rpm', 'bin', 'dll']);
const ARCHIVE = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2']);

const extensionOf = (name: string): string => {
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/** Why a file of this type can't be read, judged from its name alone. Used for
 *  files that never reached a parser. */
export const explainFileType = (name: string): ImportProblem => {
    const ext = extensionOf(name);

    if (IMAGE.has(ext)) {
        // Only the picture types browsers can't draw reach here (HEIC from an
        // iPhone, TIFF from an office scanner); JPG and PNG go to the reader.
        return {
            kind: 'image',
            label: 'Couldn’t read',
            headline: `This is a picture in a format (“.${ext}”) that the browser can’t open, so Archivist can’t read the words off it.`,
            whatToDo:
                'Save or export it as a JPG or PNG — most phones and photo apps can — and add that. Archivist reads JPG and PNG photos of documents.',
        };
    }
    if (AUDIO.has(ext)) {
        return {
            kind: 'audio',
            label: 'Couldn’t read',
            headline: 'This is a sound recording. Archivist can’t listen to audio yet, so there’s nothing here it can search.',
            whatToDo: 'If you have a written transcript or notes from the recording, add those.',
        };
    }
    if (VIDEO.has(ext)) {
        return {
            kind: 'video',
            label: 'Couldn’t read',
            headline: 'This is a video. Archivist can’t watch or listen to it, so there’s nothing here it can search.',
            whatToDo: 'If you have notes or a transcript, add those instead.',
        };
    }
    if (PROGRAM.has(ext)) {
        return {
            kind: 'program',
            label: 'Not a document',
            headline: 'This is a program or installer, not a document. There’s no text inside it to read.',
            whatToDo: 'Nothing to do — it was skipped on purpose and your library is unaffected.',
        };
    }
    if (ARCHIVE.has(ext)) {
        return {
            kind: 'archive',
            label: 'Not a document',
            headline: 'This is a compressed folder (a “zip”). The documents are inside it, packed up, so Archivist can’t see them.',
            whatToDo: 'Unzip it first — usually a right-click and “Extract” — then add the files that come out.',
        };
    }
    return {
        kind: 'unknown-type',
        label: 'Not a document',
        headline: ext
            ? `Archivist doesn’t know how to read “.${ext}” files.`
            : 'This file’s name has no ending like “.pdf” or “.docx”, so Archivist can’t tell what kind of file it is.',
        whatToDo:
            'It reads PDFs, Word, Excel and PowerPoint files, and plain text. If this is a document, open it in its usual program and save a copy as PDF, then add that.',
    };
};

/** Why a file that *was* the right type still couldn't be read. */
export const explainError = (name: string, error: unknown): ImportProblem => {
    if (error instanceof ScannedPdfError && error.readerTried) {
        return {
            kind: 'scanned-pdf',
            label: 'Couldn’t read',
            headline:
                'This PDF is a photo of the page, not typed text. Archivist tried to read the words off the picture and couldn’t make out any — the scan may be blurry, too dark, very faint, or turned on its side.',
            whatToDo:
                'A clearer copy will usually work: scan it again at a higher setting, or take a straight-on photo in good light, and add that. If you can get this document as a typed PDF, Word, Excel or PowerPoint file, that’s better still.',
        };
    }
    if (error instanceof ScannedPdfError) {
        return {
            kind: 'scanned-pdf',
            label: 'Couldn’t read',
            headline:
                'This PDF is a photo of the page, not typed text. It opens and looks normal, but inside there are no actual words — only a picture of them — and the scan reader isn’t available right now.',
            whatToDo:
                'Try adding it again. If you can get this document as a typed PDF, Word, Excel or PowerPoint file, add that instead.',
        };
    }
    if (error instanceof UnreadableImageError) {
        return {
            kind: 'image',
            label: 'Couldn’t read',
            headline:
                'Archivist looked at this picture and couldn’t make out any words. It may be blurry, too dark, taken at a sharp angle, or not a document at all.',
            whatToDo:
                'If it is a document, take another photo straight-on in good light, or scan it, and add that.',
        };
    }
    if (error instanceof PasswordProtectedError) {
        return {
            kind: 'locked-pdf',
            label: 'Couldn’t read',
            headline:
                'This PDF is locked with a password. Banks and insurers often lock statements and welcome letters this way. Archivist can’t open locked files yet.',
            whatToDo:
                'Open it in your usual PDF viewer, type the password, then use “Print” or “Save as” to save a copy — the copy won’t have the password. Add that copy.',
        };
    }
    if (error instanceof UnsupportedFileError) {
        return explainFileType(name);
    }
    if (looksLikeNetworkFailure(error)) {
        return {
            kind: 'offline',
            label: 'Couldn’t read',
            headline:
                'The file itself is fine. Archivist needs to download one small helper (about 45 MB, once) before it can search anything, and it couldn’t reach the internet to get it.',
            whatToDo:
                'Check your connection and add the file again. After that first download, Archivist keeps working without the internet.',
        };
    }
    return {
        kind: 'damaged',
        label: 'Couldn’t read',
        headline:
            'Archivist opened this file but couldn’t make sense of it. It may be damaged, cut short by a download that didn’t finish, or an unusual version of the format.',
        whatToDo:
            'Open it in its usual program. If it opens fine there, save a fresh copy and add that. If it won’t open there either, the file itself is broken.',
    };
};

/** The browser's wording for "the network request never got an answer". A
 *  failed download of the search helper surfaces as one of these, and blaming
 *  the person's document for it is exactly wrong. */
const looksLikeNetworkFailure = (error: unknown): boolean =>
    error instanceof Error && /failed to fetch|networkerror|load failed|ERR_INTERNET|ERR_NAME_NOT_RESOLVED/i.test(error.message);

/** A file that parsed fine and turned out to contain no words at all. */
export const explainEmpty = (): ImportProblem => ({
    kind: 'empty',
    label: 'Couldn’t read',
    headline: 'This file opened fine, but there’s no text in it — it’s blank, or only contains pictures.',
    whatToDo: 'Check it in its usual program. If it should have text, save a fresh copy and try again.',
});
