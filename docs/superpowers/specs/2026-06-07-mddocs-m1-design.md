# mddocs — Milestone 1 Design Spec

**Date:** 2026-06-07
**Status:** Approved for planning
**Name:** `mddocs` (placeholder — final name TBD before public release; cannot be "Proof", which is trademarked)

> One-line: a local-first, git-native "Google Docs for markdown" with comment threads, suggestion mode, provenance, and edit history — built on the MIT-licensed [`proof-sdk`](https://github.com/EveryInc/proof-sdk).

---

## 1. Background & Motivation

The reference product is [proofeditor.ai](https://proofeditor.ai/) — an agent-first collaborative markdown editor (humans + AI agents co-edit specs/PRDs/plans, with comments, suggestions, provenance, and live presence). Its open-source SDK, `proof-sdk` (MIT), already provides a self-hostable, server-based version of this.

**`proof-sdk` already satisfies "open-source, self-hostable Proof."** What it does *not* provide — and what this project adds — is:

- **Local-first**: plain `.md` files on disk are the unit of work and the source of truth.
- **Git-native**: history, sync, and multiplayer happen through ordinary `git` (commit / push / pull). No server required.
- **CLI-first**: every operation is reachable from a terminal, so AI coding agents and scripts can drive it.

The defensible differentiator is therefore **"local-first, git-native Proof with a CLI,"** not "self-hostable Proof."

### Build strategy (decided)

Build **on** `proof-sdk` rather than from scratch. The CRDT, the unified marks model, the fuzzy anchoring engine, the editor UI, and (for later milestones) the realtime server and agent bridge are already implemented and MIT-licensed. We reuse them and focus 100% of effort on the git/local-first/CLI layer that `proof-sdk` lacks.

### Milestone roadmap

| Milestone | Scope | Built on |
|---|---|---|
| **M1 (this spec)** | Local-first editor + comments + suggestions + provenance + git history. No server, no live cursors. | `@proof/core`, `@proof/editor` |
| M2 (later) | Self-hosted server + shareable links + live presence/cursors. | `@proof/server` (+ git-backed store, needs upstream DI refactor) |
| M3 (later) | Agent API (agents open a doc by link/path and suggest edits). | `@proof/agent-bridge` |

This spec covers **M1 only**.

---

## 2. Findings from the proof-sdk spike

Verified by reading the repo at tag/main on 2026-06-07. Signatures quoted are real.

### 2.1 The hard logic is a reusable library (`@proof/core`, package `doc-core`)

All collaboration semantics are exposed as pure functions over a unified `Mark` model — **no server needed to use them**:

- **Model:** `Mark { id; kind: 'authored'|'approved'|'flagged'|'comment'|'insert'|'delete'|'replace'; by; at; range?; quote; orphaned?; data? }`. `by` is `"human:<name>"` or `"ai:<model>"`. Comments/suggestions/provenance are all marks.
- **Create:** `createComment`, `createInsertSuggestion`, `createReplaceSuggestion` (+ delete).
- **Mutate:** `acceptSuggestion`, `rejectSuggestion`, `modifySuggestion`, `resolveComment`, `unresolveComment`, `getThread`.
- **Provenance:** `createAuthored`, `getAuthoredMarks`, `getHumanAuthored`, `getAIAuthored`, `calculateAuthorshipStats`.
- **Anchoring (the part we had feared building):** `resolveQuote(docText, quote)` (fuzzy text match), `resolveMark(docText, mark, docSize?)` (range-then-quote fallback, returns `orphaned`), `updateMarkRangesAfterEdit(marks, from, to, newLen)`.

### 2.2 Native single-file persistence format

- `embedMarks(markdown, marks)` appends a `<!-- PROOF\n{json}\n-->` footer (`MarksMetadataDocument { version: 2; marks: Record<string, StoredMark> }`) and filters out accepted/rejected suggestions.
- `extractMarks(markdown)` → `{ content, marks, legacyMarks? }`.
- `hasMarks(markdown)` → boolean.

This means **one `.md` file carries content + all collaboration state**, and prose `git diff`s stay clean because the JSON lives in a footer *below* the prose.

### 2.3 Reusable in M1 vs. deferred

- **Reuse now:** `@proof/core` (model, ops, anchoring, embed/extract), `@proof/editor` (browser editing surface, suggestion mode UI, comment gutter).
- **Defer to M2/M3:** `@proof/server` (realtime/Hocuspocus), `@proof/sqlite`, `@proof/agent-bridge`.

### 2.4 Constraints discovered

- All `@proof/*` packages are `private` and **not published to npm** → we must **fork the monorepo**, not `npm install` them.
- The `SqliteDocumentStore` interface exists but is **not actually dependency-injected** (routes import sqlite functions directly). A true *git-backed server store* in M2 will require an upstreamable DI refactor. **Not an M1 concern.**
- `TRADEMARKS.md`: the name "Proof" is reserved. Our project needs its own name.
- CRDT (Yjs) state is binary and is **rebuildable from canonical markdown** on load; M1 does not persist Yjs state to git — the `.md` + marks footer is the durable form.

---

## 3. M1 Scope

### In scope
- `mddocs open <file>`: rich browser editor (`@proof/editor`) over a local `.md` file.
- Comment threads: add, reply, resolve, list (open/resolved/orphaned).
- Suggestion mode: insert/delete/replace suggestions; accept/reject.
- Provenance: `authored` marks attributed to `git config user.name`, recorded as the human types.
- Edit history via git: `mddocs log`, `mddocs diff`.
- Async multiplayer via plain `git push`/`pull`, including footer-conflict reconciliation.
- Persistence: native embedded `<!-- PROOF -->` footer in the `.md` (decided).

### Out of scope (deferred / YAGNI)
- Websocket relay, live cursors, presence — M2.
- Self-hosted server, shareable links, auth/accounts/roles — M2.
- Agent HTTP API — M3.
- Any change to `@proof/*` package internals (M1 needs none).

### Identity
`by = "human:" + (git config user.name || os.userInfo().username)`. No accounts in M1.

---

## 4. Architecture

Fork of the `proof-sdk` npm-workspaces monorepo at `~/Open-Source Projects/mddocs`. `@proof/*` packages are kept vendored and unchanged (so upstream can be pulled); we add two workspace packages.

```
mddocs/  (fork of proof-sdk monorepo, npm workspaces)
  packages/doc-core      (@proof/core)    reuse: marks, anchoring, md<->marks
  packages/doc-editor    (@proof/editor)  reuse: browser editor + suggestion UI
  packages/doc-server    (@proof/server)  unused in M1
  packages/doc-store-sqlite                unused in M1
  packages/agent-bridge                    unused in M1
  packages/mddocs-local    NEW  engine: load/save, git, local serve   <- TDD lives here
  packages/mddocs-cli      NEW  thin commander CLI over mddocs-local
```

### Units & boundaries

**`mddocs-local`** — the engine. No CLI parsing, no React. Pure-ish module + a `serve` side-effect. This is where test-driven development happens.

Public interface (the contract other units depend on):

```ts
// load / save
loadDoc(path: string): Promise<{ content: string; marks: Record<string, StoredMark> }>
saveDoc(path: string, content: string, marks: Record<string, StoredMark>): Promise<void>  // atomic write via embedMarks

// editing surface
serve(path: string, opts?: { port?: number; autocommit?: boolean }): Promise<{ url: string; stop(): Promise<void> }>

// history (thin git wrappers)
history(path: string): Promise<Commit[]>             // git log for the file
diff(path: string, rev?: string): Promise<string>    // prose diff (content only, footer stripped)
commit(path: string, message: string): Promise<void> // debounced auto-commit on save when enabled

// reconciliation
reanchor(path: string): Promise<{ marks; orphaned: Mark[] }>  // re-resolveMark against current text
resolveFooterConflict(path: string): Promise<void>            // union marks by id on git conflict
```

All comment/suggestion/provenance logic **delegates to `@proof/core`** — `mddocs-local` adds no new model code, only persistence, git, and serving.

**`mddocs-cli`** — `commander`-based, thin. Each subcommand maps to one `mddocs-local` (or `@proof/core`) call and prints the result. No business logic.

**`@proof/editor`** — consumed as-is. `serve` mounts it and bridges its document model to `loadDoc`/`saveDoc`.

---

## 5. Data Flows

### 5.1 Edit session (`mddocs open notes.md`)
1. `loadDoc` → `{ content, marks }` (via `extractMarks`).
2. `serve` starts a loopback HTTP+WS server, opens the browser to `@proof/editor` seeded with content + marks.
3. User edits / comments / suggests in the browser. Each local change streams to `serve` over the loopback WS.
4. As the human types, `authored` marks are recorded (`createAuthored`, `by: "human:<name>"`).
5. Debounced `saveDoc` writes `embedMarks(content, marks)` atomically.
6. If `autocommit`, a separate debounce calls `commit` with a generated message (e.g. `mddocs: edit notes.md`).

### 5.2 Comment / suggestion / accept
- `comment add` → `createComment(quote, by, text, …)` → save.
- `suggest --replace` → `createReplaceSuggestion(quote, by, content, …)` (status `pending`) → save. (`--insert` / `--delete` analogous.)
- `accept <id>` → `acceptSuggestion(marks, id)` (rewrites content, prunes mark) → save. `reject <id>` → `rejectSuggestion`.
- `comment resolve <id>` → `resolveComment(marks, id)` → save.

### 5.3 Async multiplayer (git)
Each collaborator: `git pull` → `open`/edit → `saveDoc` → `git commit` → `git push`. On `open`/`pull`, `reanchor` re-runs `resolveMark` so marks shifted by the other person's prose edits re-attach; un-findable ones are flagged `orphaned`.

---

## 6. CLI Surface (M1)

```
mddocs open <file>                                   # default command: rich editor in browser
mddocs comment add <file> --quote "..." --text "..."
mddocs comment ls <file> [--open | --resolved | --orphaned]
mddocs comment reply <id> --text "..."
mddocs comment resolve <id>
mddocs suggest <file> --quote "..." (--replace "..." | --insert "..." | --delete)
mddocs accept <id>
mddocs reject <id>
mddocs log <file>                                    # doc-aware git history
mddocs diff <file> [rev]                             # prose diff between revisions (footer stripped)
mddocs init                                          # mark repo as mddocs-managed (config + .gitattributes)
mddocs resolve <file>                                # reconcile a git-conflicted PROOF footer
```

`<id>` is a mark id; commands that take an id resolve the containing file from a small index or by scanning tracked `.md` files (M1: require `--file` if ambiguous).

---

## 7. Error Handling & Edge Cases

| Case | Behaviour |
|---|---|
| **Orphaned mark** (quote not found after edits) | Set `mark.orphaned = true`; surface in editor "Orphaned" sidebar and `comment ls --orphaned`. Never silently dropped. |
| **File edited outside the tool / merged via `git pull`** | On `open`, re-`extractMarks`, `reanchor` against new text, flag un-findable marks orphaned. |
| **Git merge conflict inside the `<!-- PROOF -->` footer** | Detect conflict markers in the footer; `mddocs resolve` unions marks by `id` (last-writer-wins per field) so the user never hand-merges JSON. Prose conflicts above the footer use normal git resolution. |
| **No git repo** | `open`/editing still work; history/commit disabled with a warning suggesting `git init`. |
| **Concurrent local writes** (editor + CLI) | `saveDoc` uses atomic write (temp file + rename) and re-reads-merges marks by id before writing to avoid clobbering. |
| **Malformed/absent footer** | `extractMarks` returns empty marks; treat as a plain markdown file. |

---

## 8. Testing Strategy

- **`mddocs-local` unit tests (TDD, primary):**
  - `loadDoc`/`saveDoc` round-trip (content + marks preserved, footer well-formed).
  - `reanchor`: simulate external prose edits, assert marks re-attach; assert orphan detection when quote removed.
  - `resolveFooterConflict`: feed a git-conflicted footer, assert union-by-id result.
  - Debounced `commit` behaviour (fires once per quiet period).
  - All fast/pure — no browser, no network.
- **`mddocs-cli` integration tests:** run each subcommand against a temp git repo; assert resulting file content, footer JSON, and git state.
- **Editor glue:** rely on `@proof/editor`'s own tests for the editor itself; add one smoke test that a change in the served document model persists to disk via `saveDoc`.

---

## 9. Open Questions / Risks

- **Footer-conflict union semantics** (last-writer-wins per field) may need refinement once we see real conflicts; acceptable for M1.
- **Mark-id → file resolution** for id-only commands is simplistic in M1 (require `--file` if ambiguous); a lightweight index can come later.
- **Upstream divergence:** keeping `@proof/*` vendored-and-unchanged depends on not needing internal edits in M1 (verified: we don't). M2's git-backed server store will require coordinating a DI refactor with upstream.
- **Editor embedding:** `@proof/editor` is currently consumed inside proof-sdk's own app; confirming it mounts cleanly standalone in our `serve` is the first implementation spike.

---

## 10. Next Step

Proceed to `writing-plans` to produce the M1 implementation plan. First plan task should be the standalone-`@proof/editor` mount spike (Section 9), since it gates the `serve` design.
