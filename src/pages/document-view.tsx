import { useEffect, useRef, useState } from 'react';
import { db } from '@/db/get-db';
import { ensureDbOpen } from '@/db/ensure-db-open';
import { highlight } from '@/search/highlight';
import { findSupportingSentence, type TextRange } from '@/search/locate';

/**
 * The whole document, opened from a passage.
 *
 * A passage under an answer is a preview. This is the thing itself: every
 * word Archivist read from the file, scrolled to the sentence the answer
 * rests on, with that sentence marked so a person can read the words around
 * it and decide for themselves whether the answer holds. There is no window
 * to fall out of, because there is no window.
 *
 * Two kinds of mark: the supporting sentence (one block, the colour of the
 * answer) and the question's words (small, the colour search uses), so "why
 * this document" and "where the answer came from" are both visible at once.
 */

interface Loaded {
    text: string;
    readAsScan: boolean;
    support: TextRange | null;
}

const Paragraph = ({
    text,
    offset,
    question,
    support,
    supportRef,
}: {
    text: string;
    /** Where this paragraph starts in the full text. */
    offset: number;
    question: string;
    support: TextRange | null;
    supportRef: (node: HTMLElement | null) => void;
}): JSX.Element => {
    const end = offset + text.length;
    const overlaps = support && support.start < end && support.end > offset;

    if (!overlaps || !support) {
        return <p>{mark(text, question)}</p>;
    }

    const from = Math.max(0, support.start - offset);
    const to = Math.min(text.length, support.end - offset);
    return (
        <p>
            {mark(text.slice(0, from), question)}
            <mark className="supporting" ref={supportRef}>
                {mark(text.slice(from, to), question)}
            </mark>
            {mark(text.slice(to), question)}
        </p>
    );
};

const mark = (text: string, question: string): JSX.Element[] =>
    highlight(text, question).map((segment, index) =>
        segment.match ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>,
    );

/** Paragraphs with their offsets into the full text, so a range found in the
 *  full text can be placed inside the paragraph that holds it. */
const paragraphs = (text: string): { text: string; offset: number }[] => {
    const out: { text: string; offset: number }[] = [];
    const pattern = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
        out.push({ text: match[0], offset: match.index });
    }
    return out;
};

export const DocumentView = ({
    docId,
    filename,
    answer,
    question,
    onClose,
}: {
    docId: number;
    filename: string;
    /** The answer being checked. Empty when there was no written answer. */
    answer: string;
    question: string;
    onClose: () => void;
}): JSX.Element => {
    const [loaded, setLoaded] = useState<Loaded | null | 'missing'>(null);
    const supportNode = useRef<HTMLElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            await ensureDbOpen();
            const doc = await db.documents.get(docId);
            if (cancelled) return;
            if (!doc) {
                setLoaded('missing');
                return;
            }
            setLoaded({
                text: doc.fullText,
                readAsScan: Boolean(doc.readAsScan),
                support: findSupportingSentence(doc.fullText, answer, question),
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [docId, answer, question]);

    useEffect(() => {
        if (loaded && loaded !== 'missing' && supportNode.current) {
            supportNode.current.scrollIntoView({ block: 'center' });
        }
    }, [loaded]);

    return (
        <div className="document-view">
            <div className="document-head">
                <button type="button" className="ghost" onClick={onClose}>
                    ← Back to passages
                </button>
                <div className="document-title" title={filename}>
                    {filename}
                </div>
                {loaded && loaded !== 'missing' && (
                    <div className="small muted">
                        {loaded.support
                            ? answer
                                ? 'The highlighted sentence is the one the answer rests on. Read around it.'
                                : 'Highlighted: the sentence that best matches your question.'
                            : answer
                              ? 'No sentence here clearly matches the answer — worth reading with care.'
                              : 'Nothing here matches your question closely.'}
                        {loaded.readAsScan && ' This was read from a scan, so the odd word may be wrong.'}
                    </div>
                )}
            </div>
            <div className="document-body">
                {loaded === null && <p className="small muted">Opening…</p>}
                {loaded === 'missing' && (
                    <p className="small muted">This document is no longer in your library.</p>
                )}
                {loaded && loaded !== 'missing' &&
                    paragraphs(loaded.text).map((paragraph) => (
                        <Paragraph
                            key={paragraph.offset}
                            text={paragraph.text}
                            offset={paragraph.offset}
                            question={question}
                            support={loaded.support}
                            supportRef={(node) => {
                                if (node) supportNode.current = node;
                            }}
                        />
                    ))}
            </div>
        </div>
    );
};
