export interface ParseResult {
    title: string;
    text: string;
}

export class UnsupportedFileError extends Error {
    constructor(public readonly filename: string) {
        super(`Unsupported file type: ${filename}`);
        this.name = 'UnsupportedFileError';
    }
}

/**
 * A PDF with almost no selectable text: a photo of a page saved as a PDF.
 * It opens and displays fine, which is exactly why it needs its own error —
 * nobody can tell by looking that there are no words inside to read.
 */
export class ScannedPdfError extends Error {
    constructor(public readonly filename: string) {
        super(`Scanned PDF: ${filename}`);
        this.name = 'ScannedPdfError';
    }
}

/** A PDF that refuses to open without a password. */
export class PasswordProtectedError extends Error {
    constructor(public readonly filename: string) {
        super(`Password-protected PDF: ${filename}`);
        this.name = 'PasswordProtectedError';
    }
}
