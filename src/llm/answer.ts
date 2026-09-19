import { getEngine } from '@/llm/get-engine';
import { decomposeQuery } from '@/llm/decompose-query';
import { coachTurn, type CoachAdvice } from '@/llm/search-coach';
import { searchMulti } from '@/search/multi-search';
import { dedupeSimilarResults } from '@/search/dedupe-results';
import { buildEnrichedInventory, formatInventoryChunk } from '@/knowledge/doc-profile';
import {
    getUserProfileSummary,
    recordEvidenceDocs,
    recordFailedQuestion,
    recordQuery,
} from '@/knowledge/usage-memory';
import { STOP_WORDS } from '@/search/constants';
import { buildSources, type ContextSource } from '@/search/context';
import { makeSnippet } from '@/search/snippet';
import { contentWordList } from '@/search/words';
import type { EmbeddingWorker, SearchResult } from '@/search/types';

/**
 * One question, end to end: plan, retrieve, answer, then check whether the
 * answer was actually any good.
 *
 * The order matters. Retrieval runs whether or not the language model is
 * loaded — a user who just wants to find the paragraph should never wait for a
 * gigabyte of weights — and every LLM step below degrades to "here are the
 * passages" instead of an error. Degrading is not the same as going quiet:
 * every path that produces no answer says why, in `failure`.
 */

const SYSTEM_PROMPT = `You answer questions from excerpts of the user's own documents — CVs, contracts, notes. The excerpts are often fragments rather than prose: headings, bullet points, a date sitting beside a job title. Read them as facts and report them.

Write a direct answer in your own plain sentences. Put [filename] after each fact, using the filename exactly as given.

Use only what the excerpts say. Do not add general knowledge. Do not move a name, employer or date from one excerpt onto something in another. Do not say what the user has not done — you are shown a few passages, not whole documents.

Earlier turns show what the question refers to; the facts must still come from the excerpts below.

If the excerpts genuinely do not answer the question, say which part is missing.`;

/** Below this fused score, the top hit is not real evidence. */
export const WEAK_EVIDENCE_THRESHOLD = 1.2;

/** Why no answer was produced. `null` when there is an answer. */
export type AnswerFailure =
    | { kind: 'model-not-loaded' }
    | { kind: 'no-results' }
    | { kind: 'generation-failed'; detail: string };

export interface AnswerResult {
    /** The question as asked, kept so evidence can be highlighted against it. */
    question: string;
    /** What the model was actually given — matched pieces expanded with their
     *  neighbours, or whole documents where they are short enough. Shown to
     *  the user too: what it read and what you see must be the same thing. */
    sources: ContextSource[];
    answer: string;
    failure: AnswerFailure | null;
    results: SearchResult[];
    subQueries: string[];
    alternatives: { docId: number; title: string; snippet: string }[];
    coach: CoachAdvice | null;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** A prior turn, as the model should see it. */
export interface PriorTurn {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * Below this many meaningful words, a question is treated as possibly leaning
 * on the one before it. Follow-ups are short by nature — "which of those is
 * longer" carries two meaningful words, "the freelance version" two — while a
 * question that names its own subject usually carries five or more.
 */
export const SELF_CONTAINED_WORDS = 5;

/**
 * What to actually search for.
 *
 * A follow-up rarely repeats its subject. "And the other one?", "what about
 * the freelance version", "which of those is longer", "the 2024 one" — none
 * of them name a document, so searching them alone finds nothing useful.
 *
 * The first attempt at this looked for particular words, which only ever
 * covers the phrasings you thought of. Instead: whenever a question is short
 * enough that it might be leaning on the previous one, search BOTH — the
 * question as typed, and the previous question with this one appended. The
 * two result sets are merged and ranked together, so a question that stands
 * on its own still wins on its own terms, and one that does not gets rescued.
 * No list of follow-up words to keep up to date.
 */
export const retrievalQueries = (question: string, history: PriorTurn[] = []): string[] => {
    const previous = [...history].reverse().find((turn) => turn.role === 'user')?.content;
    if (!previous) return [question];

    // A long question carries its own subject; adding the previous one would
    // only dilute it.
    if (contentWordList(question).length >= SELF_CONTAINED_WORDS) return [question];

    return [question, `${previous} ${question}`];
};

const buildContext = (sources: ContextSource[]): string =>
    sources.map((s) => `From [${s.filename}]:\n${s.text}`).join('\n\n');

export const buildMessages = (
    question: string,
    evidence: ContextSource[],
    inventoryText: string,
    history: PriorTurn[] = [],
): ChatMessage[] => [
    {
        role: 'system',
        content: `${SYSTEM_PROMPT}\n\n${inventoryText}`,
    },
    // Earlier turns, so "what about the other one?" means something. Trimmed
    // by the caller: the context window has to leave room for the evidence.
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    {
        role: 'user',
        content: `Excerpts from my documents:\n\n${buildContext(evidence)}\n\nQuestion: ${question}`,
    },
];

/**
 * What actually gets searched.
 *
 * The planner is only ever asked about the question as the user typed it,
 * never about an expanded form: expanding "?" into "What is in my resumes ? ?"
 * gave it two question marks, which the multi-part test read as two questions,
 * and a bare "?" was fanned out into four unrelated searches.
 *
 * A real plan wins. Otherwise every retrieval query goes through.
 */
export const chooseQueries = (planned: string[], fallbacks: string[]): string[] =>
    planned.length > 1 ? planned : fallbacks;

export interface AskOptions {
    /** How many times the user has asked something similar in a row. */
    repeatCount?: number;
    onToken?: (partial: string) => void;
    /** Earlier turns of this conversation, oldest first. */
    history?: PriorTurn[];
}

export const ask = async (
    question: string,
    worker: EmbeddingWorker,
    { repeatCount = 0, onToken, history = [] }: AskOptions = {},
): Promise<AnswerResult> => {
    recordQuery(question, STOP_WORDS);

    const inventory = await buildEnrichedInventory();
    const queries = retrievalQueries(question, history);
    // A question short enough to need the previous one is too short to split.
    // Both exist for the same reason — it does not stand alone — and running
    // them together fans a bare follow-up into unrelated searches.
    const planned =
        queries.length === 1
            ? await decomposeQuery(
                  question,
                  inventory.map((line) => line.title),
                  getUserProfileSummary(),
              )
            : [question];
    const subQueries = chooseQueries(planned, queries);

    const retrieved = await searchMulti(subQueries, worker);
    const results = dedupeSimilarResults(retrieved);

    // Documents that scored well but did not make the evidence cut, offered
    // back to the user as "did you mean this one?" rather than discarded.
    const usedDocIds = new Set(results.slice(0, 5).map((r) => r.docId));
    const alternatives = results
        .filter((r) => !usedDocIds.has(r.docId))
        .slice(0, 3)
        .map((r) => ({
            docId: r.docId,
            title: r.filename,
            snippet: makeSnippet(r.text, question, 160),
        }));

    // Assembled before the model is consulted, so every path — including the
    // ones that produce no answer — can report the same passages.
    const sources = await buildSources(results);

    const engine = getEngine();
    if (!engine) {
        return {
            question,
            sources,
            answer: '',
            failure: { kind: 'model-not-loaded' },
            results,
            subQueries,
            alternatives,
            coach: null,
        };
    }

    if (results.length === 0) {
        recordFailedQuestion(question);
        return {
            question,
            sources,
            answer: '',
            failure: { kind: 'no-results' },
            results,
            subQueries,
            alternatives,
            coach: await coachTurn(question, '', 0, [], repeatCount, WEAK_EVIDENCE_THRESHOLD),
        };
    }

    let answer = '';

    try {
        const stream = await engine.chat.completions.create({
            stream: true,
            temperature: 0.2,
            messages: buildMessages(
                question,
                sources,
                formatInventoryChunk(inventory),
                history,
            ),
        });

        for await (const part of stream) {
            const token = part.choices[0]?.delta?.content ?? '';
            if (!token) continue;
            answer += token;
            onToken?.(answer);
        }
    } catch (error) {
        // Surfaced, not swallowed. A generation failure that shows the user an
        // empty panel is indistinguishable from a broken app.
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[answer] generation failed', error);
        return {
            question,
            sources,
            answer: '',
            failure: { kind: 'generation-failed', detail },
            results,
            subQueries,
            alternatives,
            coach: null,
        };
    }

    if (!answer.trim()) {
        return {
            question,
            sources,
            answer: '',
            failure: { kind: 'generation-failed', detail: 'The model returned an empty response.' },
            results,
            subQueries,
            alternatives,
            coach: null,
        };
    }

    recordEvidenceDocs(sources.map((s) => s.filename));

    const topScore = Number.parseFloat(sources[0]?.score ?? '0');
    const coach = await coachTurn(
        question,
        answer,
        topScore,
        sources.map((s) => ({ title: s.filename, snippet: s.text.slice(0, 200) })),
        repeatCount,
        WEAK_EVIDENCE_THRESHOLD,
    );
    if (coach) recordFailedQuestion(question);

    return { question, sources, answer, failure: null, results, subQueries, alternatives, coach };
};
