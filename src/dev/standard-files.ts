/**
 * The standard timing test's files, made from nothing in the browser.
 *
 * The point of a fixed set is that a number measured today means the same as
 * a number measured next month, and on someone else's laptop. Nothing here
 * comes off disk, nothing is downloaded, and none of it goes near the
 * person's library. The exact set is written down in
 * docs/progress-design-notes.md; changing it changes what the number means.
 */
import { flattenArabic } from '@/ocr/labels';

/** Words to draw onto the made-up pages. Ordinary office prose, because that
 *  is what the reader will meet in real life — not a pangram. */
const LINES = [
    'TENANCY CONTRACT — RENEWAL NOTICE',
    'Reference: ARC-2291-B   Issued: 14 March',
    '',
    'This notice confirms that the agreement described below will renew',
    'for a further twelve months unless either party gives written',
    'notice no later than sixty days before the expiry date.',
    '',
    'Property: Unit 1204, Marina Heights, Plot 42',
    'Annual rent: payable in four instalments',
    'Maintenance: landlord retains responsibility for the air',
    'conditioning units and the water heater.',
    '',
    'Signed on behalf of the landlord and countersigned by the tenant.',
];

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;

/** Draw a page of text, the way a flatbed scanner would have seen it. */
const drawPage = (
    width: number,
    height: number,
    { rotate = false, blank = false, heading = '' }: {
        rotate?: boolean;
        blank?: boolean;
        heading?: string;
    } = {},
): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser will not draw the test pages.');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    if (blank) return canvas;

    const scale = width / PAGE_WIDTH;
    context.save();
    if (rotate) {
        context.translate(width, 0);
        context.rotate(Math.PI / 2);
    }
    context.fillStyle = '#12100d';
    context.textBaseline = 'top';

    const left = 90 * scale;
    let y = 120 * scale;
    if (heading) {
        context.font = `bold ${34 * scale}px Georgia, "Times New Roman", serif`;
        context.fillText(heading, left, y);
        y += 70 * scale;
    }
    context.font = `${28 * scale}px Georgia, "Times New Roman", serif`;
    for (const line of LINES) {
        context.fillText(line, left, y);
        y += 44 * scale;
    }
    context.restore();
    return canvas;
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('Could not save the test page'))),
            type,
            quality,
        );
    });

// --- A very small PDF writer ------------------------------------------------

/**
 * Wrap JPEG pages in a PDF, one page each, with no text inside.
 *
 * Only a handful of PDF is needed for that — a catalogue, a page list, and
 * per page a page object, a one-line drawing instruction and the JPEG itself,
 * which PDF stores byte for byte. It is here rather than as a dependency
 * because a dependency for eleven objects would be a worse trade, and because
 * the app must keep working with no network at all.
 */
const jpegPdf = (pages: { jpeg: Uint8Array; width: number; height: number }[]): Blob => {
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;

    const encoder = new TextEncoder();
    const push = (part: Uint8Array | string): void => {
        const bytes = typeof part === 'string' ? encoder.encode(part) : part;
        chunks.push(bytes);
        length += bytes.length;
    };
    /** Objects are numbered from 1 and must be findable by byte offset. */
    const object = (number: number, body: string, stream?: Uint8Array): void => {
        offsets[number] = length;
        push(`${number} 0 obj\n${body}\n`);
        if (stream) {
            push('stream\n');
            push(stream);
            push('\nendstream\n');
        }
        push('endobj\n');
    };

    push('%PDF-1.4\n');

    const first = 3;
    const kids = pages.map((_, index) => `${first + index * 3} 0 R`).join(' ');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

    pages.forEach((page, index) => {
        const pageNo = first + index * 3;
        const contentNo = pageNo + 1;
        const imageNo = pageNo + 2;
        object(
            pageNo,
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
                `/Resources << /XObject << /Im0 ${imageNo} 0 R >> >> /Contents ${contentNo} 0 R >>`,
        );
        const draw = encoder.encode(`q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q`);
        object(contentNo, `<< /Length ${draw.length} >>`, draw);
        object(
            imageNo,
            `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
                `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
                `/Length ${page.jpeg.length} >>`,
            page.jpeg,
        );
    });

    const count = 2 + pages.length * 3 + 1;
    const startxref = length;
    push(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let number = 1; number < count; number++) {
        push(`${String(offsets[number] ?? 0).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

    return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
};

const jpegPage = async (
    canvas: HTMLCanvasElement,
): Promise<{ jpeg: Uint8Array; width: number; height: number }> => ({
    jpeg: new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.85)).arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
});

// --- Four cards that are hard on purpose ------------------------------------

/**
 * The card the four hard files are drawn from: a UAE vehicle licence, near
 * enough.
 *
 * Small grey labels on a tinted background, printed twice — once in English
 * and once in Arabic — which is what makes these cards hard and what makes
 * them worth having in a fixed test set. Everything the reader ought to come
 * back with is written down beside it, so "did this get better?" has a number
 * rather than an impression.
 */
const CARD_ROWS: { label: string; arabic: string; value: string }[] = [
    { label: 'Licence No.', arabic: 'رقم الرخصة', value: '1868432' },
    { label: 'Exp. Date', arabic: 'إنتهاء الترخيص', value: '23-12-2025' },
    { label: 'Ins. Exp.', arabic: 'إنتهاء التأمين', value: '23-01-2026' },
    { label: 'Plate No.', arabic: 'رقم اللوحة', value: '51234' },
    { label: 'Nationality', arabic: 'الجنسية', value: 'Indian' },
    { label: 'Date of Birth', arabic: 'تاريخ الميلاد', value: '14-03-1999' },
];

/**
 * What each hard card ought to yield, so the timing page can count how much
 * of it actually came through.
 *
 * The values matter more than the labels: a date with no label is a date
 * nobody can use, but a label with no date is worse than useless. Both are
 * counted, and the count is reported as "found of expected".
 */
export const STANDARD_EXPECTED: Readonly<Record<string, readonly string[]>> = {
    'card-small.jpg': CARD_ROWS.flatMap((row) => [row.label, row.value]),
    'card-tilted.jpg': CARD_ROWS.flatMap((row) => [row.label, row.value]),
    'card-blurred.jpg': CARD_ROWS.flatMap((row) => [row.label, row.value]),
    'card-photo.jpg': CARD_ROWS.flatMap((row) => [row.label, row.value, row.arabic]),
};

/** The hard cards, by the name they are given as files. */
export const STANDARD_HARD_CARDS = Object.keys(STANDARD_EXPECTED);

/** Loose enough to forgive what does not matter — capitals, spacing, and the
 *  several ways the same Arabic word can be spelled — and strict enough that
 *  a wrong date is a miss. */
const sameShape = (text: string): string => flattenArabic(text).toLowerCase();

/**
 * How much of a hard card actually came through.
 *
 * Null for every other file in the set, because only the hard cards have a
 * list of what they say written down. This is the number the second look has
 * to justify itself against: run the standard test with a second look turned
 * off, then with it on, and the difference between these two counts is what
 * the extra seconds bought.
 */
export const wordsFoundIn = (
    filename: string,
    text: string,
): { found: number; expected: number } | null => {
    const expected = STANDARD_EXPECTED[filename];
    if (!expected) return null;
    const haystack = sameShape(text);
    return {
        found: expected.filter((wanted) => haystack.includes(sameShape(wanted))).length,
        expected: expected.length,
    };
};

/**
 * Draw the card.
 *
 * `photo` is the larger, more photograph-like version: a coloured header
 * band, and the Arabic label printed beside each English one, the way the
 * real card does it. The browser shapes and joins the Arabic itself, which
 * every browser this app runs in can do.
 */
const drawCard = (
    width: number,
    height: number,
    { photo = false }: { photo?: boolean } = {},
): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser will not draw the test pages.');

    const scale = width / 900;

    // A tinted background with grey printing on it: low contrast on purpose,
    // because that is what defeats the reader on a real card.
    context.fillStyle = photo ? '#eceae3' : '#eceae6';
    context.fillRect(0, 0, width, height);

    if (photo) {
        context.fillStyle = '#9b2d2d';
        context.fillRect(0, 0, width, 110 * scale);
        context.fillStyle = '#ffffff';
        context.font = `bold ${30 * scale}px Tahoma, "Segoe UI", Arial, sans-serif`;
        context.textBaseline = 'middle';
        context.fillText('UNITED ARAB EMIRATES', 40 * scale, 55 * scale);
    }

    context.textBaseline = 'top';
    let y = (photo ? 150 : 60) * scale;
    const left = 40 * scale;
    const valueAt = 300 * scale;

    for (const row of CARD_ROWS) {
        // Grey labels, near-black values: the contrast a card actually uses,
        // and the reason the labels break up first on a photograph.
        context.fillStyle = '#6f6f6f';
        context.font = `${(photo ? 15 : 13) * scale}px Tahoma, "Segoe UI", Arial, sans-serif`;
        context.fillText(row.label, left, y);

        context.fillStyle = '#17171a';
        context.font = `${(photo ? 19 : 16) * scale}px Tahoma, "Segoe UI", Arial, sans-serif`;
        context.fillText(row.value, valueAt, y - 2 * scale);

        if (photo) {
            context.fillStyle = '#5c5c5c';
            context.font = `${20 * scale}px Tahoma, "Segoe UI", Arial, sans-serif`;
            context.textAlign = 'right';
            context.direction = 'rtl';
            context.fillText(row.arabic, width - 40 * scale, y - 3 * scale);
            context.textAlign = 'left';
            context.direction = 'ltr';
        }

        y += (photo ? 62 : 44) * scale;
    }

    return canvas;
};

/** The same card, turned by a few degrees onto its own background — a card
 *  photographed by hand, in other words. */
const tiltCard = (source: HTMLCanvasElement, degrees: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser will not draw the test pages.');
    context.fillStyle = '#eceae6';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((degrees * Math.PI) / 180);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    return canvas;
};

/** The same card, slightly out of focus. Where the browser will not blur for
 *  us the card is used as it is, and the file set is a little kinder that
 *  day — noted rather than silently pretended away. */
const blurCard = (source: HTMLCanvasElement, radius: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser will not draw the test pages.');
    context.fillStyle = '#eceae6';
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
        context.filter = `blur(${radius}px)`;
    } catch {
        // Left sharp; see above.
    }
    context.drawImage(source, 0, 0);
    context.filter = 'none';
    return canvas;
};

// --- The set itself ---------------------------------------------------------

/** How many pages the scan reader will have to read, for the record. */
export const STANDARD_PAGES = 6 + 6 + 3 + 1 + 4;

/**
 * Sixteen files, twenty pages: six one-page scans, one six-page scan, three
 * photos (one ordinary, one with the writing on its side, one very large),
 * four cards that are hard on purpose, a blank page, and one typed text file
 * for contrast.
 */
export const buildStandardFiles = async (): Promise<File[]> => {
    const files: File[] = [];

    for (let index = 1; index <= 6; index++) {
        const page = await jpegPage(
            drawPage(PAGE_WIDTH, PAGE_HEIGHT, { heading: `Notice ${index} of 6` }),
        );
        files.push(
            new File([jpegPdf([page])], `scan-${index}.pdf`, { type: 'application/pdf' }),
        );
    }

    const many = [];
    for (let index = 1; index <= 6; index++) {
        many.push(await jpegPage(drawPage(PAGE_WIDTH, PAGE_HEIGHT, { heading: `Page ${index}` })));
    }
    files.push(new File([jpegPdf(many)], 'six-page-scan.pdf', { type: 'application/pdf' }));

    files.push(
        new File([await toBlob(drawPage(1600, 2200, { heading: 'Photograph' }), 'image/jpeg', 0.9)],
            'photo-plain.jpg',
            { type: 'image/jpeg' },
        ),
    );
    files.push(
        new File(
            [await toBlob(drawPage(2200, 1600, { rotate: true, heading: 'On its side' }), 'image/jpeg', 0.9)],
            'photo-sideways.jpg',
            { type: 'image/jpeg' },
        ),
    );
    files.push(
        new File([await toBlob(drawPage(4000, 5657, { heading: 'Large photograph' }), 'image/jpeg', 0.9)],
            'photo-large.jpg',
            { type: 'image/jpeg' },
        ),
    );

    // The four hard ones. Photographs rather than PDFs, because a card is
    // something a person points a phone at.
    const small = drawCard(900, 560);
    files.push(
        new File([await toBlob(small, 'image/jpeg', 0.9)], 'card-small.jpg', {
            type: 'image/jpeg',
        }),
    );
    files.push(
        new File([await toBlob(tiltCard(small, 4), 'image/jpeg', 0.9)], 'card-tilted.jpg', {
            type: 'image/jpeg',
        }),
    );
    files.push(
        new File([await toBlob(blurCard(small, 1.4), 'image/jpeg', 0.9)], 'card-blurred.jpg', {
            type: 'image/jpeg',
        }),
    );
    files.push(
        new File([await toBlob(drawCard(2400, 1500, { photo: true }), 'image/jpeg', 0.9)],
            'card-photo.jpg',
            { type: 'image/jpeg' },
        ),
    );

    files.push(
        new File([await toBlob(drawPage(1240, 1754, { blank: true }), 'image/png')], 'blank.png', {
            type: 'image/png',
        }),
    );

    files.push(
        new File([`${LINES.join('\n')}\n`.repeat(40)], 'typed-notes.txt', { type: 'text/plain' }),
    );

    return files;
};
