import mammoth from 'mammoth';
import type { ParseResult } from '@/parsers/types';

export const parseDocx = async (file: File): Promise<ParseResult> => {
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return { title: file.name, text: value.trim() };
};
