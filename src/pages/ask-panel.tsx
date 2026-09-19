import { useEffect, useRef, useState } from 'react';
import { ask, type AnswerFailure, type AnswerResult } from '@/llm/answer';
import {
    getCurrentModelId,
    getSelectedModelId,
    isEngineLoaded,
    loadEngine,
    onEngineProgress,
    supportsWebGpu,
} from '@/llm/get-engine';
import { findModel, formatMemory } from '@/llm/models';
import { parseCitations } from '@/search/citations';
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
import { SourcesPane, type SourceFocus, type SourceScope } from '@/pages/sources-pane';
import type { ConversationRecord, MessageRecord } from '@/db/types';
import type { WorkerClient } from '@/embed/worker-client';

/**
 * The ask surface: chats on the left, the conversation in the middle, and the
 * passages behind the answer on the right, permanently.
 *
 * Keeping the evidence beside the answer rather than under it is the whole
 * argument of this app — every claim is checkable against the user's own
 * files, at a glance rather than after a click.
 *
 * Three rules hold it together. Nothing is hidden: a turn that produced no
 * written answer says why. Nothing is dropped: conversations live in the
 * database until deleted. And the pane never accumulates: it shows one
 * answer's sources at a time, so a long conversation cannot bury them.
 */

const failureNote = (failure: AnswerFailure): string => {
    switch (failure.kind) {
        case 'model-not-loaded':
            return 'No written answer — no model is loaded. The passages beside this are still what search found.';
        case 'no-results':
            return 'Nothing in your library matched that question closely enough to answer from.';
        case 'generation-failed':
            return `The answering model failed on this question: ${failure.detail} The passages beside this are still what search found.`;
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
    // Built from what the model was given, not from the raw matches, so the
    // pane shows the passage it actually read.
    evidence: result.sources.map((source) => ({
        docId: source.docId,
        filename: source.filename,
        snippet: makeSnippet(source.text, result.question, 420),
        score: source.score,
        kind: source.kind,
    })),
    alternatives: result.alternatives.length ? result.alternatives : undefined,
    coach: result.coach ?? undefined,
    modelId: getCurrentModelId() ?? undefined,
});

/** The question immediately preceding an answer. */
const questionBefore = (
    messages: MessageRecord[],
    answer: MessageRecord | null,
): string => {
    if (!answer) return '';
    const index = messages.findIndex((m) => m.id === answer.id);
    for (let i = index - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role === 'user') return message.content;
    }
    return '';
};

const lastAnswerId = (messages: MessageRecord[]): number | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role === 'assistant' && message.id !== undefined) return message.id;
    }
    return null;
};

export const AskPanel = ({
    worker,
    docCount,
}: {
    worker: WorkerClient;
    docCount: number;
    /** Changes when the loaded model changes; only here to force a re-render
     *  so the composer names the model that will actually answer. */
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
    const [preparing, setPreparing] = useState(false);
    const [modelProgress, setModelProgress] = useState<{
        text: string;
        progress: number;
    } | null>(null);

    // Which answer the sources pane is showing, and in which of its two views.
    const [viewingId, setViewingId] = useState<number | null>(null);
    const [scope, setScope] = useState<SourceScope>('answer');
    const [focus, setFocus] = useState<SourceFocus | null>(null);

    const endRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => onEngineProgress(setModelProgress), []);

    // On open, restore the most recent conversation. A refresh should not cost
    // the user their place.
    useEffect(() => {
        void (async () => {
            const all = await listConversations();
            setConversations(all);
            const first = all[0];
            if (first?.id !== undefined) {
                const rows = await getMessages(first.id);
                setActiveId(first.id);
                setMessages(rows);
                setViewingId(lastAnswerId(rows));
            }
        })();
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages.length, streamed]);

    const answers = messages.filter((m) => m.role === 'assistant');
    const viewing = answers.find((m) => m.id === viewingId) ?? null;
    // The question the viewed answer was given to, so the pane can mark the
    // words that were asked about. Derived rather than stored, so it works
    // for conversations saved before the pane existed.
    const viewingQuestion = questionBefore(messages, viewing);

    const openConversation = async (id: number): Promise<void> => {
        const rows = await getMessages(id);
        setActiveId(id);
        setMessages(rows);
        setViewingId(lastAnswerId(rows));
        setScope('answer');
        setFocus(null);
        setError(null);
        setStreamed('');
    };

    const startNewChat = (): void => {
        setActiveId(null);
        setMessages([]);
        setViewingId(null);
        setScope('answer');
        setFocus(null);
        setStreamed('');
        setError(null);
    };

    const removeConversation = async (id: number): Promise<void> => {
        await deleteConversation(id);
        const all = await listConversations();
        setConversations(all);
        if (activeId === id) startNewChat();
    };

    /** Follow a [filename] citation to its passage in the pane. */
    const followCitation = (message: MessageRecord, filename: string): void => {
        if (message.id !== undefined) setViewingId(message.id);
        setScope('answer');
        setFocus((prior) => ({ filename, nonce: (prior?.nonce ?? 0) + 1 }));
    };

    const run = async (text: string): Promise<void> => {
        const trimmed = text.trim();
        if (!trimmed || busy) return;

        setBusy(true);
        setError(null);
        setStreamed('');

        try {
            // Asking a question is the point at which someone has said they
            // want a written answer, so it is the point at which the model is
            // worth fetching — not on page load, which would make everyone who
            // only wanted to search pay for a download they never asked for.
            if (!isEngineLoaded() && supportsWebGpu()) {
                setPreparing(true);
                try {
                    await loadEngine();
                } catch {
                    // Left to the normal failure path: the turn will report
                    // that no model is loaded and show the passages instead.
                } finally {
                    setPreparing(false);
                    setModelProgress(null);
                }
            }

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
            // A new answer takes the pane, otherwise the reader would be
            // looking at fresh prose beside an old answer's sources.
            setViewingId(answerRow.id ?? null);
            setScope('answer');
            setFocus(null);
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
            <div className="centered">
                <div className="card">
                    <p style={{ marginTop: 0 }}>Your library is empty.</p>
                    <p className="muted small" style={{ marginBottom: 0 }}>
                        Add documents from the <strong>Library</strong> tab, then ask away.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="ask-grid">
            <aside className="chat-rail">
                <div className="spread rail-head">
                    <span className="label">Chats</span>
                    <button className="ghost small" onClick={startNewChat}>
                        + New
                    </button>
                </div>

                {conversations.length === 0 && (
                    <p className="small muted" style={{ padding: '0 8px' }}>
                        No saved chats yet.
                    </p>
                )}

                <ul className="chat-list plain">
                    {conversations.map((conversation) => {
                        const id = conversation.id as number;
                        return (
                            <li
                                key={id}
                                className={id === activeId ? 'chat-item active' : 'chat-item'}
                            >
                                {renaming === id ? (
                                    <form
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            void renameConversation(id, renameText).then(
                                                async () => {
                                                    setRenaming(null);
                                                    setConversations(await listConversations());
                                                },
                                            );
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

            <div className="convo">
                <div className="transcript">
                    {messages.length === 0 && !busy && (
                        <p className="muted small">
                            Ask a question about your documents. Follow-ups can refer back to
                            earlier answers, and everything you ask is saved.
                        </p>
                    )}

                    {messages.map((message) =>
                        message.role === 'user' ? (
                            <div className="turn-question" key={message.id}>
                                <span className="label">You asked</span>
                                <div>{message.content}</div>
                            </div>
                        ) : (
                            <AssistantTurn
                                key={message.id}
                                message={message}
                                viewing={message.id === viewingId}
                                onView={() => {
                                    if (message.id !== undefined) setViewingId(message.id);
                                    setScope('answer');
                                }}
                                onCitation={(filename) => followCitation(message, filename)}
                                onAsk={run}
                            />
                        ),
                    )}

                    {preparing && (
                        <div className="notice">
                            <div className="small">
                                Getting the answering model ready
                                {(() => {
                                    const model = findModel(getSelectedModelId());
                                    return model
                                        ? ` — ${model.label}, ${formatMemory(model.memoryMb)}.`
                                        : '.';
                                })()}{' '}
                                <span className="muted">
                                    This happens once; after that it is kept in this browser.
                                </span>
                            </div>
                            {modelProgress && (
                                <>
                                    <div className="progress" style={{ marginTop: 8 }}>
                                        <div
                                            style={{
                                                width: `${Math.round(
                                                    modelProgress.progress * 100,
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="small muted mono">{modelProgress.text}</span>
                                </>
                            )}
                        </div>
                    )}

                    {busy && !preparing && (
                        <div className="turn-answer">
                            <div className="answer">
                                {streamed || <span className="muted small">Searching…</span>}
                                {streamed && <span className="cursor">▍</span>}
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="notice warn">
                            <span className="small">{error}</span>
                        </div>
                    )}

                    <div ref={endRef} />
                </div>

                <form
                    className="composer"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void run(question);
                    }}
                >
                    <div className="row">
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
                        <button
                            className="primary"
                            type="submit"
                            disabled={busy || !question.trim()}
                        >
                            {busy ? 'Working…' : 'Ask'}
                        </button>
                    </div>
                    <div className="small muted composer-foot">
                        {(() => {
                            const running = getCurrentModelId();
                            const option = running ? findModel(running) : undefined;
                            if (option) {
                                return `Answers written by ${option.label} on this device, citing the documents they came from.`;
                            }
                            const willLoad = findModel(getSelectedModelId());
                            return willLoad
                                ? `Your first question will fetch ${willLoad.label} (${formatMemory(
                                      willLoad.memoryMb,
                                  )}), once.`
                                : 'Answers cite the documents they came from.';
                        })()}
                    </div>
                </form>
            </div>

            <SourcesPane
                viewing={viewing}
                question={viewingQuestion}
                allAnswers={answers}
                scope={scope}
                onScopeChange={setScope}
                focus={focus}
            />
        </div>
    );
};

/** One answer, with the controls that point at its evidence. */
const AssistantTurn = ({
    message,
    viewing,
    onView,
    onCitation,
    onAsk,
}: {
    message: MessageRecord;
    viewing: boolean;
    onView: () => void;
    onCitation: (filename: string) => void;
    onAsk: (question: string) => Promise<void>;
}): JSX.Element => {
    const model = message.modelId ? findModel(message.modelId) : undefined;
    const filenames = (message.evidence ?? []).map((hit) => hit.filename);
    const segments = parseCitations(message.content, filenames);
    const passageCount = message.evidence?.length ?? 0;

    return (
        <div
            className={viewing ? 'turn-answer viewing' : 'turn-answer'}
            onClick={onView}
            role="presentation"
        >
            {message.content && (
                <div className="answer">
                    {segments.map((segment, index) =>
                        segment.kind === 'citation' ? (
                            <button
                                key={index}
                                className="citation"
                                title={`Show the passage from ${segment.filename}`}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onCitation(segment.filename);
                                }}
                            >
                                {segment.text}
                            </button>
                        ) : (
                            <span key={index}>{segment.text}</span>
                        ),
                    )}
                </div>
            )}

            {message.note && <div className="notice warn small">{message.note}</div>}

            {message.subQueries && message.subQueries.length > 1 && (
                <details className="aside-block">
                    <summary className="small muted">
                        Searched as {message.subQueries.length} sub-questions
                    </summary>
                    <ul className="plain small">
                        {message.subQueries.map((sub) => (
                            <li key={sub} className="mono">
                                {sub}
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            {message.coach && (
                <div className="aside-block">
                    <div className="small">{message.coach.note}</div>
                    <div className="suggestions">
                        {message.coach.suggestions.map((suggestion) => (
                            <button
                                key={suggestion}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void onAsk(suggestion);
                                }}
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {message.alternatives && message.alternatives.length > 0 && (
                <details className="aside-block">
                    <summary className="small muted">
                        Also close, but not used in this answer
                    </summary>
                    <ul className="plain small">
                        {message.alternatives.map((alt) => (
                            <li key={alt.docId}>
                                <strong>{alt.title}</strong>
                                <div className="muted">{alt.snippet}</div>
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            {(model || passageCount > 0) && (
                <div className="turn-foot small muted">
                    {model ? `${model.label} · ${model.maker}` : ''}
                    {model && passageCount > 0 ? ' · ' : ''}
                    {passageCount > 0
                        ? `${passageCount} ${passageCount === 1 ? 'passage' : 'passages'}`
                        : ''}
                </div>
            )}
        </div>
    );
};
