import { describe, expect, test } from 'bun:test';
import {
    enlargedSize,
    MAX_ENHANCED_LONG_SIDE,
    measureTiltDegrees,
    rotatedSize,
    stretchLevels,
    unsharpMask,
    type Pixels,
} from '@/ocr/enhance';

/** A tiny picture, painted by a function of where each dot is. Grey in, grey
 *  out — enough to test everything here without a browser anywhere near it. */
const paint = (
    width: number,
    height: number,
    shade: (x: number, y: number) => number,
): Pixels => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            const value = shade(x, y);
            data[at] = value;
            data[at + 1] = value;
            data[at + 2] = value;
            data[at + 3] = 255;
        }
    }
    return { width, height, data };
};

const shadeAt = (image: Pixels, x: number, y: number): number =>
    image.data[(y * image.width + x) * 4] as number;

/**
 * Rows of "writing" running downhill to the right by `degrees`, on white.
 *
 * Not real letters — a block of dark dots per line is all the tilt measurement
 * actually looks at, because it works by asking how crisply the lines stack up.
 */
const tiltedLines = (degrees: number, width = 200, height = 120): Pixels => {
    const slope = Math.tan((degrees * Math.PI) / 180);
    return paint(width, height, (x, y) => {
        if (x < 20 || x > width - 20) return 255;
        const line = y - (x - width / 2) * slope;
        const within = ((line % 12) + 12) % 12;
        return within < 3 ? 20 : 255;
    });
};

describe('enlargedSize', () => {
    test('doubles a small card', () => {
        expect(enlargedSize(900, 560, 2)).toEqual({ width: 1800, height: 1120 });
    });

    test('stops at the ceiling rather than doubling past it', () => {
        const size = enlargedSize(2400, 1500, 2);
        expect(Math.max(size.width, size.height)).toBe(MAX_ENHANCED_LONG_SIDE);
        // The shape is kept: 2400 × 1500 is 1.6 wide for 1 tall, still.
        expect(size.width / size.height).toBeCloseTo(2400 / 1500, 2);
    });

    test('never shrinks a picture that is already large', () => {
        expect(enlargedSize(5000, 3000, 2)).toEqual({ width: 5000, height: 3000 });
        expect(enlargedSize(900, 560, 0.5)).toEqual({ width: 900, height: 560 });
    });
});

describe('rotatedSize', () => {
    test('straight is unchanged', () => {
        expect(rotatedSize(100, 50, 0)).toEqual({ width: 100, height: 50 });
    });

    test('a tilted picture needs a slightly bigger frame, so no corner is cut', () => {
        const size = rotatedSize(100, 50, 4);
        expect(size.width).toBeGreaterThan(100);
        expect(size.height).toBeGreaterThan(50);
    });

    test('a quarter turn swaps the sides', () => {
        expect(rotatedSize(100, 50, 90)).toEqual({ width: 50, height: 100 });
    });
});

describe('stretchLevels', () => {
    test('a grey square comes out black and white', () => {
        // The case this step exists for: a card whose labels are grey on a
        // tinted background, with nothing near black or near white in it.
        const image = paint(20, 20, (x) => (x < 10 ? 100 : 160));
        const out = stretchLevels(image);
        expect(shadeAt(out, 2, 5)).toBe(0);
        expect(shadeAt(out, 17, 5)).toBe(255);
    });

    test('colour is flattened to grey', () => {
        const data = new Uint8ClampedArray(4 * 4 * 4);
        for (let index = 0; index < 16; index++) {
            const at = index * 4;
            data[at] = index < 8 ? 180 : 40; // red-ish half, dark half
            data[at + 1] = index < 8 ? 60 : 20;
            data[at + 2] = index < 8 ? 60 : 20;
            data[at + 3] = 255;
        }
        const out = stretchLevels({ width: 4, height: 4, data });
        for (let index = 0; index < 16; index++) {
            const at = index * 4;
            expect(out.data[at]).toBe(out.data[at + 1] as number);
            expect(out.data[at + 1]).toBe(out.data[at + 2] as number);
            expect(out.data[at + 3]).toBe(255);
        }
    });

    test('a blank page is left alone rather than amplified into noise', () => {
        const image = paint(20, 20, () => 244);
        const out = stretchLevels(image);
        expect(shadeAt(out, 5, 5)).toBe(244);
    });

    test('the odd stray speck does not set the whole range', () => {
        // One black dot in a pale picture should not become the point that
        // everything else is measured against.
        const image = paint(20, 20, (x, y) => (x === 0 && y === 0 ? 0 : x < 10 ? 100 : 160));
        const out = stretchLevels(image);
        expect(shadeAt(out, 2, 5)).toBe(0);
        expect(shadeAt(out, 17, 5)).toBe(255);
    });
});

describe('unsharpMask', () => {
    test('an edge gets steeper', () => {
        const image = paint(9, 9, (x) => (x < 4 ? 90 : 150));
        const out = unsharpMask(image);
        const darkBefore = shadeAt(image, 3, 4);
        const lightBefore = shadeAt(image, 4, 4);
        // The dark side of the edge darkens and the light side lightens,
        // which is what "crisper" means here.
        expect(shadeAt(out, 3, 4)).toBeLessThan(darkBefore);
        expect(shadeAt(out, 4, 4)).toBeGreaterThan(lightBefore);
    });

    test('a flat picture stays flat', () => {
        const image = paint(6, 6, () => 128);
        const out = unsharpMask(image);
        for (let index = 0; index < 36; index++) expect(out.data[index * 4]).toBe(128);
    });

    test('see-through-ness is carried across untouched', () => {
        const image = paint(4, 4, () => 100);
        image.data[3] = 77;
        expect(unsharpMask(image).data[3]).toBe(77);
    });
});

describe('measureTiltDegrees', () => {
    test('straight writing measures straight', () => {
        expect(Math.abs(measureTiltDegrees(tiltedLines(0)))).toBeLessThanOrEqual(0.2);
    });

    test('writing that runs downhill to the right is found, and by how much', () => {
        for (const degrees of [1.5, 3, -2.5, 4]) {
            expect(measureTiltDegrees(tiltedLines(degrees))).toBeCloseTo(degrees, 0);
        }
    });

    test('a picture too small to hold writing is called straight', () => {
        expect(measureTiltDegrees(paint(4, 4, () => 128))).toBe(0);
    });

    test('a blank picture is called straight', () => {
        expect(measureTiltDegrees(paint(200, 120, () => 255))).toBe(0);
    });
});
