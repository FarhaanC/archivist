import { describe, expect, test } from 'bun:test';
import { readWithSecondLook, type EnhanceSteps } from '@/ocr/second-look';
import type { ScanResult, ScanSource } from '@/ocr/reader';

/**
 * The attempt loop, with the picture-cleaning stood in for.
 *
 * None of this needs a browser: what is being tested is which reading gets
 * kept, how many reads it cost, and whether every picture made along the way
 * was let go of again.
 */

/** A stand-in for a canvas: a label saying what was done to it, and whether
 *  it has been let go of. */
interface FakeCanvas {
    label: string;
    released: boolean;
    width: number;
    height: number;
}

const asCanvas = (fake: FakeCanvas): HTMLCanvasElement => fake as unknown as HTMLCanvasElement;
const asFake = (canvas: HTMLCanvasElement): FakeCanvas => canvas as unknown as FakeCanvas;

const makeSteps = (tilt = 0): { steps: EnhanceSteps; made: FakeCanvas[] } => {
    const made: FakeCanvas[] = [];
    const derive = (from: HTMLCanvasElement, what: string): HTMLCanvasElement => {
        const fake: FakeCanvas = {
            label: `${asFake(from).label}+${what}`,
            released: false,
            width: asFake(from).width,
            height: asFake(from).height,
        };
        made.push(fake);
        return asCanvas(fake);
    };
    return {
        made,
        steps: {
            enlarge: (canvas, factor) => derive(canvas, `enlarge${factor}`),
            contrast: (canvas) => derive(canvas, 'contrast'),
            sharpen: (canvas) => derive(canvas, 'sharpen'),
            straighten: (canvas, degrees) =>
                Math.abs(degrees) >= 0.5 ? derive(canvas, `straighten${degrees}`) : canvas,
            measureTilt: () => tilt,
            release: (canvas) => void (asFake(canvas).released = true),
        },
    };
};

/** A reading with a given number of words and sureness, so the score each
 *  attempt earns is obvious from the call. */
const reading = (words: number, confidence: number): ScanResult => ({
    text: Array.from({ length: words }, (_, index) => `word${'s'.repeat(index % 3)}`).join(' '),
    confidence,
});

/** A reader that hands back prepared readings in order. */
const readerOf = (rest: ScanResult[]) => {
    const seen: string[] = [];
    const read = (image: ScanSource): Promise<ScanResult> => {
        seen.push(asFake(image as HTMLCanvasElement).label);
        const next = rest.shift();
        if (!next) throw new Error('The test ran out of prepared readings');
        return Promise.resolve(next);
    };
    return { read, seen };
};

const original = (): FakeCanvas => ({
    label: 'original',
    released: false,
    width: 2400,
    height: 1500,
});

describe('readWithSecondLook', () => {
    test('a good first reading is left alone', async () => {
        const { steps, made } = makeSteps();
        const { read, seen } = readerOf([]);
        const first = reading(120, 91);

        const outcome = await readWithSecondLook({
            read,
            first,
            picture: () => asCanvas(original()),
            measure: { width: 2400, height: 1500 },
            steps,
        });

        expect(outcome.result).toBe(first);
        expect(outcome.secondLook).toBeUndefined();
        expect(seen).toEqual([]);
        expect(made).toEqual([]);
    });

    test('a poor reading is read again, and a better reading wins', async () => {
        const { steps } = makeSteps();
        const better = reading(120, 88);
        const { read, seen } = readerOf([better]);

        const outcome = await readWithSecondLook({
            read,
            first: reading(40, 55),
            picture: () => asCanvas(original()),
            steps,
        });

        expect(outcome.result).toBe(better);
        expect(outcome.secondLook).toEqual({ attempts: 2, kept: 'second', improved: true });
        // Enlarged and levelled, in that order, on the original picture.
        expect(seen).toEqual(['original+enlarge2+contrast']);
    });

    test('a second reading that is still poor earns a third, straightened one', async () => {
        const { steps } = makeSteps(3.4);
        const best = reading(150, 86);
        const { read, seen } = readerOf([reading(60, 58), best]);

        const outcome = await readWithSecondLook({
            read,
            first: reading(40, 50),
            picture: () => asCanvas(original()),
            steps,
        });

        expect(outcome.result).toBe(best);
        expect(outcome.secondLook).toEqual({ attempts: 3, kept: 'third', improved: true });
        expect(seen[1]).toBe('original+straighten3.4+enlarge2+contrast+sharpen');
    });

    test('a picture barely off straight is not rotated', async () => {
        const { steps } = makeSteps(0.2);
        const { read, seen } = readerOf([reading(60, 58), reading(70, 60)]);

        await readWithSecondLook({
            read,
            first: reading(40, 50),
            picture: () => asCanvas(original()),
            steps,
        });

        expect(seen[1]).toBe('original+enlarge2+contrast+sharpen');
    });

    test('the first reading stands when looking again made things worse', async () => {
        const { steps } = makeSteps();
        const first = reading(90, 60); // poor: unsure, but a lot was read
        // Sure of itself, but it read a quarter as much — the trap this whole
        // arrangement exists to avoid.
        const { read } = readerOf([reading(20, 95)]);

        const outcome = await readWithSecondLook({
            read,
            first,
            picture: () => asCanvas(original()),
            steps,
        });

        expect(outcome.result).toBe(first);
        expect(outcome.secondLook).toEqual({ attempts: 2, kept: 'first', improved: false });
    });

    test('the first reading stands when neither extra attempt beat it', async () => {
        const { steps } = makeSteps();
        const first = reading(90, 60);
        const { read } = readerOf([reading(30, 50), reading(20, 55)]);

        const outcome = await readWithSecondLook({
            read,
            first,
            picture: () => asCanvas(original()),
            steps,
        });

        expect(outcome.result).toBe(first);
        expect(outcome.secondLook).toEqual({ attempts: 3, kept: 'first', improved: false });
    });

    test('with no picture to work from, nothing is tried and nothing is claimed', async () => {
        const { steps } = makeSteps();
        const first = reading(40, 50);
        const { read, seen } = readerOf([]);

        const outcome = await readWithSecondLook({ read, first, picture: () => null, steps });

        expect(outcome.result).toBe(first);
        expect(outcome.secondLook).toBeUndefined();
        expect(seen).toEqual([]);
    });

    test('a picture that cannot be cleaned up does not fail the import', async () => {
        const { steps } = makeSteps();
        const angry: EnhanceSteps = {
            ...steps,
            enlarge: () => {
                throw new Error('canvas too large');
            },
        };
        const first = reading(40, 50);

        const outcome = await readWithSecondLook({
            read: () => Promise.reject(new Error('should never be reached')),
            first,
            picture: () => asCanvas(original()),
            steps: angry,
        });

        expect(outcome.result).toBe(first);
        expect(outcome.secondLook).toBeUndefined();
    });

    test('a reading that fails does not fail the import either', async () => {
        const { steps } = makeSteps();
        const first = reading(40, 50);

        const outcome = await readWithSecondLook({
            read: () => Promise.reject(new Error('the page could not be read')),
            first,
            picture: () => asCanvas(original()),
            steps,
        });

        expect(outcome.result).toBe(first);
    });

    test('every picture made along the way is let go of', async () => {
        const { steps, made } = makeSteps(3.4);
        const { read } = readerOf([reading(60, 58), reading(70, 60)]);
        const base = original();

        await readWithSecondLook({
            read,
            first: reading(40, 50),
            picture: () => asCanvas(base),
            steps,
        });

        expect(made.length).toBeGreaterThan(0);
        for (const canvas of made) expect(canvas.released).toBe(true);
        expect(base.released).toBe(true);
    });

    test('progress runs forwards across the extra attempts and finishes at one', async () => {
        const { steps } = makeSteps();
        const { read } = readerOf([reading(60, 58), reading(70, 60)]);
        const seen: number[] = [];

        await readWithSecondLook({
            read: (image, onProgress) => {
                onProgress?.(0);
                onProgress?.(0.5);
                onProgress?.(1);
                return read(image);
            },
            first: reading(40, 50),
            picture: () => asCanvas(original()),
            onProgress: (fraction) => seen.push(fraction),
            steps,
        });

        expect(seen[0]).toBe(0);
        expect(seen[seen.length - 1]).toBe(1);
        for (let index = 1; index < seen.length; index++) {
            expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1] as number);
        }
    });
});
