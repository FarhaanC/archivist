/**
 * Citations inside an answer.
 *
 * The model is told to cite as `[filename]`, and until now that arrived as
 * plain text. It is the one place in an answer where the reader is being
 * pointed at something, so it should be the one place they can click: tapping
 * a citation moves the sources pane to that passage.
 *
 * The model does not always reproduce a filename exactly — it drops the
 * extension, shortens it, changes an underscore to a space — so matching is
 * deliberately forgiving. A bracket that matches nothing is left as written
 * rather than turned into a link that goes nowhere.
 */

export type AnswerSegment =
    | { kind: 'text'; text: string }
    | { kind: 'citation'; text: string; filename: string };

/** Compare loosely: case, punctuation and extension are all noise here. */
const normalize = (value: string): string =>
    value
        .toLowerCase()
        .replace(/\.(pdf|docx?|txt|md|pptx?|xlsx?|csv)$/i, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

/**
 * The filename a bracketed label refers to, or null when it refers to none of
 * them. When several could match, the closest in length wins — that keeps
 * "resume_2026" pointing at `resume_2026.pdf` rather than
 * `resume_2026_freelance.pdf`.
 *
 * `filenames` must be in the same order the excerpts were given to the model,
 * because a model told to cite filenames will sometimes cite "[2]" instead.
 */
export const matchFilename = (label: string, filenames: string[]): string | null => {
    // "[2]" means the second excerpt, not a file whose name contains a 2.
    // Handled before any text matching: "1" is a substring of half the
    // filenames in a folder of versioned CVs, and matching it as text turned
    // every excerpt number into a link to the wrong document.
    const asIndex = label.trim();
    if (/^\d{1,3}$/.test(asIndex)) {
        const position = Number.parseInt(asIndex, 10);
        return filenames[position - 1] ?? null;
    }

    const wanted = normalize(label);
    // A one- or two-character fragment matches almost anything. Whatever it
    // is, it is not a filename.
    if (wanted.replace(/\s/g, '').length < 3) return null;

    let best: string | null = null;
    let bestDistance = Infinity;

    for (const filename of filenames) {
        const candidate = normalize(filename);
        if (!candidate) continue;

        const hit =
            candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
        if (!hit) continue;

        const distance = Math.abs(candidate.length - wanted.length);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = filename;
        }
    }

    return best;
};

/**
 * Split an answer into plain text and citations, ready to render.
 * Concatenating every segment's `text` reproduces the original answer exactly.
 */
export const parseCitations = (answer: string, filenames: string[]): AnswerSegment[] => {
    const segments: AnswerSegment[] = [];
    const pattern = /\[([^\]\n]{1,200})\]/g;
    let lastIndex = 0;

    for (let match = pattern.exec(answer); match !== null; match = pattern.exec(answer)) {
        const [whole, label = ''] = match;
        const filename = matchFilename(label, filenames);

        if (filename === null) continue;

        if (match.index > lastIndex) {
            segments.push({ kind: 'text', text: answer.slice(lastIndex, match.index) });
        }
        segments.push({ kind: 'citation', text: whole, filename });
        lastIndex = match.index + whole.length;
    }

    if (lastIndex < answer.length) {
        segments.push({ kind: 'text', text: answer.slice(lastIndex) });
    }

    return segments;
};
