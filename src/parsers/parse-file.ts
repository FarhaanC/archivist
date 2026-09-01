import { parseDocx } from '@/parsers/parse-docx';
import { parsePdf } from '@/parsers/parse-pdf';
import { parsePptx } from '@/parsers/parse-pptx';
import { parseText } from '@/parsers/parse-text';
import { parseXlsx } from '@/parsers/parse-xlsx';
import { UnsupportedFileError, type ParseResult } from '@/parsers/types';
import { extensionOf, SUPPORTED_EXTENSION_GROUPS } from '@/upload/collect-files';

const TEXT_LIKE = new Set<string>(SUPPORTED_EXTENSION_GROUPS['Text & code']);

/** Route a file to its parser by extension. Extension rather than MIME type:
 *  browsers report nothing useful for most code and text formats. */
export const parseFile = async (file: File): Promise<ParseResult> => {
    const extension = extensionOf(file.name).replace('.', '');

    switch (extension) {
        case 'pdf':
            return parsePdf(file);
        case 'docx':
            return parseDocx(file);
        case 'xlsx':
        case 'xls':
        case 'ods':
            return parseXlsx(file);
        case 'pptx':
            return parsePptx(file);
        default:
            if (TEXT_LIKE.has(extension)) return parseText(file);
            throw new UnsupportedFileError(file.name);
    }
};
