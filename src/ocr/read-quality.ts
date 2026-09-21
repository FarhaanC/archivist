import type { ScanResult } from '@/ocr/reader';

/**
 * Telling a good read from a bad one, so the app can notice its own poor work
 * and try again without asking the person to do anything.
 *
 * The reader's own sureness cannot do this job alone, and the reason is worth
 * spelling out because it is the trap this whole file exists to avoid: that
 * number is an average over the words the reader *chose* to read. A read that
 * quietly gives up on the hard half of a card and reports only the easy half
 * scores higher than a read that struggled through all of it. So sureness is
 * one of three signs here, never the whole judgement, and two reads are only
 * ever compared by `score`, which multiplies sureness by how much was read.
 *
 * The other two signs are what a person would notice at a glance. Text full of
 * letter-soup — "1868. Date", "eS", "EEE" — came off a picture the reader
 * could not really see. And a large photograph that yields thirty words is a
 * photograph most of which was missed, however sure the reader is about the
 * thirty.
 */

export type PoorReason = 'low-confidence' | 'mostly-junk' | 'too-few-words';

export interface ReadQuality {
    /** Words × sureness. The only fair way to compare two attempts. */
    score: number;
    poor: boolean;
    /** Why it was judged poor, or null when it was not. */
    why: PoorReason | null;
}

/**
 * Below this, try harder.
 *
 * Deliberately far above MIN_PAGE_CONFIDENCE (40), which is a different bar
 * for a different purpose: 40 is "too garbled to keep at all", this is "worth
 * another few seconds". Clean office scans come back in the high eighties and
 * nineties, so 72 leaves ordinary work alone while catching the cards.
 */
export const POOR_CONFIDENCE = 72;

/** Above this share of letter-soup, the picture, not the text, is the problem. */
export const POOR_JUNK_FRACTION = 1 / 3;

/**
 * How much picture one word is allowed to occupy before the read looks thin.
 *
 * Tuned against the standard test's own files, and the first figure tried —
 * one word per forty thousand dots — was wrong. It suited a card, but it
 * condemned the clean full-page photographs in that set: a crisply drawn
 * 1600 × 2200 page carrying seventy-eight words would have been sent back for
 * a second look it did not need, on every run, which is the one thing this
 * rule must never do.
 *
 * At one word per eighty thousand dots, that page needs forty-four words and
 * passes, while a 2400 × 1500 photograph of a card needs forty-five and so a
 * read that finds thirty is still caught. That is the shape this rule should
 * have anyway: it is here to notice a picture most of which was missed, not
 * to have opinions about how much writing a document ought to carry.
 *
 * Only photographs are measured this way. A page of a scanned PDF may quite
 * legitimately be a title page with four words on it.
 */
export const MIN_PIXELS_PER_WORD = 80_000;

/** Arabic, and the marks that ride along with it. */
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** Characters that belong in ordinary writing. Anything else in the middle of
 *  a word — a pipe, a section mark, a stray invisible direction mark — is the
 *  reader guessing at a smudge. */
const ORDINARY = /^[\p{L}\p{N}.,:;!?'"()\[\]{}\-–—…/\\&%@#*+=_$£€]+$/u;

/** Invisible marks that say which way a line of Arabic runs. They are part of
 *  ordinary bilingual text, not evidence of a bad picture, so they are taken
 *  out before anything is judged. */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

const LATIN_LETTER = /[A-Za-z]/;
const VOWEL = /[AEIOUYaeiouy]/;

/** Strip the punctuation a word is wrapped in, keeping what is inside. */
const core = (token: string): string => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** Every run of non-space characters that carries a letter or a digit. */
const tokensOf = (text: string): string[] =>
    text
        .replace(INVISIBLE, '')
        .split(/\s+/)
        .filter((token) => token.length > 0 && /[\p{L}\p{N}]/u.test(token));

/**
 * Whether one token looks like letter-soup rather than a word.
 *
 * Arabic is judged only on the characters it is made of, never on its vowels —
 * Arabic writes without them, and the consonant rules below would condemn
 * every Arabic word on a perfectly good card.
 */
export const isJunkToken = (token: string): boolean => {
    // A pipe, a stray direction mark, a section sign: nothing a document
    // actually prints inside a word.
    if (!ORDINARY.test(token)) return true;

    const inner = core(token);
    if (!inner) return false;
    if (ARABIC.test(inner)) return false;

    // A number, a date, a reference — no letters to judge.
    if (!LATIN_LETTER.test(inner)) return false;

    // Letters and digits jumbled together inside one run: "1o68", "B3ll".
    // A reference number written with separators — "ARC-2291-B" — is a real
    // thing documents print, so runs are judged one at a time, and short
    // unit-like forms ("23rd", "A4", "3D") are left alone.
    for (const run of inner.split(/[^A-Za-z0-9]+/)) {
        if (!/[A-Za-z]/.test(run) || !/[0-9]/.test(run)) continue;
        if (/^([0-9]+(st|nd|rd|th|s)|[A-Za-z][0-9]{1,3}|[0-9]{1,3}[A-Za-z])$/i.test(run)) continue;
        return true;
    }

    const letters = inner.replace(/[^A-Za-z]/g, '');

    // A single letter standing on its own is almost always a mark the reader
    // mistook for a letter. "a", "A" and "I" are words; nothing else is.
    if (letters.length === 1 && inner === letters && !/^[aAI]$/.test(letters)) return true;

    if (letters.length >= 3) {
        // The same letter three times over is a smudge read as a letter.
        if (/(.)\1\1/i.test(letters)) return true;
        // No vowel anywhere in three or more letters.
        if (!VOWEL.test(letters)) return true;
    }

    // Two letters with the case switching mid-token: "eS", "aM".
    if (letters.length === 2 && /^[a-z][A-Z]$/.test(letters)) return true;

    return false;
};

/** The share of a read that is letter-soup, 0–1. Empty text is not junk. */
export const junkFraction = (text: string): number => {
    const tokens = tokensOf(text);
    if (tokens.length === 0) return 0;
    const junk = tokens.filter(isJunkToken).length;
    return junk / tokens.length;
};

/** How many words a read found. Used both for the score and for the thinness
 *  test, so it counts the same things in both places. */
export const wordCount = (text: string): number => tokensOf(text).length;

/**
 * Judge one read.
 *
 * `image` is given only for photographs, where the size of the picture says
 * something about how much writing ought to have come out of it. A page of a
 * scanned PDF is left unjudged on that count.
 */
export const judgeRead = (
    result: ScanResult,
    image?: { width: number; height: number },
): ReadQuality => {
    const words = wordCount(result.text);
    const confidence = Number.isFinite(result.confidence) ? result.confidence : 0;
    const score = words * Math.max(0, confidence);

    // A blank page is not a poor read, it is a blank page. Sharpening nothing
    // produces nothing, and the second look would cost a person time for a
    // page that has no words on it to find.
    if (words === 0) return { score, poor: false, why: null };

    if (confidence < POOR_CONFIDENCE) return { score, poor: true, why: 'low-confidence' };
    if (junkFraction(result.text) > POOR_JUNK_FRACTION) {
        return { score, poor: true, why: 'mostly-junk' };
    }

    if (image && image.width > 0 && image.height > 0) {
        const area = image.width * image.height;
        if (words < area / MIN_PIXELS_PER_WORD) {
            return { score, poor: true, why: 'too-few-words' };
        }
    }

    return { score, poor: false, why: null };
};
