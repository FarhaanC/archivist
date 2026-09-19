import { readImageFile } from '@/ocr/read-scan';
import { ScannedPdfError, UnreadableImageError } from '@/parsers/types';
import type { ParseContext, ParseResult } from '@/parsers/types';

/**
 * A photo or picture of a document — an ID card, a licence, a letter someone
 * photographed with their phone. There is no text inside the file at all;
 * everything comes from the scan reader.
 */
export const parseImage = async (file: File, context: ParseContext = {}): Promise<ParseResult> => {
    // Without a reader a picture is exactly as unreadable as a scanned PDF,
    // and the report wording for that case fits both.
    if (!context.reader) throw new ScannedPdfError(file.name, false);

    const scan = await readImageFile(file, context.reader, context.onScanProgress);
    if (!scan.text.trim()) throw new UnreadableImageError(file.name);

    return {
        title: file.name,
        text: scan.text,
        readAsScan: true,
        scanConfidence: scan.confidence,
    };
};
