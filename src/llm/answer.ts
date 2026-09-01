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

const SYSTEM_PROMPT = `You answer questions using ONLY the excerpts provided from the user's own documents.

Rules:
- Cite the source of every claim inline, as [filename].
- If the excerpts do not contain the answer, say so plainly. Do not guess, and do not fall back on general knowledge.
- Quote exact figures, dates, names and identifiers rather than paraphrasing them.
- Be concise. Answer the question that was asked.`;

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
 * What to actually search for.
 *
 * A follow-up like "and what about the 2024 one?" is meaningless to a search
 * index on its own — it has almost no words that name anything. When the
 * question is that short and there is a previous question to lean on, the two
 * are searched together. The model still sees the follow-up as asked; only
 * retrieval gets the expanded form.
 */
/** Below this many meaningful words, a question cannot stand on its own as a
 *  search query. Three is the smallest number that leaves normal short
 *  questions ("what does my lease say about subletting") untouched. */
const SELF_CONTAINED_WORDS = 3;

export const retrievalQuery = (question: string, history: PriorTurn[] = []): string => {
    if (contentWordList(question).length >= SELF_CONTAINED_WORDS) return question;

    const previousQuestion = [...history].reverse().find((turn) => turn.role === 'user');
    if (!previousQuestion) return question;

    return `${previousQuestion.content} ${question}`;
};

const buildContext = (results: SearchResult[]): string =>
    results
        .map((r, index) => `[${index + 1}] (${r.filename})\n${r.text}`)
        .join('\n\n');

/**
 * The exact message list sent to the model.
 *
 * Exported and pure so its shape can be asserted in tests. That matters:
 * WebLLM rejects a request outright if a `system` message appears anywhere
 * but index 0, and this pipeline previously sent two system messages — the
 * prompt and the library inventory — which meant every single answer failed
 * before a token was generated. The inventory is now folded into the one
 * system message.
 */
export const buildMessages = (
    question: string,
    evidence: SearchResult[],
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
    const searchFor = retrievalQuery(question, history);
    const subQueries = await decomposeQuery(
        searchFor,
        inventory.map((line) => line.title),
        getUserProfileSummary(),
    );

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
            snippet: makeSnippet(r.text, searchFor, 160),
        }));

    const engine = getEngine();
    if (!engine) {
        return {
            question,
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
            answer: '',
            failure: { kind: 'no-results' },
            results,
            subQueries,
            alternatives,
            coach: await coachTurn(question, '', 0, [], repeatCount, WEAK_EVIDENCE_THRESHOLD),
        };
    }

    const evidence = results.slice(0, 5);
    let answer = '';

    try {
        const stream = await engine.chat.completions.create({
            stream: true,
            temperature: 0.2,
            messages: buildMessages(
                question,
                evidence,
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
            answer: '',
            failure: { kind: 'generation-failed', detail: 'The model returned an empty response.' },
            results,
            subQueries,
            alternatives,
            coach: null,
        };
    }

    recordEvidenceDocs(evidence.map((r) => r.filename));

    const topScore = Number.parseFloat(evidence[0]?.score ?? '0');
    const coach = await coachTurn(
        question,
        answer,
        topScore,
        evidence.map((r) => ({ title: r.filename, snippet: r.text.slice(0, 200) })),
        repeatCount,
        WEAK_EVIDENCE_THRESHOLD,
    );
    if (coach) recordFailedQuestion(question);

    return { question, answer, failure: null, results, subQueries, alternatives, coach };
};
