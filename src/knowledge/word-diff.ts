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

/** Human-readable one-liner: `"5 years" → "7 years"; "100 m" → "120 m" (+2 more)` */
export const summarizeDiff = (changes: DiffChange[], maxShown: number = 3): string => {
    if (!changes.length) return 'identical text';
    const clip = (s: string) => (s.length > 60 ? s.slice(0, 57) + '…' : s) || '(nothing)';
    const shown = changes
        .slice(0, maxShown)
        .map((c) => `"${clip(c.removed)}" → "${clip(c.added)}"`)
        .join('; ');
    const extra = changes.length - maxShown;
    return shown + (extra > 0 ? ` (+${extra} more change${extra > 1 ? 's' : ''})` : '');
};
