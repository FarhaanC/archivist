/**
 * The standard timing test's files, made from nothing in the browser.
 *
 * The point of a fixed set is that a number measured today means the same as
 * a number measured next month, and on someone else's laptop. Nothing here
 * comes off disk, nothing is downloaded, and none of it goes near the
 * person's library. The exact set is written down in
 * docs/progress-design-notes.md; changing it changes what the number means.
 */

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

// --- The set itself ---------------------------------------------------------

/** How many pages the scan reader will have to read, for the record. */
export const STANDARD_PAGES = 6 + 6 + 3 + 1;

/**
 * Twelve files, sixteen pages: six one-page scans, one six-page scan, three
 * photos (one ordinary, one with the writing on its side, one very large),
 * a blank page, and one typed text file for contrast.
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
