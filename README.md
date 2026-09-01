# Archivist

Ask questions about your own documents. Parsing, embeddings, search and the
language model all run in your browser — there is no backend, no API key, and
nothing is uploaded anywhere.

> **Design principle:** the human gets grace, the documents get authority, the
> machine gets accountability. Every answer cites the passages it came from,
> and the organizer never moves a file without a person approving the plan.

---

## Why it's built this way

**Hybrid retrieval, fused by rank.** Vector search misses exact tokens — part
numbers, dates, case references — which are usually the whole point of
searching your own files. Keyword search misses the paraphrase. Archivist runs
both and fuses their *ranks* with Reciprocal Rank Fusion rather than their
scores, which are on incomparable scales, then boosts literal phrase matches.
Per-retriever scores stay visible in the UI, because relevance you can't
inspect is relevance you can't tune.

**Multi-part questions get decomposed — and only those.** "How do the notice
period in my lease and my contract's resignation terms interact?" is two
lookups in two documents. The planner splits it, fans the sub-queries out, then
caps how many chunks any one document may contribute — which is what lets an
answer connect two files instead of drowning in the chattiest one. A question
that is *not* multi-part is searched as asked: a small model invited to decide
"is this complex?" will invent generic web queries ("resume writing tips") that
no personal library contains, and every one of those dilutes retrieval. So the
planner only runs on questions with an actual connective in them, and its
output is filtered against the question and the library before it is used.

**You choose the model, and it says which one it is.** Six models from 360
million to 7 billion parameters, each listed with its maker and the video
memory it needs. The choice is remembered, the loaded model is named in the
answer bar and recorded on every saved turn, and switching frees the old one
first. An app that claims to run entirely on your machine should be able to
tell you exactly what it is running.

**Chats are saved and never quietly dropped.** Conversations live in IndexedDB
with their evidence, follow-up questions can refer back to earlier turns, and
nothing expires, is capped, or is cleaned up in the background. A chat goes
away when you delete it, and not otherwise.

**Failure is surfaced, not swallowed.** The Search Coach watches for the three
ways local RAG fails quietly — the model refusing, the evidence being weak, the
user rephrasing the same question over and over — and responds with an honest
diagnosis plus questions the library can actually answer. Import works the same
way: every file gets a row in a report, because a scanned PDF that silently
indexes as empty is only discovered weeks later, by a search that comes up
blank.

**The organizer is a proposal, not an action.** It scans read-only, refuses to
descend into anything that is a single unit (a code project, a `node_modules`
tree, an application bundle), classifies what's left, and shows you the plan.
Phase 1 performs zero writes. When it does write, it will copy, never move, and
only after a human says yes.

---

## What it does today

| | |
|---|---|
| **Reads** | PDF, DOCX, XLSX/XLS/ODS, PPTX, plain text, Markdown, CSV/TSV, JSON, YAML, HTML, and ~18 code extensions |
| **Retrieves** | `all-MiniLM-L6-v2` embeddings (384-dim) + MiniSearch keyword index, fused with RRF; ~500-char chunks, 50-char overlap |
| **Answers** | Your pick of six models (SmolLM2 360M → Mistral 7B) via WebLLM on WebGPU, with inline `[filename]` citations |
| **Remembers chats** | Saved conversations with their evidence; follow-ups carry earlier turns into both the prompt and the search |
| **Notices** | Exact duplicates (content hash) and near-duplicates (document embedding), with a word-level diff naming what actually changed |
| **Remembers** | Per-document topic profiles, and which documents actually answer your questions |
| **Organizes** | Read-only folder scan → classification → filing plan preview |

**Not built yet:** OCR for scanned PDFs and images, audio transcription, and
organizer phase 2 (executing an approved plan). Scanned PDFs are rejected at
import with a clear message rather than indexed as empty documents.

## Running it

```bash
bun install
bun dev          # dev server
bun test         # 30 tests
bun run build    # typecheck + production build
```

The embedding model (~45MB) downloads on first use and is cached. The answering
model (~1GB) is opt-in — search and the library work without it, and the app
says so rather than hanging on a download you didn't ask for.

Requires a WebGPU-capable browser (Chrome/Edge 121+) for generated answers.

## Architecture

```
src/
  db/            Dexie/IndexedDB store — documents and embedded chunks
  embed/         Embedding worker (Transformers.js) + promise-shaped client
  parsers/       One parser per format, routed by extension
  ingestion/     Chunking, embedding, duplicate detection, import reporting
  search/        Hybrid search, RRF fusion, multi-query merge, near-dup suppression
  llm/           Lazy WebLLM engine, query planner, answer pipeline, search coach
  knowledge/     Document profiles, word-level diffs, usage memory
  organizer/     Read-only scanner and classifier
```

Vectors live on the chunk rows rather than in a separate index. At the sizes
this targets — thousands of chunks, not millions — a linear cosine scan in a
worker is fast enough, and it keeps the whole store to two tables that can be
reasoned about and exported.

## Copyright

Copyright © 2026 Farhaan Chida. All rights reserved.

This repository is published so the code can be read and evaluated. No licence
to use, copy, modify or redistribute it is granted. If you want to use any of
it, ask me.
