/** Tuning constants for hybrid retrieval. Kept in one place so they can be
 *  changed without hunting through the search code. */

/** Reciprocal Rank Fusion damping. Higher = flatter contribution curve. */
export const RRF_CONSTANT = 60;

/** Multiplier applied when a chunk contains the query as a literal phrase. */
export const EXACT_PHRASE_BOOST = 2.0;

export const MINI_SEARCH_FUZZY = 0.2;
export const MINI_SEARCH_TEXT_BOOST = 2;
export const MINI_SEARCH_TITLE_BOOST = 3;

/** Fused scores are tiny by construction; scale them for display only. */
export const SCORE_DISPLAY_SCALE = 100;

/**
 * Words carrying no topical signal. Used by the library brain when building
 * per-document term profiles and by usage memory when recording what the user
 * asks about — not by the search index, which handles them statistically.
 */
export const STOP_WORDS = new Set([
    'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at',
    'be', 'because', 'been', 'being', 'but', 'by', 'can', 'could', 'did', 'do',
    'does', 'doing', 'done', 'for', 'from', 'had', 'has', 'have', 'how', 'i',
    'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'more', 'most', 'my',
    'no', 'not', 'of', 'on', 'one', 'only', 'or', 'other', 'our', 'out', 'over',
    'said', 'same', 'should', 'so', 'some', 'such', 'than', 'that', 'the',
    'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
    'through', 'to', 'too', 'under', 'up', 'use', 'used', 'using', 'very',
    'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
    'why', 'will', 'with', 'would', 'you', 'your',
]);
