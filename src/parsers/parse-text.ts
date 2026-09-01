import type { ParseResult } from '@/parsers/types';

/** Plain text, Markdown, and source code all parse the same way: the bytes
 *  are already the content. */
export const parseText = async (file: File): Promise<ParseResult> => ({
    title: file.name,
    text: await file.text(),
});
