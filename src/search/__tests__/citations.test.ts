import { describe, expect, test } from 'bun:test';
import { matchFilename, parseCitations, type AnswerSegment } from '@/search/citations';

const FILES = [
    'Farhaan Chida_Software Engineer_2026.pdf',
    'Farhaan_Chida_AI_ML_Engineer_1.pdf',
    'Farhaan Chida_AI_ML_Engineer_Freelance.pdf',
];

const rebuild = (segments: AnswerSegment[]): string => segments.map((s) => s.text).join('');

describe('matchFilename', () => {
    test('matches an exact filename', () => {
        expect(matchFilename('Farhaan_Chida_AI_ML_Engineer_1.pdf', FILES)).toBe(
            'Farhaan_Chida_AI_ML_Engineer_1.pdf',
        );
    });

    test('matches when the model drops the extension', () => {
        expect(matchFilename('Farhaan_Chida_AI_ML_Engineer_1', FILES)).toBe(
            'Farhaan_Chida_AI_ML_Engineer_1.pdf',
        );
    });

    test('matches when underscores become spaces', () => {
        expect(matchFilename('Farhaan Chida AI ML Engineer 1.pdf', FILES)).toBe(
            'Farhaan_Chida_AI_ML_Engineer_1.pdf',
        );
    });

    test('matches a shortened reference', () => {
        expect(matchFilename('Software Engineer_2026', FILES)).toBe(
            'Farhaan Chida_Software Engineer_2026.pdf',
        );
    });

    test('returns null for something not in the evidence', () => {
        expect(matchFilename('lease agreement.pdf', FILES)).toBeNull();
        expect(matchFilename('', FILES)).toBeNull();
        expect(matchFilename('...', FILES)).toBeNull();
    });
});

describe('parseCitations', () => {
    test('splits an answer into text and citations', () => {
        const answer =
            'You studied at UBC [Farhaan Chida_Software Engineer_2026.pdf] from 2021.';
        const segments = parseCitations(answer, FILES);

        expect(segments.map((s) => s.kind)).toEqual(['text', 'citation', 'text']);
        expect(segments[1]).toMatchObject({
            kind: 'citation',
            filename: 'Farhaan Chida_Software Engineer_2026.pdf',
        });
    });

    test('never loses or alters a character of the answer', () => {
        const answer =
            'UBC [Farhaan Chida_Software Engineer_2026.pdf], and the IB [Farhaan_Chida_AI_ML_Engineer_1.pdf].';
        expect(rebuild(parseCitations(answer, FILES))).toBe(answer);
    });

    test('handles several citations in a row', () => {
        const answer =
            'Both [Farhaan_Chida_AI_ML_Engineer_1.pdf][Farhaan Chida_AI_ML_Engineer_Freelance.pdf] agree.';
        const cites = parseCitations(answer, FILES).filter((s) => s.kind === 'citation');
        expect(cites).toHaveLength(2);
    });

    test('leaves brackets that name nothing as plain text', () => {
        const answer = 'The rate is [redacted] per hour.';
        const segments = parseCitations(answer, FILES);

        expect(segments).toEqual([{ kind: 'text', text: answer }]);
        expect(rebuild(segments)).toBe(answer);
    });

    test('an answer with no brackets is one text segment', () => {
        const answer = 'Nothing in your library says that.';
        expect(parseCitations(answer, FILES)).toEqual([{ kind: 'text', text: answer }]);
    });

    test('an empty answer produces nothing to render', () => {
        expect(parseCitations('', FILES)).toEqual([]);
    });

    test('with no evidence, every bracket stays as written', () => {
        const answer = 'See [some file.pdf].';
        expect(parseCitations(answer, [])).toEqual([{ kind: 'text', text: answer }]);
    });
});

describe('excerpt numbers', () => {
    /**
     * What went wrong in use: the model wrote "According to excerpt [1]
     * (Farhaan_Chida_AI_ML_Engineer_1.pdf)". Matching "1" as text found every
     * filename containing a 1, so the bracket linked to whichever happened to
     * be closest in length — a link to the wrong document, which is worse than
     * no link at all.
     */
    test('a bare number means that excerpt, in order', () => {
        expect(matchFilename('1', FILES)).toBe(FILES[0]);
        expect(matchFilename('3', FILES)).toBe(FILES[2]);
    });

    test('a number past the end of the evidence matches nothing', () => {
        expect(matchFilename('9', FILES)).toBeNull();
        expect(matchFilename('0', FILES)).toBeNull();
    });

    test('one- and two-character fragments never match a filename', () => {
        expect(matchFilename('a', FILES)).toBeNull();
        expect(matchFilename('ML', FILES)).toBeNull();
    });

    test('a numbered citation still renders as written', () => {
        const answer = 'You attended UBC [1].';
        const segments = parseCitations(answer, FILES);
        expect(segments.map((s) => s.text).join('')).toBe(answer);
        expect(segments[1]).toMatchObject({ kind: 'citation', filename: FILES[0] });
    });
});
