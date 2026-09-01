/**
 * Word-level diff between two near-duplicate documents, so the system KNOWS
 * what actually changed ("5 years" → "7 years"), not just that they're similar.
 */

export interface DiffChange {
    removed: string;
    added: string;
}

const tokenize = (text: string): string[] =>
    text.replace(/\s+/g, ' ').trim().split(' ');

/**
 * LCS-based word diff, grouped into change regions.
 * Capped for very large documents (compares first `maxWords` words).
 */
export const wordDiff = (
    oldText: string,
    newText: string,
    maxWords: number = 4000
): DiffChange[] => {
    const a = tokenize(oldText).slice(0, maxWords);
    const b = tokenize(newText).slice(0, maxWords);

    // LCS table (word level)
    const m = a.length, n = b.length;
    // Guard: for very large inputs fall back to a cheap linear scan
    if (m * n > 4_000_000) return linearDiff(a, b);

    const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i]![j] = a[i] === b[j]
                ? dp[i + 1]![j + 1]! + 1
                : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
    }

    const changes: DiffChange[] = [];
    let i = 0, j = 0;
    let curRemoved: string[] = [], curAdded: string[] = [];
    const flush = () => {
        if (curRemoved.length || curAdded.length) {
            changes.push({ removed: curRemoved.join(' '), added: curAdded.join(' ') });
            curRemoved = []; curAdded = [];
        }
    };
    while (i < m && j < n) {
        if (a[i] === b[j]) { flush(); i++; j++; }
        else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { curRemoved.push(a[i]!); i++; }
        else { curAdded.push(b[j]!); j++; }
    }
    while (i < m) { curRemoved.push(a[i]!); i++; }
    while (j < n) { curAdded.push(b[j]!); j++; }
    flush();
    return changes;
};

/** Cheap fallback for huge docs: report differing head/tail regions only. */
const linearDiff = (a: string[], b: string[]): DiffChange[] => {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length - 1, endB = b.length - 1;
    while (endA > start && endB > start && a[endA] === b[endB]) { endA--; endB--; }
    if (start > endA && start > endB) return [];
    return [{
        removed: a.slice(start, endA + 1).join(' ').slice(0, 300),
        added: b.slice(start, endB + 1).join(' ').slice(0, 300),
    }];
};

/* ------------------------------------------------------------------ *
 * Turning a diff into something a person can read.
 *
 * A raw word diff between two versions of a CV is mostly noise: a pipe
 * character that moved, a line break that became a space, a URL that got
 * written as link text. Printing it verbatim produces the sort of thing that
 * made the import report unreadable —
 *   "UAE Driving License |" → "(nothing)"; "(nothing)" → "|"
 * — which tells the reader nothing about how the two files actually differ.
 *
 * So changes are filtered down to the ones carrying real words, ranked by how
 * much text they involve, and described in ordinary sentences.
 * ------------------------------------------------------------------ */

/**
 * The words and numbers in a fragment, ignoring punctuation and spacing.
 *
 * Single characters count: "5 years" becoming "7 years" is exactly the kind of
 * change a person needs to see, and it reaches here as "5" → "7".
 */
const meaningful = (fragment: string): string[] =>
    fragment.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? [];

/**
 * Changes worth showing a person, most substantial first.
 *
 * Dropped: anything where neither side contains a letter or digit. That is
 * punctuation and spacing shuffling about, which is what filled the old
 * report with entries like `"|" → "(nothing)"`.
 */
export const meaningfulChanges = (changes: DiffChange[]): DiffChange[] =>
    changes
        .filter(
            (change) =>
                meaningful(change.removed).length > 0 || meaningful(change.added).length > 0,
        )
        .sort(
            (a, b) =>
                meaningful(b.removed).join(' ').length +
                meaningful(b.added).join(' ').length -
                (meaningful(a.removed).join(' ').length + meaningful(a.added).join(' ').length),
        );

/** Trim to a readable length without cutting a word in half. */
const clip = (text: string, maxLength: number = 55): string => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    const cut = clean.lastIndexOf(' ', maxLength);
    return `${clean.slice(0, cut > maxLength / 2 ? cut : maxLength).trim()}…`;
};

/**
 * One change, as a sentence.
 *
 * `removed` is what the other document says; `added` is what this one says.
 */
export const describeChange = (change: DiffChange): string => {
    const removed = meaningful(change.removed);
    const added = meaningful(change.added);

    if (removed.length === 0) return `Adds “${clip(change.added)}”`;
    if (added.length === 0) return `Leaves out “${clip(change.removed)}”`;
    return `Says “${clip(change.added)}” where the other says “${clip(change.removed)}”`;
};

export interface PlainDiff {
    /** Up to `maxShown` sentences, the biggest differences first. */
    points: string[];
    /** How many further real changes were not listed. */
    minorCount: number;
}

/** The whole diff, in plain sentences. */
export const describeChanges = (changes: DiffChange[], maxShown: number = 3): PlainDiff => {
    const worthShowing = meaningfulChanges(changes);
    return {
        points: worthShowing.slice(0, maxShown).map(describeChange),
        minorCount: Math.max(0, worthShowing.length - maxShown),
    };
};

/**
 * A single sentence, for places that can only hold one line — the stored
 * document profile, and the library inventory shown to the model.
 */
export const summarizeDiff = (changes: DiffChange[], maxShown: number = 3): string => {
    const { points, minorCount } = describeChanges(changes, maxShown);
    if (points.length === 0) return 'The wording is the same; only spacing or punctuation differs.';
    const tail = minorCount > 0 ? `, plus ${minorCount} smaller wording change${minorCount > 1 ? 's' : ''}` : '';
    return `${points.join('; ')}${tail}.`;
};
