import { useState } from 'react';
import { ask, type AnswerResult } from '@/llm/answer';
import { isEngineLoaded } from '@/llm/get-engine';
import type { WorkerClient } from '@/embed/worker-client';

/**
 * The ask surface. Evidence is shown whether or not the model is loaded,
 * because the passages are the answer's audit trail — and on their own they
 * are often all the user needed.
 */
export const AskPanel = ({
    worker,
    docCount,
}: {
    worker: WorkerClient;
    docCount: number;
}): JSX.Element => {
    const [question, setQuestion] = useState('');
    const [busy, setBusy] = useState(false);
    const [streamed, setStreamed] = useState('');
    const [result, setResult] = useState<AnswerResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<string[]>([]);

    const run = async (text: string): Promise<void> => {
        const trimmed = text.trim();
        if (!trimmed || busy) return;

        // How many of the last three questions were rephrasings of this one —
        // the signal the coach uses to notice the user is circling.
        const repeatCount = history
            .slice(-3)
            .filter((h) => h.toLowerCase().slice(0, 18) === trimmed.toLowerCase().slice(0, 18))
            .length;

        setBusy(true);
        setError(null);
        setResult(null);
        setStreamed('');
        try {
            const answer = await ask(trimmed, worker, { repeatCount, onToken: setStreamed });
            setResult(answer);
            setHistory((prior) => [...prior, trimmed]);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    if (docCount === 0) {
        return (
            <div className="card">
                <p style={{ marginTop: 0 }}>Your library is empty.</p>
                <p className="muted small" style={{ marginBottom: 0 }}>
                    Add documents from the <strong>Library</strong> tab, then ask away.
                </p>
            </div>
        );
    }

    return (
        <>
            <form
                className="card"
                onSubmit={(event) => {
                    event.preventDefault();
                    void run(question);
                }}
            >
                <div className="stack">
                    <input
                        type="search"
                        value={question}
                        placeholder="What does my lease say about ending it early?"
                        onChange={(event) => setQuestion(event.target.value)}
                        aria-label="Question"
                    />
                    <div className="spread">
                        <span className="small muted">
                            {isEngineLoaded()
                                ? 'Answers cite the documents they came from.'
                                : 'Model not loaded — this will return passages, not an answer.'}
                        </span>
                        <button className="primary" type="submit" disabled={busy || !question.trim()}>
                            {busy ? 'Searching…' : 'Ask'}
                        </button>
                    </div>
                </div>
            </form>

            {error && (
                <div className="card">
                    <span style={{ color: 'var(--warn)' }}>{error}</span>
                </div>
            )}

            {busy && streamed && (
                <div className="card">
                    <div className="answer">
                        {streamed}
                        <span className="cursor">▍</span>
                    </div>
                </div>
            )}

            {result && (
                <>
                    {result.answer && (
                        <div className="card">
                            <div className="answer">{result.answer}</div>
                        </div>
                    )}

                    {result.subQueries.length > 1 && (
                        <div className="card">
                            <div className="small muted" style={{ marginBottom: 6 }}>
                                Searched as {result.subQueries.length} sub-questions
                            </div>
                            <ul className="plain small">
                                {result.subQueries.map((sub) => (
                                    <li key={sub} className="mono">{sub}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result.coach && (
                        <div className="card">
                            <div className="small">{result.coach.note}</div>
                            <div className="suggestions">
                                {result.coach.suggestions.map((suggestion) => (
                                    <button
                                        key={suggestion}
                                        onClick={() => {
                                            setQuestion(suggestion);
                                            void run(suggestion);
                                        }}
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {result.results.length > 0 && (
                        <div className="card">
                            <strong className="small">Evidence</strong>
                            {result.results.slice(0, 5).map((hit) => (
                                <div className="evidence" key={hit.id}>
                                    <div className="spread">
                                        <span className="small">{hit.filename}</span>
                                        <span
                                            className="pill mono"
                                            title={`vector ${hit.debug.vector} · keyword ${hit.debug.keyword}`}
                                        >
                                            {hit.score}
                                        </span>
                                    </div>
                                    <div className="evidence-text">{hit.text}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {result.alternatives.length > 0 && (
                        <div className="card">
                            <div className="small muted" style={{ marginBottom: 6 }}>
                                Also close, but not used in the answer
                            </div>
                            <ul className="plain small">
                                {result.alternatives.map((alt) => (
                                    <li key={alt.docId}>
                                        <strong>{alt.title}</strong>
                                        <div className="muted">{alt.snippet}…</div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </>
    );
};
