import { useEffect, useMemo, useRef, useState } from 'react';
import { DocumentView } from '@/pages/document-view';
import { highlight } from '@/search/highlight';
import type { MessageRecord, StoredEvidence } from '@/db/types';

/**
 * Where an answer came from, kept beside it rather than under it.
 *
 * The rule that keeps this pane usable in a long conversation: it shows ONE
 * answer's passages at a time — the newest by default, or whichever earlier
 * answer the reader clicked — so twenty questions still means one paneful.
 * The second view groups the whole conversation by document instead of by
 * passage, so its length is bounded by how many files the user owns rather
 * than by how much they have asked.
 */

export type SourceScope = 'answer' | 'chat';

export interface SourceFocus {
    /** Filename to scroll to and flash. */
    filename: string;
    /** Bumped on every click so the same citation can be followed twice. */
    nonce: number;
}

interface DocumentUse {
    filename: string;
    passages: number;
    answers: number;
}

/** Every document the conversation has drawn on, most-used first. */
const bibliography = (messages: MessageRecord[]): DocumentUse[] => {
    const byFile = new Map<string, DocumentUse>();

    for (const message of messages) {
        const seenInThisAnswer = new Set<string>();
        for (const hit of message.evidence ?? []) {
            const existing = byFile.get(hit.filename) ?? {
                filename: hit.filename,
                passages: 0,
                answers: 0,
            };
            existing.passages += 1;
            if (!seenInThisAnswer.has(hit.filename)) {
                existing.answers += 1;
                seenInThisAnswer.add(hit.filename);
            }
            byFile.set(hit.filename, existing);
        }
    }

    return [...byFile.values()].sort((a, b) => b.passages - a.passages);
};

const Passage = ({
    hit,
    question,
    innerRef,
    onOpen,
}: {
    hit: StoredEvidence;
    /** The question this passage was retrieved for, so its words can be
     *  marked — the passage alone says what was found, not why. */
    question: string;
    innerRef?: (node: HTMLDivElement | null) => void;
    /** Open the whole document this passage came from. */
    onOpen: () => void;
}): JSX.Element => (
    <div className="passage" ref={innerRef}>
        <div className="spread">
            <span className="passage-name" title={hit.filename}>
                {hit.filename}
            </span>
            <span className="pill mono">{hit.score}</span>
        </div>
        <button type="button" className="ghost passage-open" onClick={onOpen}>
            Open the document at this sentence
        </button>
        {hit.kind && (
            <div className="passage-kind">
                {hit.kind === 'whole-document'
                    ? 'whole document'
                    : hit.sections && hit.sections > 1
                      ? `${hit.sections} matched sections, each with the text either side`
                      : 'matched section, with the text either side'}
            </div>
        )}
        <div className="passage-text">
            {highlight(hit.snippet, question).map((segment, index) =>
                segment.match ? (
                    <mark key={index}>{segment.text}</mark>
                ) : (
                    <span key={index}>{segment.text}</span>
                ),
            )}
        </div>
    </div>
);

export const SourcesPane = ({
    viewing,
    question,
    allAnswers,
    scope,
    onScopeChange,
    focus,
}: {
    /** The answer whose passages are shown, or null when there is none yet. */
    viewing: MessageRecord | null;
    /** The question that answer was given to, used to mark matching words. */
    question: string;
    /** Every assistant turn in this conversation, for the bibliography. */
    allAnswers: MessageRecord[];
    scope: SourceScope;
    onScopeChange: (scope: SourceScope) => void;
    /** Set when a citation was clicked; scrolls that passage into view. */
    focus: SourceFocus | null;
}): JSX.Element => {
    const nodes = useRef(new Map<string, HTMLDivElement>());
    const documents = useMemo(() => bibliography(allAnswers), [allAnswers]);
    const passages = viewing?.evidence ?? [];
    const [open, setOpen] = useState<{ docId: number; filename: string } | null>(null);

    // A new answer, or a switch of view, closes the document: the reader is
    // now looking at different evidence.
    useEffect(() => setOpen(null), [viewing?.id, scope]);


    useEffect(() => {
        if (!focus || scope !== 'answer') return;
        const node = nodes.current.get(focus.filename);
        if (!node) return;

        node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        // Restart the highlight rather than relying on a class toggle, so
        // clicking the same citation twice flashes twice.
        node.classList.remove('flashing');
        void node.offsetWidth;
        node.classList.add('flashing');
    }, [focus, scope]);

    // Every hook above runs on every render; only the output changes here.
    if (open && viewing) {
        return (
            <aside className="sources">
                <DocumentView
                    docId={open.docId}
                    filename={open.filename}
                    answer={viewing.content}
                    question={question}
                    onClose={() => setOpen(null)}
                />
            </aside>
        );
    }

    return (
        <aside className="sources">
            <div className="sources-head">
                <span className="label">Where this came from</span>
                <span className="small muted">
                    {scope === 'answer'
                        ? `${passages.length} ${passages.length === 1 ? 'passage' : 'passages'}`
                        : `${documents.length} ${documents.length === 1 ? 'document' : 'documents'}`}
                </span>
            </div>

            <div className="sources-scope">
                <div className="seg" role="group" aria-label="Which sources to show">
                    <button
                        type="button"
                        aria-pressed={scope === 'answer'}
                        onClick={() => onScopeChange('answer')}
                    >
                        This answer
                    </button>
                    <button
                        type="button"
                        aria-pressed={scope === 'chat'}
                        onClick={() => onScopeChange('chat')}
                    >
                        Whole chat
                    </button>
                </div>
                <p className="small muted" style={{ margin: '7px 0 0' }}>
                    {scope === 'answer'
                        ? 'Click any earlier answer to see its sources.'
                        : 'Every document this conversation has drawn on.'}
                </p>
            </div>

            <div className="sources-list">
                {scope === 'answer' ? (
                    passages.length === 0 ? (
                        <p className="small muted sources-empty">
                            {viewing
                                ? 'This answer had no passages behind it.'
                                : 'Ask something and the passages behind the answer appear here.'}
                        </p>
                    ) : (
                        passages.map((hit, index) => (
                            <Passage
                                key={`${hit.docId}-${index}`}
                                hit={hit}
                                question={question}
                                innerRef={(node) => {
                                    if (node) nodes.current.set(hit.filename, node);
                                    else nodes.current.delete(hit.filename);
                                }}
                                onOpen={() => setOpen({ docId: hit.docId, filename: hit.filename })}
                            />
                        ))
                    )
                ) : documents.length === 0 ? (
                    <p className="small muted sources-empty">Nothing used yet.</p>
                ) : (
                    documents.map((doc) => (
                        <div className="passage" key={doc.filename}>
                            <div className="spread">
                                <span className="passage-name" title={doc.filename}>
                                    {doc.filename}
                                </span>
                                <span className="pill mono">{doc.passages}</span>
                            </div>
                            <div className="passage-text">
                                {doc.passages} {doc.passages === 1 ? 'passage' : 'passages'}, used
                                in {doc.answers} {doc.answers === 1 ? 'answer' : 'answers'}.
                            </div>
                        </div>
                    ))
                )}
            </div>
        </aside>
    );
};
