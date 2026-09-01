/**
 * Chunking.
 *
 * Splits on the largest natural boundary that still fits, walking down from
 * paragraph to line to sentence to word. Cutting mid-sentence is what produces
 * the retrieved fragment that answers nothing; overlap keeps a fact that
 * straddles a boundary retrievable from either side.
 */

export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 50;

const SEPARATORS = ['\n\n', '\n', '. ', ' '];

const splitOnce = (text: string, size: number): [string, string] => {
    if (text.length <= size) return [text, ''];
    for (const separator of SEPARATORS) {
        const cut = text.lastIndexOf(separator, size);
        if (cut > size * 0.5) {
            return [text.slice(0, cut + separator.length).trim(), text.slice(cut + separator.length)];
        }
    }
    // No usable boundary (a long unbroken token): hard-cut rather than emit a
    // chunk the embedder will silently truncate.
    return [text.slice(0, size), text.slice(size)];
};

export const chunkText = (
    text: string,
    size: number = CHUNK_SIZE,
    overlap: number = CHUNK_OVERLAP,
): string[] => {
    const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    if (!normalized) return [];

    const chunks: string[] = [];
    let rest = normalized;

    while (rest.length > 0) {
        const [head, tail] = splitOnce(rest, size);
        const chunk = head.trim();
        if (chunk) chunks.push(chunk);
        if (!tail) break;
        const carry = head.slice(Math.max(0, head.length - overlap));
        rest = (carry + tail).trimStart();
        // Guard against a pathological input that never shrinks.
        if (rest.length >= normalized.length && chunks.length > 1) break;
    }

    return chunks;
};
