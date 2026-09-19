import { getEngine } from '@/llm/get-engine';

/**
 * Search coach: notices when a chat turn probably didn't get the user what
 * they wanted, diagnoses why, and proposes better questions the library can
 * actually answer. Helps both sides — the user stops guessing, and the chat
 * stops failing silently.
 */

export interface CoachAdvice {
    /** Honest one-line diagnosis shown to the user */
    note: string;
    /** Alternative questions, clickable in the UI */
    suggestions: string[];
}

/**
 * Phrases a model uses when it is giving up.
 *
 * The first version matched a short list of exact strings and missed "I cannot
 * provide a direct answer" — so a turn that failed with the answer visible in
 * the evidence beside it got no help at all. These are anchored on the model
 * talking about itself ("I cannot…", "I don't have…") or about the excerpts,
 * which keeps them from firing on a real answer that happens to contain the
 * word "cannot": "you cannot end the lease early" is an answer, not a refusal.
 */
const REFUSAL_PATTERNS: RegExp[] = [
    /\bi (?:cannot|can'?t|am unable to|was unable to)\b[^.]{0,40}\b(?:answer|provide|determine|find|tell|say|confirm|locate|extract)\b/i,
    /\bi (?:do not|don'?t) (?:have|see|find)\b[^.]{0,40}\b(?:information|details|answer|evidence|mention)\b/i,
    /\b(?:excerpts?|passages?|documents?|context|library)\b[^.]{0,30}\b(?:do(?:es)? not|don'?t) (?:contain|include|mention|specify|provide)\b/i,
    /\bnot (?:contain|mentioned|specified|stated|provided|included) (?:in|within) (?:the )?(?:excerpts?|passages?|documents?|context)\b/i,
    /\bnothing in (?:the )?(?:excerpts?|passages?|documents?|context|library|provided)\b/i,
    /\b(?:no|insufficient|not enough) (?:relevant )?information\b/i,
    /\bunable to (?:answer|determine|provide|find)\b/i,
    /\bcannot answer\b|\bcan'?t answer\b/i,
];

/** Detects "I couldn't answer" style responses from the model. */
export const looksLikeRefusal = (answer: string): boolean =>
    REFUSAL_PATTERNS.some((pattern) => pattern.test(answer));

const SYSTEM_PROMPT_COACH = `You help a user search their personal document library. Their last question did not get a good answer.
Given their question and excerpts of what the search engine DID find, suggest up to 3 alternative questions that the library can very likely answer, related to what the user seems to want.
Rules:
- Each suggestion must be answerable from the excerpts shown.
- Keep each under 12 words, phrased as a direct question.
- Output ONLY the questions, one per line. No numbering, bullets, or commentary.
- If the excerpts are completely unrelated to what the user wants, output nothing.`;

export const suggestBetterQuestions = async (
    question: string,
    evidence: { title: string; snippet: string }[]
): Promise<string[]> => {
    const engine = getEngine();
    if (!engine || evidence.length === 0) return [];

    const evidenceBlock = evidence
        .slice(0, 8)
        .map((e) => `[${e.title}] ${e.snippet}`)
        .join('\n');

    try {
        const res = await engine.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT_COACH },
                {
                    role: 'user',
                    content: `User's question that failed: "${question}"\n\nWhat the search engine found:\n${evidenceBlock}\n\nSuggested questions:`
                }
            ],
            temperature: 0.2,
            max_tokens: 120
        });
        const text = res.choices?.[0]?.message?.content ?? '';
        return text
            .split('\n')
            .map((l) => l.replace(/^[\s\d.\-*•"']+/, '').replace(/["']+$/, '').trim())
            .filter((l) => l.length >= 8 && l.length <= 120 && l.includes(' '))
            .slice(0, 3);
    } catch (err) {
        console.warn('[Coach] Suggestion generation failed:', err);
        return [];
    }
};

/**
 * Build coach advice for a finished turn, or null when the turn looks fine.
 *
 * @param answer        the model's final answer text
 * @param topScore      best retrieval score of the evidence used
 * @param weakThreshold below this the library likely doesn't contain the answer
 * @param repeatCount   how many times in a row the user asked near-identical questions
 */
export const coachTurn = async (
    question: string,
    answer: string,
    topScore: number,
    evidence: { title: string; snippet: string }[],
    repeatCount: number,
    weakThreshold: number
): Promise<CoachAdvice | null> => {
    const refusal = looksLikeRefusal(answer);
    const weak = topScore < weakThreshold;
    const circling = repeatCount >= 2;

    if (!refusal && !weak && !circling) return null;

    if (weak) {
        // Honest: it's probably just not in the library.
        const closest = evidence.slice(0, 3).map((e) => e.title);
        return {
            note:
                "Your documents probably don't contain this — nothing matched strongly." +
                (closest.length ? ` Closest topics found: ${[...new Set(closest)].join(', ')}.` : ''),
            suggestions: await suggestBetterQuestions(question, evidence),
        };
    }

    // Evidence is decent but the answer failed or the user keeps rephrasing:
    // the question probably needs to be aimed differently.
    const suggestions = await suggestBetterQuestions(question, evidence);
    return {
        note: circling
            ? "We've circled this a few times. Based on what's actually in your documents, one of these might get you there:"
            : 'The documents seem related but the question didn\'t land. Try one of these:',
        suggestions,
    };
};
