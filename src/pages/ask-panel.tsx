import { useEffect, useRef, useState } from 'react';
import { ask, type AnswerFailure, type AnswerResult } from '@/llm/answer';
import { getCurrentModelId } from '@/llm/get-engine';
import { findModel } from '@/llm/models';
import { makeSnippet } from '@/search/snippet';
import {
    appendMessage,
    createConversation,
    deleteConversation,
    getMessages,
    historyForModel,
    listConversations,
    renameConversation,
    titleFromQuestion,
} from '@/chat/store';
import type { ConversationRecord, MessageRecord } from '@/db/types';
import type { WorkerClient } from '@/embed/worker-client';

/**
 * The ask surface: a saved conversation, its transcript, and the evidence
 * behind every answer.
 *
 * Two rules shape this file. Nothing is ever hidden — a turn that produced no
 * written answer says why instead of rendering blank. And nothing is ever
 * dropped — conversations live in the database until the user deletes one, so
 * closing the tab costs nothing.
 */

const failureNote = (failure: AnswerFailure): string => {
    switch (failure.kind) {
        case 'model-not-loaded':
            return 'No written answer — the answering model is not loaded. Below are the passages search found; load a model to get them summarised.';
        case 'no-results':
            return 'Nothing in your library matched that question closely enough to answer from.';
        case 'generation-failed':
            return `The answering model failed on this question: ${failure.detail} The passages below are still what search found.`;
    }
};

/** An answer, flattened into the row that gets saved. */
const assistantRow = (
    conversationId: number,
    result: AnswerResult,
): Omit<MessageRecord, 'id' | 'ordinal' | 'createdAt'> => ({
    conversationId,
    role: 'assistant',
    content: result.answer,
    note: result.failure ? failureNote(result.failure) : undefined,
    subQueries: result.subQueries.length > 1 ? result.subQueries : undefined,
    evidence: result.results.slice(0, 5).map((hit) => ({
        docId: hit.docId,
        filename: hit.filename,
        snippet: makeSnippet(hit.text, result.question),
        score: hit.score,
    })),
    alternatives: result.alternatives.length ? result.alternatives : undefined,
    coach: result.coach ?? undefined,
    modelId: getCurrentModelId() ?? undefined,
});

export const AskPanel = ({
    worker,
    docCount,
}: {
    worker: WorkerClient;
    docCount: number;
    /** Changes when the loaded model changes; only here to force a re-render
     *  so the footer names the model that will actually answer. */
    modelTick?: number;
}): JSX.Element => {
    const [conversations, setConversations] = useState<ConversationRecord[]>([]);
    const [activeId, setActiveId] = useState<number | null>(null);
    const [messages, setMessages] = useState<MessageRecord[]>([]);
    const [question, setQuestion] = useState('');
    const [busy, setBusy] = useState(false);
    const [streamed, setStreamed] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<number | null>(null);
    const [renameText, setRenameText] = useState('');
    const endRef = useRef<HTMLDivElement | null>(null);

    // On open, restore the most recent conversation. A refresh should not cost
    // the user their place.
    useEffect(() => {
        void (async () => {
            const all = await listConversations();
            setConversations(all);
            const first = all[0];
            if (first?.id !== undefined) {
                setActiveId(first.id);
                setMessages(await getMessages(first.id));
            }
        })();
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages.length, streamed]);

    const openConversation = async (id: number): Promise<void> => {
        setActiveId(id);
        setError(null);
        setStreamed('');
        setMessages(await getMessages(id));
    };

    const startNewChat = (): void => {
        setActiveId(null);
        setMessages([]);
        setStreamed('');
        setError(null);
    };

    const removeConversation = async (id: number): Promise<void> => {
        await deleteConversation(id);
        const all = await listConversations();
        setConversations(all);
        if (activeId === id) startNewChat();
    };

    const run = async (text: string): Promise<void> => {
        const trimmed = text.trim();
        if (!trimmed || busy) return;

        setBusy(true);
        setError(null);
        setStreamed('');

        try {
            // A conversation is created on the first question, not before, so
            // an abandoned empty chat never clutters the list.
            let conversationId = activeId;
            if (conversationId === null) {
                conversationId = await createConversation(titleFromQuestion(trimmed));
                setActiveId(conversationId);
            }

            const priorTurns = historyForModel(messages);
            const userRow = await appendMessage({
                conversationId,
                role: 'user',
                content: trimmed,
            });
            setMessages((prior) => [...prior, userRow]);
            setQuestion('');

            // How many of the last three questions were rephrasings of this
            // one — the signal the coach uses to notice the user is circling.
            const repeatCount = messages
                .filter((m) => m.role === 'user')
                .slice(-3)
                .filter(
                    (m) =>
                        m.content.toLowerCase().slice(0, 18) === trimmed.toLowerCase().slice(0, 18),
                ).length;

            const result = await ask(trimmed, worker, {
                repeatCount,
                onToken: setStreamed,
                history: priorTurns,
            });

            const answerRow = await appendMessage(assistantRow(conversationId, result));
            setMessages((prior) => [...prior, answerRow]);
            setStreamed('');
            setConversations(await listConversations());
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
        <div className="chat-layout">
            <aside className="chat-sidebar card">
                <div className="spread">
                    <strong className="small">Chats</strong>
                    <button className="ghost small" onClick={startNewChat}>
                        + New
                    </button>
                </div>

                {conversations.length === 0 && (
                    <p className="small muted">No saved chats yet. Ask something.</p>
                )}

                <ul className="chat-list plain">
                    {conversations.map((conversation) => {
                        const id = conversation.id as number;
                        return (
                            <li key={id} className={id === activeId ? 'chat-item active' : 'chat-item'}>
                                {renaming === id ? (
                                    <form
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            void renameConversation(id, renameText).then(async () => {
                                                setRenaming(null);
                                                setConversations(await listConversations());
                                            });
                                        }}
                                    >
                                        <input
                                            type="text"
                                            value={renameText}
                                            autoFocus
                                            onChange={(event) => setRenameText(event.target.value)}
                                            onBlur={() => setRenaming(null)}
                                            aria-label="Chat name"
                                        />
                                    </form>
                                ) : (
                                    <>
                                        <button
                                            className="ghost chat-open"
                                            onClick={() => void openConversation(id)}
                                            title={conversation.title}
                                        >
                                            {conversation.title}
                                        </button>
                                        <span className="chat-actions">
                                            <button
                                                className="ghost small"
                                                title="Rename"
                                                onClick={() => {
                                                    setRenameText(conversation.title);
                                                    setRenaming(id);
                                                }}
                                            >
                                                Rename
                                            </button>
                                            <button
                                                className="ghost small"
                                                title="Delete this chat"
                                                onClick={() => {
                                                    if (
                                                        window.confirm(
                                                            `Delete "${conversation.title}"? This cannot be undone.`,
                                                        )
                                                    ) {
                                                        void removeConversation(id);
                                                    }
                                                }}
                                            >
                                                Delete
                                            </button>
                                        </span>
                                    </>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </aside>

            <div className="chat-main">
                {messages.length === 0 && !busy && (
                    <div className="card">
                        <p className="muted small" style={{ margin: 0 }}>
                            New chat. Ask a question and follow up on the answer — later
                            questions can refer back to earlier ones.
                        </p>
                    </div>
                )}

                {messages.map((message) =>
                    message.role === 'user' ? (
                        <div className="card turn-user" key={message.id}>
                            <div className="answer">{message.content}</div>
                        </div>
                    ) : (
                        <AssistantTurn key={message.id} message={message} onAsk={run} />
                    ),
                )}

                {busy && (
                    <div className="card">
                        <div className="answer">
                            {streamed || <span className="muted small">Searching…</span>}
                            {streamed && <span className="cursor">▍</span>}
                        </div>
                    </div>
                )}

                {error && (
                    <div className="card">
                        <span style={{ color: 'var(--warn)' }}>{error}</span>
                    </div>
                )}

                <div ref={endRef} />

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
                            placeholder={
                                messages.length
                                    ? 'Ask a follow-up…'
                                    : 'What does my lease say about ending it early?'
                            }
                            onChange={(event) => setQuestion(event.target.value)}
                            aria-label="Question"
                        />
                        <div className="spread">
                            <span className="small muted">
                                {(() => {
                                    const model = getCurrentModelId();
                                    const option = model ? findModel(model) : undefined;
                                    return option
                                        ? `Answers written by ${option.label}, running on this device, citing the documents they came from.`
                                        : 'No model loaded — you will get passages, not a written answer.';
                                })()}
                            </span>
                            <button
                                className="primary"
                                type="submit"
                                disabled={busy || !question.trim()}
                            >
                                {busy ? 'Working…' : 'Ask'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

/** One answer, with everything it was based on. */
const AssistantTurn = ({
    message,
    onAsk,
}: {
    message: MessageRecord;
    onAsk: (question: string) => Promise<void>;
}): JSX.Element => {
    const model = message.modelId ? findModel(message.modelId) : undefined;

    return (
        <>
            {message.content && (
                <div className="card">
                    <div className="answer">{message.content}</div>
                    {model && (
                        <div className="small muted" style={{ marginTop: 8 }}>
                            {model.label} · {model.maker}
                        </div>
                    )}
                </div>
            )}

            {message.note && (
                <div className="card">
                    <div className="small" style={{ color: 'var(--warn)' }}>
                        {message.note}
                    </div>
                </div>
            )}

            {message.subQueries && message.subQueries.length > 1 && (
                <div className="card">
                    <div className="small muted" style={{ marginBottom: 6 }}>
                        Searched as {message.subQueries.length} sub-questions
                    </div>
                    <ul className="plain small">
                        {message.subQueries.map((sub) => (
                            <li key={sub} className="mono">
                                {sub}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {message.coach && (
                <div className="card">
                    <div className="small">{message.coach.note}</div>
                    <div className="suggestions">
                        {message.coach.suggestions.map((suggestion) => (
                            <button key={suggestion} onClick={() => void onAsk(suggestion)}>
                                {suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {message.evidence && message.evidence.length > 0 && (
                <div className="card">
                    <strong className="small">Evidence</strong>
                    {message.evidence.map((hit, index) => (
                        <div className="evidence" key={`${hit.docId}-${index}`}>
                            <div className="spread">
                                <span className="small">{hit.filename}</span>
                                <span className="pill mono">{hit.score}</span>
                            </div>
                            <div className="evidence-text">{hit.snippet}</div>
                        </div>
                    ))}
                </div>
            )}

            {message.alternatives && message.alternatives.length > 0 && (
                <div className="card">
                    <div className="small muted" style={{ marginBottom: 6 }}>
                        Also close, but not used in the answer
                    </div>
                    <ul className="plain small">
                        {message.alternatives.map((alt) => (
                            <li key={alt.docId}>
                                <strong>{alt.title}</strong>
                                <div className="muted">{alt.snippet}</div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </>
    );
};
