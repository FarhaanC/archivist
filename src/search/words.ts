/**
 * Word handling shared by the parts of search that need to ask "is this text
 * about the same thing as that text" — snippet selection, sub-query filtering
 * and follow-up detection. One definition, so they cannot drift apart.
 */

/** Words that carry no topical signal. */
export const IGNORED_WORDS = new Set([
    'a', 'about', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by',
    'can', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how',
    'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our',
    'say', 'says', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was',
    'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
    'with', 'would', 'you', 'your',
]);

/**
 * Crude singular form, so "resumes" matches "resume". Both sides of any
 * comparison go through it, so an imperfect stem still matches itself.
 */
export const stem = (word: string): string =>
    word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;

/** The words in `text` that actually carry meaning, in order, stemmed. */
export const contentWordList = (text: string): string[] =>
    text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !IGNORED_WORDS.has(w))
        .map(stem);

/** The same, as a set, for membership tests. */
export const contentWords = (text: string): Set<string> => new Set(contentWordList(text));
