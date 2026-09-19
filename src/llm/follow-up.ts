/**
 * Does this question lean on the one before it?
 *
 * The first attempt at this used length: a question with fewer than five
 * meaningful words might be leaning on the previous one, so search it both
 * ways. Length turned out to be a bad proxy. Ordinary questions are short —
 * "Which university is my degree from?" carries two meaningful words — so
 * nearly every question was treated as a follow-up. Every one of them was
 * searched twice, the screen said "Searched as 2 sub-questions" when nothing
 * had been split, and the whole previous conversation was handed to the model
 * along with the new question.
 *
 * Pointing backwards is the real signal. A follow-up refers to something
 * already said — "the other one", "and the 2024 one?", "what about the
 * freelance version" — and that shows up as a small set of words and
 * openings. The list is deliberately short and readable. A phrasing it misses
 * costs one extra search on the next turn, not a wrong answer.
 */

/** Words and phrases that point back at something already mentioned. */
const BACK_REFERENCES = [
    'it',
    'that',
    'those',
    'these',
    'this one',
    'the other',
    'the other one',
    'the same',
    'the first',
    'the second',
    'the latter',
    'the former',
    'there',
    'then',
    'instead',
    'too',
    'also',
];

/** Openings that continue the previous question rather than starting a new one. */
const CONTINUATIONS = ['and', 'or', 'but', 'what about', 'how about', 'also'];

/**
 * At or below this many words, a question cannot carry its own subject:
 * "expiry date?", "the 2024 one". Counted in plain words rather than
 * meaningful ones, because "Which university is my degree from?" has only two
 * meaningful words and stands perfectly well on its own.
 */
const TOO_SHORT_TO_STAND_ALONE = 3;

/** Lowercased, punctuation flattened to spaces, padded so whole-word and
 *  whole-phrase matching is a plain substring test. */
const normalise = (text: string): string =>
    ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

export const isFollowUp = (question: string): boolean => {
    const padded = normalise(question);
    const words = padded.trim().split(' ').filter(Boolean);

    if (words.length <= TOO_SHORT_TO_STAND_ALONE) return true;
    if (BACK_REFERENCES.some((phrase) => padded.includes(` ${phrase} `))) return true;
    return CONTINUATIONS.some((opening) => padded.startsWith(` ${opening} `));
};
