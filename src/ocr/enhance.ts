/**
 * Cleaning up a picture that the reader struggled with.
 *
 * Four steps, in the order they are worth trying. Each takes a picture and
 * gives back a new one; none of them changes the original, and none of them
 * is ever shown to anyone — they exist only so the reader gets a second, more
 * legible look at the same card.
 *
 * The arithmetic is kept apart from the drawing on purpose. Working out how
 * far a card is tilted, and stretching its greys to black and white, are the
 * parts with judgement in them, and they are written against plain rows of
 * dots so they can be tested without a browser. Actually enlarging and
 * rotating a picture is drawing, which a browser does far better and faster
 * than any arithmetic written here, so those steps hand the work to the
 * canvas and keep only the sizing decisions to themselves.
 */

/** A picture as plain rows of dots: red, green, blue and see-through, four
 *  numbers per dot. The same shape a canvas gives back, minus the browser. */
export interface Pixels {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/**
 * The biggest a cleaned-up picture is allowed to get.
 *
 * Enlarging helps because small type is what defeats the reader, but a picture
 * four times the area takes four times as long to read and eventually runs the
 * machine out of memory. Four thousand dots on the long side is roughly a card
 * photographed close up and doubled, which is the case this is for.
 */
export const MAX_ENHANCED_LONG_SIDE = 4000;

/** Below this the tilt is not worth the cost of rotating, and rotating by a
 *  hair does more harm than good: every dot gets re-drawn between two others
 *  and fine type softens. */
export const MIN_TILT_DEGREES = 0.5;

/** How far off straight a card is assumed to be at worst. A photograph taken
 *  by hand is a few degrees out; anything past this is a different problem
 *  (a page held sideways) that rotating by a fraction will not fix. */
const MAX_TILT_DEGREES = 6;

/** Let go of a picture's memory as soon as it has been read. A second look
 *  makes two or three large pictures per page, and a long scan holds a lot of
 *  them otherwise. */
export const releaseCanvas = (canvas: HTMLCanvasElement): void => {
    canvas.width = 0;
    canvas.height = 0;
};

// --- Sizing -----------------------------------------------------------------

/**
 * How big an enlarged picture should actually be.
 *
 * The asked-for factor is honoured until the picture would pass the ceiling,
 * at which point it is scaled back to land exactly on it. A picture already at
 * or past the ceiling is left at its own size — never shrunk, because
 * shrinking is the opposite of what this step is for.
 */
export const enlargedSize = (
    width: number,
    height: number,
    factor: number,
): { width: number; height: number } => {
    const safe = Number.isFinite(factor) && factor > 1 ? factor : 1;
    const longest = Math.max(width, height);
    if (longest <= 0) return { width: Math.max(1, width), height: Math.max(1, height) };
    const capped = Math.min(safe, Math.max(1, MAX_ENHANCED_LONG_SIDE / longest));
    return {
        width: Math.max(1, Math.round(width * capped)),
        height: Math.max(1, Math.round(height * capped)),
    };
};

/** How big a picture becomes once it is rotated: the smallest upright
 *  rectangle the tilted one still fits inside, so no corner is cut off. */
export const rotatedSize = (
    width: number,
    height: number,
    degrees: number,
): { width: number; height: number } => {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    // Rounded before the frame is sized up, or the tiny leftovers of a
    // quarter turn's arithmetic add a needless dot to every side.
    const round = (value: number): number => Math.ceil(Number(value.toFixed(6)));
    return {
        width: Math.max(1, round(width * cos + height * sin)),
        height: Math.max(1, round(width * sin + height * cos)),
    };
};

// --- Measuring the tilt ------------------------------------------------------

/** One number per dot, 0 (black) to 255 (white), at a size small enough that
 *  trying two dozen angles on it is cheap. */
const greyscaleSample = (image: Pixels, maxWidth = 400): {
    grey: Float32Array;
    width: number;
    height: number;
} => {
    const step = Math.max(1, Math.ceil(image.width / maxWidth));
    const width = Math.max(1, Math.floor(image.width / step));
    const height = Math.max(1, Math.floor(image.height / step));
    const grey = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = ((y * step) * image.width + x * step) * 4;
            const r = image.data[at] ?? 255;
            const g = image.data[at + 1] ?? 255;
            const b = image.data[at + 2] ?? 255;
            grey[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
        }
    }
    return { grey, width, height };
};

/**
 * How crisply the writing stacks into lines at one particular tilt.
 *
 * Text on a straight page piles up into dense rows with empty gaps between
 * them; the same text on a tilted page smears those rows into each other. So
 * sliding each column up or down by the amount the tilt would account for and
 * asking how lumpy the result is answers "is it straight yet?" — the lumpiest
 * answer is the straight one.
 *
 * The rows it stacks into are deliberately taller than the picture, with room
 * above and below for the largest shift any angle in range can ask for. Left
 * to spill off the ends, a steeper angle would quietly lose ink from the top
 * and bottom lines, which reads as extra lumpiness and tempts the measurement
 * towards tilts that are not there.
 */
const lineCrispness = (
    grey: Float32Array,
    width: number,
    height: number,
    degrees: number,
    pad: number,
): number => {
    const slope = Math.tan((degrees * Math.PI) / 180);
    const rows = new Float64Array(height + pad * 2);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const shifted = Math.round(y - (x - width / 2) * slope) + pad;
            if (shifted < 0 || shifted >= rows.length) continue;
            // Ink, not paper: dark dots are what forms a line of writing.
            rows[shifted] += 255 - (grey[y * width + x] as number);
        }
    }
    let crispness = 0;
    for (let y = 1; y < rows.length; y++) {
        const gap = (rows[y] as number) - (rows[y - 1] as number);
        crispness += gap * gap;
    }
    return crispness;
};

/**
 * How far off straight a picture of writing is, in degrees.
 *
 * Positive means the writing runs downhill to the right, which is what
 * `straighten` then undoes. Tried coarsely first and then refined around the
 * best answer, because trying every tenth of a degree across the whole range
 * would be twelve times the work for the same result.
 */
export const measureTiltDegrees = (image: Pixels): number => {
    if (image.width < 8 || image.height < 8) return 0;
    const { grey, width, height } = greyscaleSample(image);
    const pad = Math.ceil((width / 2) * Math.tan((MAX_TILT_DEGREES * Math.PI) / 180)) + 2;

    const bestOf = (
        from: number,
        to: number,
        step: number,
        around: number,
    ): { angle: number; score: number } => {
        let best = around;
        let bestScore = -Infinity;
        for (let angle = from; angle <= to + 1e-9; angle += step) {
            const score = lineCrispness(grey, width, height, angle, pad);
            // Angles a fraction apart often stack identically, because a
            // fraction of a degree moves no dot far enough to land in a
            // different row. Straight is the honest answer among equals, so
            // ties go to whichever angle is nearer to no tilt at all.
            const better =
                score > bestScore ||
                (score === bestScore && Math.abs(angle) < Math.abs(best));
            if (better) {
                bestScore = score;
                best = angle;
            }
        }
        return { angle: best, score: bestScore };
    };

    const coarse = bestOf(-MAX_TILT_DEGREES, MAX_TILT_DEGREES, 0.5, 0);
    // An entirely even picture — blank paper, or a solid colour — stacks the
    // same way at every angle. There is no tilt to find, and picking the
    // best of a set of identical answers would invent one.
    if (coarse.score <= 0) return 0;

    const fine = bestOf(coarse.angle - 0.5, coarse.angle + 0.5, 0.1, coarse.angle);
    return Math.round(fine.angle * 10) / 10;
};

// --- Stretching the greys ----------------------------------------------------

/** Where the darkest and lightest real ink sits, ignoring the few stray dots
 *  at either end that a single speck or highlight would otherwise set. */
const levelsOf = (grey: Uint8Array, lowShare = 0.02, highShare = 0.98): { low: number; high: number } => {
    const histogram = new Uint32Array(256);
    for (const value of grey) histogram[value] = (histogram[value] as number) + 1;
    const total = grey.length;
    const lowTarget = total * lowShare;
    const highTarget = total * highShare;

    let seen = 0;
    let low = 0;
    let high = 255;
    for (let value = 0; value < 256; value++) {
        const before = seen;
        seen += histogram[value] as number;
        if (before < lowTarget && seen >= lowTarget) low = value;
        if (before < highTarget && seen >= highTarget) {
            high = value;
            break;
        }
    }
    return { low, high };
};

/**
 * Turn a coloured picture into black writing on white paper.
 *
 * Cards are the reason: a licence is printed on a tinted background with its
 * labels in grey, and grey-on-beige is exactly the kind of low contrast that
 * makes a reader guess. Everything is flattened to grey, then the greys are
 * pulled apart so that the darkest two per cent become black and the lightest
 * two per cent become white.
 *
 * A picture with nothing to pull apart — a blank page, a solid colour — is
 * handed back untouched rather than amplified into noise.
 */
export const stretchLevels = (image: Pixels): Pixels => {
    const count = image.width * image.height;
    const grey = new Uint8Array(count);
    for (let index = 0; index < count; index++) {
        const at = index * 4;
        const r = image.data[at] ?? 0;
        const g = image.data[at + 1] ?? 0;
        const b = image.data[at + 2] ?? 0;
        grey[index] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    const { low, high } = levelsOf(grey);
    const out = new Uint8ClampedArray(image.data.length);
    const span = high - low;

    for (let index = 0; index < count; index++) {
        const value = grey[index] as number;
        const stretched = span > 4 ? ((value - low) * 255) / span : value;
        const clamped = stretched < 0 ? 0 : stretched > 255 ? 255 : stretched;
        const at = index * 4;
        out[at] = clamped;
        out[at + 1] = clamped;
        out[at + 2] = clamped;
        out[at + 3] = 255;
    }

    return { width: image.width, height: image.height, data: out };
};

// --- Sharpening --------------------------------------------------------------

/** How much of the difference between a dot and its blurred self to add back.
 *  Mild on purpose: this step sharpens the speckles as willingly as the type,
 *  which is why it is tried last and only alongside everything else. */
const SHARPEN_AMOUNT = 0.6;

/**
 * Make edges a little crisper by adding back the detail a blur would remove.
 *
 * Blur the picture, see how far each dot fell from where it was, and push it
 * that much further the other way. Type gains a defined edge; so does grain,
 * which is the trade this step is making.
 */
export const unsharpMask = (image: Pixels, amount = SHARPEN_AMOUNT): Pixels => {
    const { width, height, data } = image;
    const out = new Uint8ClampedArray(data.length);
    // A small gaussian: the middle dot counts four times, its neighbours twice
    // and the corners once, sixteen parts in all.
    const weights = [1, 2, 1, 2, 4, 2, 1, 2, 1];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
                let blurred = 0;
                let used = 0;
                let slot = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++, slot++) {
                        const ny = y + dy;
                        const nx = x + dx;
                        if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
                        const weight = weights[slot] as number;
                        blurred += (data[(ny * width + nx) * 4 + channel] as number) * weight;
                        used += weight;
                    }
                }
                const average = used > 0 ? blurred / used : (data[at + channel] as number);
                const original = data[at + channel] as number;
                out[at + channel] = original + amount * (original - average);
            }
            out[at + 3] = data[at + 3] as number;
        }
    }

    return { width, height, data: out };
};

// --- The canvas wrappers -----------------------------------------------------

/** A canvas of a given size with a white background, ready to be drawn onto.
 *  White rather than see-through because a see-through background turns black
 *  when the reader looks at it, which hides the writing completely. */
const blankCanvas = (width: number, height: number): {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
} => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the picture: no 2D canvas available');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    return { canvas, context };
};

/** Read a canvas back out as plain rows of dots. */
export const pixelsOf = (canvas: HTMLCanvasElement): Pixels => {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not look at the picture: no 2D canvas available');
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, data: image.data };
};

/** Put plain rows of dots back onto a canvas of their own. */
const canvasOf = (pixels: Pixels): HTMLCanvasElement => {
    const { canvas, context } = blankCanvas(pixels.width, pixels.height);
    const image = context.createImageData(pixels.width, pixels.height);
    image.data.set(pixels.data);
    context.putImageData(image, 0, 0);
    return canvas;
};

/** A picture of one's own, the same as the one handed in. Used where a second
 *  look needs a picture it is free to let go of afterwards without taking the
 *  caller's own copy away from it. */
export const copyCanvas = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
    const { canvas: out, context } = blankCanvas(canvas.width, canvas.height);
    context.drawImage(canvas, 0, 0);
    return out;
};

/**
 * Draw the picture bigger.
 *
 * Small type is the single commonest reason a card defeats the reader, which
 * wants letters something like twenty dots tall and a card photographed at
 * arm's length gives it half that. Nothing is gained in detail — the detail
 * is not there — but the reader's own shape-matching works far better at a
 * size it was built for.
 */
export const enlarge = (canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement => {
    const size = enlargedSize(canvas.width, canvas.height, factor);
    const { canvas: out, context } = blankCanvas(size.width, size.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, size.width, size.height);
    return out;
};

/**
 * Rotate the picture back to straight, about its middle, onto white paper.
 *
 * `degrees` is how far off straight the picture is, as `measureTiltDegrees`
 * reports it; this turns it back by that much. A picture barely off straight
 * is handed back as it is, because re-drawing every dot to correct a hair of
 * tilt softens fine type for nothing.
 */
export const straighten = (canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement => {
    if (!Number.isFinite(degrees) || Math.abs(degrees) < MIN_TILT_DEGREES) return canvas;
    const size = rotatedSize(canvas.width, canvas.height, degrees);
    const { canvas: out, context } = blankCanvas(size.width, size.height);
    context.translate(size.width / 2, size.height / 2);
    context.rotate((-degrees * Math.PI) / 180);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return out;
};

/** Black writing on white paper — see `stretchLevels`. */
export const contrast = (canvas: HTMLCanvasElement): HTMLCanvasElement =>
    canvasOf(stretchLevels(pixelsOf(canvas)));

/** Crisper edges — see `unsharpMask`. Last, because it sharpens the specks
 *  as willingly as the writing. */
export const sharpen = (canvas: HTMLCanvasElement): HTMLCanvasElement =>
    canvasOf(unsharpMask(pixelsOf(canvas)));
