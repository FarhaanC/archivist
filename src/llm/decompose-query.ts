import { getEngine } from '@/llm/get-engine';

const SYSTEM_PROMPT_DECOMPOSE = `You are a search planner. Given a user's question, decide if answering it well requires looking up MULTIPLE distinct pieces of information (e.g. comparisons, "how does X relate to Y", questions spanning several topics or documents).

If YES: output 2-6 simple, self-contained search queries, one per line. Each query must target ONE specific piece of information and make sense on its own.
If NO (the question is already simple and focused): output exactly the original question, unchanged.

Output ONLY the queries, one per line. No numbering, bullets, explanations, or quotes.

EXAMPLES:
Question: "What is the Bluetooth scan duration?"
Output:
What is the Bluetooth scan duration?

Question: "Compare the LW003 gateway's Bluetooth range with the M3 beacon's transmission power"
Output:
LW003 gateway Bluetooth range
M3 beacon transmission power

Question: "How do the notice period in my lease and my job contract's resignation terms interact if I move cities?"
Output:
notice period lease agreement
resignation notice period employment contract`;

/**
 * Uses the loaded LLM to break a complex question into multiple targeted
 * search queries, so retrieval can pull evidence from different documents.
 * Returns [originalQuery] when the question is simple, the engine is missing,
 * or anything fails — callers can rely on always getting at least one query.
 */
export const decomposeQuery = async (
    query: string,
    docTitles?: string[],
    userProfile?: string
): Promise<string[]> => {
    const engine = getEngine();
    if (!engine) return [query];

    // Telling the planner what documents exist lets it generate one targeted
    // sub-query per relevant document (e.g. per product spec sheet).
    const inventoryBlock = docTitles?.length
        ? `\n\nThe user's library contains these documents:\n${docTitles.slice(0, 40).join('\n')}`
        : '';
    // Usage memory: what this user tends to ask about helps disambiguate
    // vague questions toward their actual interests.
    const profileBlock = userProfile ? `\n\nAbout this user: ${userProfile}` : '';

    try {
        const res = await engine.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT_DECOMPOSE + inventoryBlock + profileBlock },
                { role: 'user', content: `Question: "${query}"\nOutput:` }
            ],
            temperature: 0,
            max_tokens: 160
        });

        const text = res.choices?.[0]?.message?.content ?? '';
        const lines = text
            .split('\n')
            .map((l) => l.replace(/^[\s\d.\-*•"']+/, '').replace(/["']+$/, '').trim())
            .filter((l) => l.length >= 4 && l.length <= 200);

        if (lines.length <= 1) return [query];

        // Keep the original question in the mix so direct matches still win,
        // then the sub-queries. Dedupe, cap at 4 total searches.
        const seen = new Set<string>();
        const queries: string[] = [];
        for (const q of [query, ...lines]) {
            const key = q.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                queries.push(q);
            }
            if (queries.length >= 6) break;
        }
        return queries;
    } catch (err) {
        console.warn('[Decompose] Failed, using original query:', err);
        return [query];
    }
};
