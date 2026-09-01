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
import type { EmbeddingWorker, SearchResult } from '@/search/types';

/**
 * One question, end to end: plan, retrieve, answer, then check whether the
 * answer was actually any good.
 *
 * The order matters. Retrieval runs whether or not the language model is
 * loaded — a user who just wants to find the paragraph should never wait for a
 * gigabyte of weights — and every LLM step below is wrapped so that a failure
 * degrades to "here are the passages" instead of an error.
 */

const SYSTEM_PROMPT = `You answer questions using ONLY the excerpts provided from the user's own documents.

Rules:
- Cite the source of every claim inline, as [filename].
- If the excerpts do not contain the answer, say so plainly. Do not guess, and do not fall back on general knowledge.
- Quote exact figures, dates, names and identifiers rather than paraphrasing them.
- Be concise. Answer the question that was asked.`;

/** Below this fused score, the top hit is not real evidence. */
export const WEAK_EVIDENCE_THRESHOLD = 1.2;

export interface AnswerResult {
    answer: string;
    results: SearchResult[];
    subQueries: string[];
    alternatives: { docId: number; title: string; snippet: string }[];
    coach: CoachAdvice | null;
}

const buildContext = (results: SearchResult[]): string =>
    results
        .map((r, index) => `[${index + 1}] (${r.filename})\n${r.text}`)
        .join('\n\n');

export interface AskOptions {
    /** How many times the user has asked something similar in a row. */
    repeatCount?: number;
    onToken?: (partial: string) => void;
}

export const ask = async (
    question: string,
    worker: EmbeddingWorker,
    { repeatCount = 0, onToken }: AskOptions = {},
): Promise<AnswerResult> => {
    recordQuery(question, STOP_WORDS);

    const inventory = await buildEnrichedInventory();
    const subQueries = await decomposeQuery(
        question,
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
            snippet: r.text.slice(0, 160),
        }));

    const engine = getEngine();
    if (!engine) {
        return {
            answer: '',
            results,
            subQueries,
            alternatives,
            coach: null,
        };
    }

    if (results.length === 0) {
        recordFailedQuestion(question);
        return {
            answer: 'Nothing in your library matched that question.',
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
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'system',
                    content: formatInventoryChunk(inventory),
                },
                {
                    role: 'user',
                    content: `Excerpts from my documents:\n\n${buildContext(evidence)}\n\nQuestion: ${question}`,
                },
            ],
        });

        for await (const part of stream) {
            const token = part.choices[0]?.delta?.content ?? '';
            if (!token) continue;
            answer += token;
            onToken?.(answer);
        }
    } catch (error) {
        console.warn('[answer] generation failed, returning passages only', error);
        return { answer: '', results, subQueries, alternatives, coach: null };
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

    return { answer, results, subQueries, alternatives, coach };
};
