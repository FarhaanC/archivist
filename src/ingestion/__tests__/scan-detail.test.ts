import { describe, expect, test } from 'bun:test';
import { scanDetail } from '@/ingestion/import-files';

/**
 * The line under a file while its pictures are being read.
 *
 * Same standard as the import report: this is written for someone who does
 * not know, and should not have to know, that any of this involves a reading
 * engine, attempts, passes or thresholds.
 */
const JARGON =
    /\bOCR\b|worker|preprocess|deskew|binaris|binariz|threshold|confidence|attempt|pass \d|engine|canvas|pixel/i;

describe('scanDetail', () => {
    test('a single picture says what is happening to it', () => {
        expect(scanDetail(1, 1, false)).toBe('reading it as a scan');
    });

    test('a picture being read again says so, in words', () => {
        expect(scanDetail(1, 1, true)).toBe('reading it again, more carefully');
    });

    test('a document of several pages counts them', () => {
        expect(scanDetail(3, 7, false)).toBe('page 3 of 7');
        expect(scanDetail(3, 7, true)).toBe('page 3 of 7 — reading it again');
    });

    test('nothing the person sees is jargon', () => {
        for (const pageCount of [1, 7]) {
            for (const again of [false, true]) {
                expect(scanDetail(2, pageCount, again)).not.toMatch(JARGON);
            }
        }
    });
});
