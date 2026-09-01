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
