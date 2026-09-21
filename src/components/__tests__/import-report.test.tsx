import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportReport } from '@/components/import-report';
import type { ImportOutcome } from '@/ingestion/import-files';
import type { SecondLook } from '@/ocr/second-look';

/**
 * What the report says about a picture that had to be read twice.
 *
 * The same standard as every other sentence here: written for someone who
 * does not know what a reading engine is and should never have to.
 */
const JARGON =
    /\bOCR\b|worker|preprocess|deskew|binaris|binariz|threshold|confidence|attempt|engine|canvas|pixel|score/i;

const scan = (secondLook?: SecondLook): ImportOutcome => ({
    status: 'imported',
    file: 'licence.jpg',
    docId: 1,
    readAsScan: true,
    ...(secondLook ? { secondLook } : {}),
});

const render = (outcome: ImportOutcome): string =>
    renderToStaticMarkup(<ImportReport report={[outcome]} />);

describe('a scan that was read once', () => {
    const html = render(scan());

    test('says the words came off a picture, as it always did', () => {
        expect(html).toContain('This one was a scan, so the words were read off the picture');
    });

    test('says nothing about looking again', () => {
        expect(html).not.toContain('read twice');
        expect(html).not.toContain('hard to read');
    });
});

describe('a scan that was read again, and the second reading was better', () => {
    const html = render(scan({ attempts: 2, kept: 'second', improved: true }));

    test('says it was read twice and the clearer reading kept', () => {
        expect(html).toContain('hard to read, so it was read twice and the clearer reading kept');
    });

    test('still warns that the odd word may be wrong', () => {
        expect(html).toContain('the odd word may still be wrong');
    });

    test('counts a third reading honestly', () => {
        const three = render(scan({ attempts: 3, kept: 'third', improved: true }));
        expect(three).toContain('read three times');
        expect(three).not.toContain('read twice');
    });
});

describe('a scan that was read again without it helping', () => {
    // Nothing the person can see changed, so the app does not announce its
    // own effort. The ordinary scan sentence stands.
    const html = render(scan({ attempts: 3, kept: 'first', improved: false }));

    test('says nothing extra', () => {
        expect(html).toContain('This one was a scan, so the words were read off the picture');
        expect(html).not.toContain('read twice');
        expect(html).not.toContain('read three times');
    });
});

describe('a document saved before any of this existed', () => {
    test('reads exactly as it always did', () => {
        expect(render(scan())).toBe(
            render({ status: 'imported', file: 'licence.jpg', docId: 1, readAsScan: true }),
        );
    });
});

describe('plain language', () => {
    test('no row about a second look uses jargon', () => {
        for (const look of [
            { attempts: 2, kept: 'second', improved: true } as const,
            { attempts: 3, kept: 'third', improved: true } as const,
            { attempts: 3, kept: 'first', improved: false } as const,
        ]) {
            const text = render(scan(look)).replace(/<[^>]*>/g, ' ');
            expect(text).not.toMatch(JARGON);
        }
    });
});
