import * as pdfjs from 'pdfjs-dist';
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
 */
export const parsePdf = async (file: File): Promise<ParseResult> => {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;

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
        throw new Error(
            `"${file.name}" looks like a scanned PDF — almost no selectable text. ` +
                'Run it through OCR before importing.',
        );
    }

    return { title: file.name, text };
};
