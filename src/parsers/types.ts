import type { ScanReader } from '@/ocr/reader';
import type { ScanProgress } from '@/ocr/read-scan';
import type { SecondLook } from '@/ocr/second-look';

export interface ParseResult {
    title: string;
    text: string;
    /** True when the words came from reading a picture of the page rather
     *  than from text stored in the file. Scanned text can have the odd
     *  wrong word, and the person deserves to know which files those are. */
    readAsScan?: boolean;
    /** 0–100, only when readAsScan. */
    scanConfidence?: number;
    /** How many pages the scan reader had to read. Only set when the words
     *  were read off pictures, because that is the only case where the page
     *  count is what the waiting was made of. */
    pageCount?: number;
    /** Set when a picture was hard to read and so was read more than once.
     *  Only ever set when the words came off a picture. */
    secondLook?: SecondLook;
}

/** What a parser may need beyond the file: a scan reader for pictures of
 *  pages, and somewhere to report page-by-page progress while it reads. */
export interface ParseContext {
    reader?: ScanReader;
    onScanProgress?: (progress: ScanProgress) => void;
    /** Whether a picture that read badly is read again. Off unless asked
     *  for; see the same option on importFiles for why. */
    trySecondLook?: boolean;
}

export class UnsupportedFileError extends Error {
    constructor(public readonly filename: string) {
        super(`Unsupported file type: ${filename}`);
        this.name = 'UnsupportedFileError';
    }
}

/**
 * A PDF with no text of its own — a photo of a page saved as a PDF — that
 * the scan reader could not read either (no reader available, or the reader
 * found nothing it was sure about: too blurry, too dark, rotated).
 */
export class ScannedPdfError extends Error {
    constructor(
        public readonly filename: string,
        /** Whether a reader actually tried and failed, as opposed to none being available. */
        public readonly readerTried: boolean,
    ) {
        super(`Scanned PDF: ${filename}`);
        this.name = 'ScannedPdfError';
    }
}

/** A picture that the scan reader could not read anything from. */
export class UnreadableImageError extends Error {
    constructor(public readonly filename: string) {
        super(`Unreadable image: ${filename}`);
        this.name = 'UnreadableImageError';
    }
}

/** A PDF that refuses to open without a password. */
export class PasswordProtectedError extends Error {
    constructor(public readonly filename: string) {
        super(`Password-protected PDF: ${filename}`);
        this.name = 'PasswordProtectedError';
    }
}
