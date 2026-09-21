/**
 * The Arabic labels that UAE documents always carry, and what they mean.
 *
 * Why this exists. A UAE vehicle licence prints every label twice, once in
 * English and once in Arabic, and the Arabic is usually the larger of the
 * two. On a photograph the small English label is the first thing to break
 * up: on Farhaan's own licence "Exp. Date" came back as "1868. Date" while
 * "Ins. Exp." beside the insurance date came back clean. Asked when the
 * licence expires, the model then answered with the insurance date, because
 * that was the only date whose label it could read. It was not wrong to do
 * that; it was reading what it was given.
 *
 * So where the English label is lost, the Arabic one beside it usually
 * survives, and putting its meaning in plain English into the stored text
 * gives both the search and the model a label they can use. Nothing else is
 * translated. The Arabic stays exactly where it was, and the English is added
 * after it in brackets, so what the person is shown alongside an answer says
 * plainly what the Arabic means rather than quietly replacing it.
 */

export interface ArabicLabel {
    /** As it is printed. Several spellings where cards differ. */
    arabic: string[];
    /** What it means, in the plainest English that fits on a card. */
    english: string;
}

/**
 * The table. Every one of these appears on the ordinary UAE papers this app
 * was built for — a licence, an identity card, a visa page, an insurance
 * certificate. Three of them are on the licence photograph that prompted all
 * of this.
 */
export const ARABIC_LABELS: readonly ArabicLabel[] = [
    { arabic: ['إنتهاء الترخيص', 'انتهاء الرخصة'], english: 'Licence expiry' },
    { arabic: ['إنتهاء التأمين'], english: 'Insurance expiry' },
    { arabic: ['تاريخ الإصدار'], english: 'Issue date' },
    { arabic: ['تاريخ الانتهاء', 'تاريخ الإنتهاء'], english: 'Expiry date' },
    { arabic: ['تاريخ الميلاد'], english: 'Date of birth' },
    { arabic: ['رقم الهوية'], english: 'ID number' },
    { arabic: ['رقم الرخصة'], english: 'Licence number' },
    { arabic: ['رقم اللوحة'], english: 'Plate number' },
    { arabic: ['نوع التأمين'], english: 'Insurance type' },
    { arabic: ['مؤمنة لدى'], english: 'Insured by' },
    { arabic: ['رقم الملف'], english: 'File number' },
    { arabic: ['مكان الإصدار'], english: 'Place of issue' },
    { arabic: ['الجنسية'], english: 'Nationality' },
    { arabic: ['الاسم'], english: 'Name' },
];

/** The same meaning is not repeated inside this many characters: a card often
 *  prints a label twice, once on each half, and two explanations a few words
 *  apart would read as a stutter. */
const REPEAT_WINDOW = 40;

/** Marks above and below the letters, and the stretching dash used to pad a
 *  word out — neither of which changes what a word says. */
const DECORATION = /[ً-ْٰـ​-‏‪-‮⁦-⁩]/;

const ARABIC_LETTER = /[ء-يٮ-ۓﭐ-﷿ﹰ-﻿]/;

/**
 * One spelling of an Arabic word, stripped down to what it actually says.
 * Exported because the standard test counts how much of a card came through,
 * and has to compare what it drew with what came back the same way.
 *
 * Cards, fonts and readers disagree about the small things — whether an alif
 * carries its hamza, whether a word ends in a round or an open h, whether
 * there is a space between two words at all. Reading one off a photograph
 * adds its own disagreements on top. Flattening all of that away is what lets
 * a label printed one way be recognised when it comes back another.
 */
export const flattenArabic = (text: string): string =>
    text
        .replace(new RegExp(DECORATION.source, 'g'), '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/[ىئ]/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/\s+/g, '');

/** The same, but keeping track of where each surviving character came from,
 *  so a match can be put back in its place in the original. */
const flattenWithPlaces = (text: string): { flat: string; places: number[] } => {
    let flat = '';
    const places: number[] = [];
    for (let index = 0; index < text.length; index++) {
        const character = text[index] as string;
        const mapped = flattenArabic(character);
        if (!mapped) continue;
        flat += mapped;
        places.push(index);
    }
    return { flat, places };
};

/**
 * Every way one label might have come back from a photograph.
 *
 * The first letters of a label are the ones that go: on the licence, إنتهاء
 * الترخيص came back as تهاءالترخيص, two letters short at the front, and the
 * brief's "one missing letter" turned out to be an undercount. So rather than
 * guess at a number, a label is also recognised by any long enough tail of
 * itself — a fifth of it may be missing from the front — along with the
 * spelling one letter short at the back.
 *
 * The floor of seven letters is what keeps this honest. Below it a tail is no
 * longer distinctive: shorten الاسم and what is left would match half the
 * page, and a label explained in the wrong place is worse than one not
 * explained at all. Short labels are therefore matched only in full.
 */
const formsOf = (spelling: string): string[] => {
    const flat = flattenArabic(spelling);
    const shortest = Math.max(7, Math.ceil(flat.length * 0.8));
    if (flat.length < shortest) return [flat];

    const forms = [flat.slice(0, -1)];
    for (let length = flat.length; length >= shortest; length--) {
        forms.push(flat.slice(flat.length - length));
    }
    return forms;
};

interface Candidate {
    form: string;
    english: string;
}

/** Longest first, so a label that contains another is matched as itself. */
const CANDIDATES: readonly Candidate[] = ARABIC_LABELS.flatMap(({ arabic, english }) =>
    arabic.flatMap((spelling) => formsOf(spelling).map((form) => ({ form, english }))),
)
    .filter((candidate) => candidate.form.length > 0)
    .sort((a, b) => b.form.length - a.form.length);

/** Which labels a piece of text carries. Exported for the sake of being able
 *  to check a real document without changing it. */
export const findArabicLabels = (text: string): { english: string; at: number }[] => {
    const { flat, places } = flattenWithPlaces(text);
    if (!flat) return [];

    const taken: boolean[] = new Array(flat.length).fill(false);
    const found: { english: string; at: number }[] = [];

    for (const { form, english } of CANDIDATES) {
        let from = 0;
        for (;;) {
            const at = flat.indexOf(form, from);
            if (at < 0) break;
            from = at + 1;

            // A label already explained as part of a longer one is not
            // explained again as part of itself.
            let overlaps = false;
            for (let index = at; index < at + form.length; index++) {
                if (taken[index]) overlaps = true;
            }
            if (overlaps) continue;
            for (let index = at; index < at + form.length; index++) taken[index] = true;

            // Where the label ends in the text as it was actually written.
            let end = (places[at + form.length - 1] as number) + 1;
            // Never land in the middle of a word: if the label turned out to
            // be the front of a longer one, carry on to the end of it.
            while (end < text.length && ARABIC_LETTER.test(text[end] as string)) end += 1;

            found.push({ english, at: end });
        }
    }

    return found.sort((a, b) => a.at - b.at);
};

/**
 * Put the English meaning of each Arabic label into the text, just after the
 * label itself.
 *
 * Only ever used on words read off a picture. Typed documents carry their own
 * labels intact and need no help; text with no Arabic in it is handed straight
 * back, untouched.
 */
export const explainArabicLabels = (text: string): string => {
    if (!text || !ARABIC_LETTER.test(text)) return text;

    const found = findArabicLabels(text);
    if (found.length === 0) return text;

    const lastSeen = new Map<string, number>();
    const insertions: { at: number; words: string }[] = [];
    for (const { english, at } of found) {
        const previous = lastSeen.get(english);
        if (previous !== undefined && at - previous < REPEAT_WINDOW) continue;
        lastSeen.set(english, at);
        insertions.push({ at, words: ` (${english})` });
    }

    // Back to front, so each insertion leaves the ones before it where they
    // were.
    let out = text;
    for (const { at, words } of [...insertions].reverse()) {
        out = out.slice(0, at) + words + out.slice(at);
    }
    return out;
};
