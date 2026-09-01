import { getEngine } from '@/llm/get-engine';
import { contentWords } from '@/search/words';

/**
 * Query planning.
 *
 * A question that genuinely spans two things — "how do my lease notice period
 * and my contract's resignation terms interact" — retrieves far better when it
 * is searched as two queries. A question that does not span two things gets
 * nothing from the exercise and quite a lot of harm: a small model asked "is
 * this complex?" will happily answer by inventing generic search queries that
 * have nothing to do with the user's files ("resume writing tips", "resume
 * templates for entry level"), and every one of those dilutes retrieval.
 *
 * So the model is only consulted when the question actually looks multi-part,
 * and whatever it produces is filtered before it is trusted.
 */

/** Connectives that signal a question is asking about more than one thing. */
const MULTI_PART_MARKERS = [
    ' and ',
    ' vs ',
    ' vs. ',
    ' versus ',
    ' compare ',
    ' compared to ',
    ' comparison ',
    'difference between',
    'differences between',
    ' both ',
    ' as well as ',
    ' along with ',
    ' relate to ',
    ' related to ',
    'relationship between',
    ' interact ',
    ' each of ',
];

/**
 * Whether a question is worth splitting. Deliberately conservative: a false
 * negative costs one merged search, a false positive costs a polluted result
 * set, and the second is much more visible to the user.
 */
export const looksMultiPart = (query: string): boolean => {
    const normalized = ` ${query.toLowerCase().replace(/\s+/g, ' ').trim()} `;

    // Two or more question marks means two or more questions.
    if ((query.match(/\?/g) ?? []).length > 1) return true;

    return MULTI_PART_MARKERS.some((marker) => normalized.includes(marker));
};

/**
 * Shapes that mean the planner has stopped searching the user's library and
 * started writing web-search queries for generic advice. These are rejected
 * unless the user's own question was asking for that kind of thing.
 */
const GENERIC_ADVICE =
    /\b(tips|examples?|templates?|best practices|how to (write|make|create|build)|for beginners|beginner|guide|checklist|ideas|advice|tutorial)\b/i;

/**
 * Keep only sub-queries that are plausibly about the same thing the user
 * asked, and are not generic advice the library cannot contain.
 *
 * Exported for testing: this filter is the difference between a planner that
 * helps and one that quietly wrecks every search.
 */
export const filterSubQueries = (
    original: string,
    candidates: string[],
    docTitles: string[] = [],
): string[] => {
    const asked = contentWords(original);
    const titleWords = contentWords(docTitles.join(' '));
    const userWantedAdvice = GENERIC_ADVICE.test(original);

    return candidates.filter((candidate) => {
        if (candidate.length < 4 || candidate.length > 200) return false;
        if (!userWantedAdvice && GENERIC_ADVICE.test(candidate)) return false;

        const words = contentWords(candidate);
        if (words.size === 0) return false;

        // On-topic means it shares a real word with the question, or names
        // something in the library.
        for (const word of words) {
            if (asked.has(word) || titleWords.has(word)) return true;
        }
        return false;
    });
};

const SYSTEM_PROMPT_DECOMPOSE = `You are a search planner for a personal document library. The user's question asks about more than one thing. Split it into the separate lookups needed to answer it.

Rules:
- Output 2 to 3 short search queries, one per line.
- Each query targets ONE thing and must make sense on its own.
- Search the user's OWN documents. Never write generic queries like "resume writing tips" or "best practices" — the library contains the user's files, not advice articles.
- Use the user's own wording where you can.
- Output ONLY the queries. No numbering, bullets, explanations or quotes.

EXAMPLES:
Question: "Compare the LW003 gateway's Bluetooth range with the M3 beacon's transmission power"
Output:
LW003 gateway Bluetooth range
M3 beacon transmission power

Question: "How do the notice period in my lease and my job contract's resignation terms interact if I move cities?"
Output:
notice period lease agreement
resignation notice period employment contract`;

/**
 * Break a genuinely multi-part question into targeted search queries.
 * Always returns at least the original query, so callers never have to
 * handle an empty plan.
 */
export const decomposeQuery = async (
    query: string,
    docTitles?: string[],
    userProfile?: string,
): Promise<string[]> => {
    if (!looksMultiPart(query)) return [query];

    const engine = getEngine();
    if (!engine) return [query];

    // Telling the planner what documents exist lets it aim one sub-query per
    // relevant document rather than guessing at topics.
    const inventoryBlock = docTitles?.length
        ? `\n\nThe user's library contains these documents:\n${docTitles.slice(0, 40).join('\n')}`
        : '';
    const profileBlock = userProfile ? `\n\nAbout this user: ${userProfile}` : '';

    try {
        const res = await engine.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: SYSTEM_PROMPT_DECOMPOSE + inventoryBlock + profileBlock,
                },
                { role: 'user', content: `Question: "${query}"\nOutput:` },
            ],
            temperature: 0,
            max_tokens: 120,
        });

        const text = res.choices?.[0]?.message?.content ?? '';
        const lines = text
            .split('\n')
            .map((l) => l.replace(/^[\s\d.\-*•"']+/, '').replace(/["']+$/, '').trim())
            .filter(Boolean);

        const kept = filterSubQueries(query, lines, docTitles ?? []);
        if (kept.length === 0) return [query];

        // The original stays first so direct matches still win, then at most
        // three sub-queries. More than that and one document's chunks crowd
        // out everything else.
        const seen = new Set<string>();
        const queries: string[] = [];
        for (const q of [query, ...kept]) {
            const key = q.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            queries.push(q);
            if (queries.length >= 4) break;
        }
        return queries;
    } catch (err) {
        console.warn('[Decompose] Failed, using original query:', err);
        return [query];
    }
};
