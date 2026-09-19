import * as pdfjs from 'pdfjs-dist';
import { PasswordProtectedError, ScannedPdfError } from '@/parsers/types';
import type { ParseResult } from '@/parsers/types';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

/**
 * Text extraction, page by page. PDF has no notion of a paragraph — it has
 * positioned text runs — so runs are joined with spaces and pages separated by
 * blank lines, which gives the chunker a boundary it can actually use.
 *
 * A PDF that yields almost no text is a scan. That is reported rather than
 * silently ingested as an empty document, because an empty document is
 * indistinguishable from a working one until a search mysteriously misses it.
 *
 * Both failure modes throw their own error type so the import report can say,
 * in plain words, what the file is and what the person can do about it.
 */
export const parsePdf = async (file: File): Promise<ParseResult> => {
    const data = new Uint8Array(await file.arrayBuffer());

    let pdf: pdfjs.PDFDocumentProxy;
    try {
        pdf = await pdfjs.getDocument({ data }).promise;
    } catch (error) {
        // pdf.js reports a locked file as a PasswordException whose message
        // ("No password given") means nothing to someone who did not write it.
        if (error instanceof Error && error.name === 'PasswordException') {
            throw new PasswordProtectedError(file.name);
        }
        throw error;
    }

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (text) pages.push(text);
    }

    const text = pages.join('\n\n');
    const charsPerPage = text.length / Math.max(1, pdf.numPages);
    if (charsPerPage < 50) {
        throw new ScannedPdfError(file.name);
    }

    return { title: file.name, text };
};
