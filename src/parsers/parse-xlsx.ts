import * as XLSX from 'xlsx';
import type { ParseResult } from '@/parsers/types';

/**
 * Parse Excel workbooks (.xlsx, .xls, .ods) into searchable text.
 * Each sheet becomes a section; rows are joined as comma-separated values so
 * cell contents stay associated with their neighbors for search.
 */
export const parseXlsx = async (file: File): Promise<ParseResult> => {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });

    const sections: string[] = [];
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) {
            sections.push(`Sheet: ${sheetName}\n${csv.trim()}`);
        }
    }

    const text = sections.join('\n\n');
    if (!text.trim()) {
        throw new Error('Spreadsheet contains no readable text');
    }
    return { title: file.name, text };
};
