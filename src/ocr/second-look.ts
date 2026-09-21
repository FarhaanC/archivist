import {
    contrast,
    enlarge,
    measureTiltDegrees,
    MIN_TILT_DEGREES,
    pixelsOf,
    releaseCanvas,
    sharpen,
    straighten,
} from '@/ocr/enhance';
import { judgeRead } from '@/ocr/read-quality';
import type { ScanResult, ScanSource } from '@/ocr/reader';

/**
 * Giving a badly-read picture a second, cleaner look.
 *
 * The app notices its own poor work and tries again. Nobody is asked to do
 * anything, there is no setting and no button: a card that came back as
 * letter-soup is simply enlarged, its greys pulled apart, and read again, and
 * whichever reading turned out better is the one that is kept.
 *
 * Two rules hold this honest. A later attempt has to actually beat the first
 * one on words-read-times-sureness, or the first one stands — a cleaned-up
 * picture can genuinely read worse, and quietly keeping the worse reading
 * because it was the newer one would be the app lying to itself. And there
 * are at most two extra attempts, because each one costs the person roughly
 * another page-read of waiting.
 */

export interface SecondLook {
    /** How many times the picture was read in all: 1, 2 or 3. */
    attempts: number;
    /** Which reading was kept. */
    kept: 'first' | 'second' | 'third';
    /** Whether looking again actually helped. False means it was tried and
     *  the first reading still won. */
    improved: boolean;
}

export interface SecondLookOutcome {
    result: ScanResult;
    /** Absent when the first reading was fine and nothing else was tried. */
    secondLook?: SecondLook;
}

/** The picture-cleaning steps, gathered so tests can stand in for them
 *  without a browser. The app always uses the real ones. */
export interface EnhanceSteps {
    enlarge(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement;
    contrast(canvas: HTMLCanvasElement): HTMLCanvasElement;
    sharpen(canvas: HTMLCanvasElement): HTMLCanvasElement;
    straighten(canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement;
    measureTilt(canvas: HTMLCanvasElement): number;
    release(canvas: HTMLCanvasElement): void;
}

export const realSteps: EnhanceSteps = {
    enlarge,
    contrast,
    sharpen,
    straighten,
    measureTilt: (canvas) => measureTiltDegrees(pixelsOf(canvas)),
    release: releaseCanvas,
};

/** How much bigger to draw the picture before reading it again. Small type is
 *  the commonest reason a card defeats the reader. */
const ENLARGE_BY = 2;

export interface SecondLookRequest {
    /** Reads one picture. The same queue everything else uses — a second look
     *  waits its turn like any other page rather than starting an engine of
     *  its own. */
    read(image: ScanSource, onProgress?: (fraction: number) => void): Promise<ScanResult>;
    /** What the first read came back with. */
    first: ScanResult;
    /**
     * A fresh, full-size copy of the picture to work from, or null when there
     * is none — no browser, or the original was not kept. For a photograph
     * this must be the picture as it arrived, not the shrunken copy that was
     * read first, or enlarging only puts back the detail that was thrown away.
     *
     * Whatever this hands back belongs to the second look, which lets go of
     * it when it is finished. It is asked for only when a second look is
     * actually going to happen, so a good reading costs nothing.
     */
    picture: () => HTMLCanvasElement | null;
    /** The size of the photograph, when this is a photograph. Pages of a
     *  scanned PDF are not judged on how much writing their size implies. */
    measure?: { width: number; height: number };
    /** 0–1 across the extra attempts alone; the caller places it in the
     *  second half of the page's progress. */
    onProgress?: (fraction: number) => void;
    steps?: EnhanceSteps;
}

/**
 * Read again, more carefully, if the first reading looks poor.
 *
 * Nothing here can fail an import. If cleaning the picture throws — a canvas
 * the browser will not make, a machine out of memory — the first reading is
 * kept and the trouble is noted in the console for whoever is looking.
 */
export const readWithSecondLook = async ({
    read,
    first,
    picture,
    measure,
    onProgress,
    steps = realSteps,
}: SecondLookRequest): Promise<SecondLookOutcome> => {
    const firstQuality = judgeRead(first, measure);
    if (!firstQuality.poor) return { result: first };

    let base: HTMLCanvasElement | null = null;
    let best = { result: first, score: firstQuality.score, kept: 'first' as SecondLook['kept'] };
    let attempts = 1;

    try {
        base = picture();
        if (!base) return { result: first };

        /** One extra attempt: clean the picture up, read it, keep it if it won. */
        const attempt = async (
            which: 'second' | 'third',
            prepare: (from: HTMLCanvasElement) => HTMLCanvasElement,
            from: number,
            to: number,
        ): Promise<boolean> => {
            const cleaned = prepare(base as HTMLCanvasElement);
            attempts += 1;
            try {
                const result = await read(cleaned, (fraction) =>
                    onProgress?.(from + (to - from) * fraction),
                );
                const quality = judgeRead(result, measure);
                if (quality.score > best.score) {
                    best = { result, score: quality.score, kept: which };
                }
                return quality.poor;
            } finally {
                // Only ever one cleaned-up picture in hand at a time: a long
                // scan reads several pages at once and each of these is large.
                steps.release(cleaned);
            }
        };

        // Most of the gain is in these two, so they go together rather than
        // costing two separate reads to find that out.
        const stillPoor = await attempt(
            'second',
            (from) => {
                const bigger = steps.enlarge(from, ENLARGE_BY);
                const clearer = steps.contrast(bigger);
                steps.release(bigger);
                return clearer;
            },
            0,
            0.5,
        );

        if (stillPoor) {
            await attempt(
                'third',
                (from) => {
                    const tilt = steps.measureTilt(from);
                    const upright =
                        Math.abs(tilt) >= MIN_TILT_DEGREES ? steps.straighten(from, tilt) : from;
                    const bigger = steps.enlarge(upright, ENLARGE_BY);
                    if (upright !== from) steps.release(upright);
                    const clearer = steps.contrast(bigger);
                    steps.release(bigger);
                    const crisper = steps.sharpen(clearer);
                    steps.release(clearer);
                    return crisper;
                },
                0.5,
                1,
            );
        }
    } catch (error) {
        // A second look can never fail an import. Whatever was read first
        // still stands, and the person still gets their document.
        console.warn('[Scan reader] Could not take a second look at a picture:', error);
    } finally {
        if (base) steps.release(base);
        // Only where something was actually read again: otherwise this would
        // announce a second look that never happened, and the line the
        // person is shown would flicker for no reason.
        if (attempts > 1) onProgress?.(1);
    }

    // If nothing was actually read a second time — no picture to work from,
    // or preparing one failed before it got as far as the reader — then no
    // second look happened, and saying one did would put a sentence in the
    // report about work that was never done.
    if (attempts === 1) return { result: first };

    return {
        result: best.result,
        secondLook: {
            attempts,
            kept: best.kept,
            improved: best.kept !== 'first',
        },
    };
};
