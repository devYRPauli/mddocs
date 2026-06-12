# mddocs M2 — Live Collaboration Server (Scope)

**Status:** Scope / direction approved 2026-06-12 (decision delegated by owner).
**Predecessor:** M1 (local-first editor + CLI) — complete, 44 tests green.
**This doc:** the architectural decision + a phased, spike-gated task outline.
A detailed implementation plan follows *after* the Phase 0 spike (mirroring how
M1's plan followed its boundary spikes).

---

## 1. Goal

Let two or more people (or agents) edit the **same document live** — multiple
cursors, presence, real-time merge — while **keeping the `.md` file + git as the
source of truth**. Self-hostable, no accounts, runs on loopback or a LAN box.

Non-goals for M2: hosted accounts, a public multi-tenant service, the agent
HTTP API (that is M3).

---

## 2. The decision

### 2.1 Canonicity: **File + git stays canonical (relay model)**

When a live server is running, the `.md` file (with its `<!-- PROOF -->` footer)
remains the truth; git remains the history. The server holds only **ephemeral**
realtime state.

```
editors  <--WebSocket/Yjs-->  mddocs relay  --persist-->  notes.md  +  git commit
                                   |
                          (Yjs doc = in-memory concurrency layer only;
                           derived from the file, never the source of truth)
```

**Why, vs. the alternatives:**

- *DB-canonical (adopt upstream's SQLite/Yjs as truth)* — fastest to robust
  multiplayer, but it discards the one thing that makes mddocs mddocs: your data
  living in your files, versioned by git. Rejected.
- *Hybrid (DB live, git at rest)* — preserves git history but introduces a
  SQLite-row lifecycle (create on open, flush on last-disconnect, drop, reseed)
  whose payoff — "git stays meaningful" — the relay already delivers without the
  database. Extra moving parts for no unique benefit. Rejected.
- *File + git relay (chosen)* — Yjs resolves concurrent edits in memory; the
  resolved markdown+marks are written back through the **existing M1 engine**.
  No new source of truth, no new persistence dependency.

### 2.2 Reuse, don't rebuild

Upstream `proof-sdk` already ships the hard parts (confirmed by inventory):

- **Realtime stack:** Yjs + Hocuspocus over `WebSocketServer` (`server/collab.ts`,
  `server/collab-mutation-coordinator.ts`, etc.).
- **Server assembly:** `doc-server` → `createCollabRuntime()`,
  `mountProofSdkRoutes(app)`, `createShareRouter()`.
- **Editor live path:** `src/bridge/share-client.ts` already detects `/d/:slug`,
  fetches the doc, and manages WebSocket sync via `collabWsUrl`. The *same*
  editor binary we host in M1 CLI mode also runs share mode.

So M2 is **integration**, not greenfield realtime. The work is wiring upstream's
collab runtime to a **file-backed persistence hook** instead of its SQLite store,
and exposing it through one new CLI verb.

### 2.3 The relay = M1 `createSession`, fed differently

`mddocs-local`'s `createSession(path)` already does exactly the persist side:
`extractMarks → reanchorMarks → saveDoc (atomic) → debounced autocommit`. M2
feeds it from Yjs document-change events instead of HTTP `PUT /api/file`. The
persistence contract is unchanged, which is why the relay model is low-risk.

---

## 3. Scope: realtime co-editing first

Ship **same-document live editing with presence, no auth** (`--share` on a
trusted loopback/LAN). Tokenized share links + read/comment/edit roles are
**M2.5** — upstream's `share-client` + `bridge-auth-policy` make that an additive
layer, so we design the URL/session shape to accommodate it but do not build it
in M2.

CLI surface (new):

```
mddocs serve <file> --share [--port <n>] [--host <ip>] [--no-autocommit]
  -> prints a LAN URL (http://<host>:<port>/d/<slug>) that opens the editor in
     share mode; every participant's edits merge live and persist to <file> + git.
```

`mddocs open` (M1, single-user CLI mode) stays as-is.

---

## 4. Phased plan (spike-gated)

**Phase 0 — De-risk the collab-runtime boundary (THE gate).**
- Spike: can `createCollabRuntime()` / the Hocuspocus instance accept a custom
  persistence hook (`onLoadDocument` seeds the Yjs doc from `loadDoc(file)`;
  `onStoreDocument`/change → `createSession.persist`) **without** the SQLite
  store? Trace `server/collab.ts` + `doc-store-sqlite` usage.
- Output: `SPIKE-collab.md` — the exact seam, or an escalation if the runtime is
  hard-wired to SQLite (fallback: thin our own y-websocket server around the Yjs
  doc, still persisting via the M1 engine).

**Phase 1 — File-backed collab session (headless, TDD).**
- `mddocs-local/src/collab.ts`: `createCollabServer(file, opts)` — boots the
  reused runtime with the file-backed hooks; on Yjs change, route the resolved
  markdown-with-marks string into the M1 `createSession` persist path.
- Test headless: drive two Yjs clients against the in-process server, assert the
  file on disk converges and a commit lands (no browser).

**Phase 2 — Wire the editor's share mode + `mddocs serve --share`.**
- Serve the editor so `share-client` connects to our `collabWsUrl`; add the CLI
  verb. Manual checkpoint: two browser tabs co-edit one file; presence shows;
  `notes.md` + `git log` reflect the merged result.

**Phase 3 — Reconcile with async (git) multiplayer.**
- Confirm M1's footer union-merge still resolves a *git* conflict produced when
  someone edited offline while a live session also wrote — i.e. live and async
  paths agree. Extend `reanchorMarks` / `resolveFooterConflictText` coverage if
  the live path surfaces a new case.

**M2.5 (deferred) — share links + roles** on top of upstream share/bridge auth.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Collab runtime hard-wired to SQLite | Phase 0 spike; fallback = own thin y-websocket relay around the Yjs doc, same file persistence |
| Commit noise from live edits | Debounced autocommit (already in `createSession`); consider squash-on-session-end |
| Live vs. offline-git divergence | Phase 3 explicitly tests the union-merge path against a live-written footer |
| Repo path has a space | Already handled in M1; keep using path-safe APIs |

---

## 6. Definition of done (M2)

- `mddocs serve <file> --share` → two browsers co-edit one doc live with presence.
- Every merged edit persists to the `.md` + an autocommit (when in a git repo).
- Headless test proves multi-client convergence to disk without a browser.
- M1's async-multiplayer footer-merge still passes (live and git paths agree).
- No new source of truth introduced; no SQLite dependency added.
