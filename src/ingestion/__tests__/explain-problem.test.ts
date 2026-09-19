import { describe, expect, test } from 'bun:test';
import { explainEmpty, explainError, explainFileType } from '@/ingestion/explain-problem';
import {
    PasswordProtectedError,
    ScannedPdfError,
    UnreadableImageError,
    UnsupportedFileError,
} from '@/parsers/types';

/**
 * These are the sentences a person reads when their file didn't go in. Each
 * one is checked for three things: it names the right cause, it tells the
 * person something they can do, and it contains none of the words that made
 * the old messages ("text layer", "OCR", "PasswordException") unreadable.
 */

const JARGON = /\bOCR\b|text layer|selectable|exception|parse|parser|extension|unsupported|null|undefined/i;

const allProblems = [
    explainError('degree.pdf', new ScannedPdfError('degree.pdf', true)),
    explainError('degree.pdf', new ScannedPdfError('degree.pdf', false)),
    explainError('id.jpg', new UnreadableImageError('id.jpg')),
    explainError('bank.pdf', new PasswordProtectedError('bank.pdf')),
    explainError('weird.pdf', new Error('Invalid PDF structure')),
    explainError('fine.pdf', new Error('Failed to fetch')),
    explainError('x.docx', new UnsupportedFileError('x.docx')),
    explainFileType('photo.heic'),
    explainFileType('call.mp3'),
    explainFileType('clip.mp4'),
    explainFileType('setup.exe'),
    explainFileType('docs.zip'),
    explainFileType('thing.xyz'),
    explainFileType('README'),
    explainEmpty(),
];

describe('every explanation', () => {
    test('says what to do, in plain words', () => {
        for (const problem of allProblems) {
            expect(problem.headline.length).toBeGreaterThan(20);
            expect(problem.whatToDo.length).toBeGreaterThan(20);
            expect(problem.headline).not.toMatch(JARGON);
            expect(problem.whatToDo).not.toMatch(JARGON);
        }
    });

    test('ends its sentences', () => {
        for (const problem of allProblems) {
            expect(problem.headline).toMatch(/[.!]$/);
            expect(problem.whatToDo).toMatch(/[.!]$/);
        }
    });
});

describe('explainError', () => {
    test('a scan the reader could not make out says so and suggests a clearer copy', () => {
        const problem = explainError('degree.pdf', new ScannedPdfError('degree.pdf', true));
        expect(problem.kind).toBe('scanned-pdf');
        expect(problem.label).toBe('Couldn’t read');
        expect(problem.headline).toContain('photo of the page');
        expect(problem.headline).toContain('tried');
        expect(problem.whatToDo).toContain('clearer');
    });

    test('a scan with no reader available says that, not that the scan is bad', () => {
        const problem = explainError('degree.pdf', new ScannedPdfError('degree.pdf', false));
        expect(problem.headline).toContain('isn’t available');
        expect(problem.whatToDo).toContain('again');
    });

    test('a picture with no readable words is told apart from a bad file type', () => {
        const problem = explainError('id.jpg', new UnreadableImageError('id.jpg'));
        expect(problem.kind).toBe('image');
        expect(problem.headline).toContain('couldn’t make out');
    });

    test('never sends the person looking for an emailed original — the scan usually is the original', () => {
        for (const problem of allProblems) {
            expect(problem.whatToDo).not.toMatch(/email|original/i);
        }
    });

    test('a locked PDF explains the password and how to save an unlocked copy', () => {
        const problem = explainError('bank.pdf', new PasswordProtectedError('bank.pdf'));
        expect(problem.kind).toBe('locked-pdf');
        expect(problem.headline).toContain('password');
        expect(problem.whatToDo).toContain('Save as');
    });

    test('an unknown reading error is called damaged, with a way to check', () => {
        const problem = explainError('weird.pdf', new Error('Invalid PDF structure'));
        expect(problem.kind).toBe('damaged');
        expect(problem.whatToDo).toContain('usual program');
    });

    test('a failed download is not blamed on the file', () => {
        const problem = explainError('fine.pdf', new Error('Failed to fetch'));
        expect(problem.kind).toBe('offline');
        expect(problem.headline).toContain('file itself is fine');
        expect(problem.whatToDo).toContain('connection');
    });

    test('an unsupported-type error falls through to the type explanation', () => {
        expect(explainError('photo.jpg', new UnsupportedFileError('photo.jpg')).kind).toBe('image');
    });
});

describe('explainFileType', () => {
    test('tells documents-we-cannot-read-yet apart from things that were never documents', () => {
        expect(explainFileType('photo.heic').label).toBe('Couldn’t read');
        expect(explainFileType('call.mp3').label).toBe('Couldn’t read');
        expect(explainFileType('setup.exe').label).toBe('Not a document');
        expect(explainFileType('docs.zip').label).toBe('Not a document');
        expect(explainFileType('thing.xyz').label).toBe('Not a document');
    });

    test('a picture format the browser cannot open says which format and what to convert to', () => {
        const problem = explainFileType('IMG_0001.HEIC');
        expect(problem.kind).toBe('image');
        expect(problem.headline).toContain('.heic');
        expect(problem.whatToDo).toContain('JPG');
    });

    test('an installer says there is nothing to do', () => {
        expect(explainFileType('Claude Setup.exe').whatToDo).toContain('Nothing to do');
    });

    test('a zip tells the person to unzip it', () => {
        expect(explainFileType('archive.zip').whatToDo).toContain('Unzip');
    });

    test('an unknown extension is named so the person can look it up', () => {
        expect(explainFileType('thing.xyz').headline).toContain('.xyz');
    });

    test('a file with no extension is handled', () => {
        expect(explainFileType('README').kind).toBe('unknown-type');
        expect(explainFileType('README').headline).toContain('no ending');
    });
});
