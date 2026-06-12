# SPIKE: M2 collab-runtime boundary — can upstream persist to a file?

Investigation branch: `m1-implementation`
Date: 2026-06-12
Question (M2 Phase 0 gate): Can we run live collaboration with the **`.md` file +
git as the source of truth**, reusing upstream's realtime stack — or is upstream's
collab runtime too database-coupled to host file-canonically?

Files traced: `packages/doc-server/src/index.ts`, `server/collab.ts` (12.5k lines),
`server/db.ts`, `src/bridge/collab-client.ts`, `src/bridge/share-client.ts`,
`server/milkdown-headless.ts`, root `package.json`.

---

## Verdict

**Relay model (file + git canonical) is VIABLE — but NOT by reusing
`server/collab.ts`. Use `@hocuspocus/server` directly with file-backed hooks.**

- ❌ **`server/collab.ts` is hard-wired to SQLite** and cannot be made
  file-canonical without reimplementing its entire DB surface.
- ✅ **Hocuspocus itself is pluggable**, the editor already speaks its protocol,
  and a headless Yjs→markdown serializer ships upstream. We stand up our *own*
  Hocuspocus server with `onLoadDocument`/`onStoreDocument` bridged to the M1
  engine, and reuse the editor's existing collab client unchanged.

This confirms the M2 canonicity decision (file + git stays the truth). What
changes: the scope doc's "fallback" (own thin relay) is actually the **primary**
path; `server/collab.ts` is *not* reused.

---

## 1. Why `server/collab.ts` can't go file-canonical

`server/collab.ts` reads/writes all document state through `server/db.ts`:

- `server/db.ts` opens a **module-global `better-sqlite3` singleton** at a fixed
  `dbPath` (`getDb()` → `new Database(dbPath)`); it is not a pluggable store
  interface.
- Documents are SQLite rows: `getDocumentBySlug` → `SELECT * FROM documents WHERE
  slug = ?`, plus `document_projections`, auth-state, metadata, and **epoch**
  tables.
- `collab.ts` layers heavy DB-assuming logic on top: epoch-based stale-write
  detection, projection-drift reconciliation, `onStoreDocument` conflict
  resolution, durable-persist tracking, and a shutdown persist-drain. ~50+ call
  sites of `getDocumentBySlug`/`getDocumentProjectionBySlug`/
  `getDocumentAuthStateBySlug`.

Making this file-backed would mean reimplementing dozens of `db.ts` functions
against a file store **and** satisfying a 12.5k-line coordinator built around DB
semantics (slugs, projections, epochs). High effort, high fragility, and it would
fight rather than serve the local-first model.

## 2. Why the Hocuspocus-direct relay works

- **The editor speaks Hocuspocus, not raw y-websocket.**
  `src/bridge/collab-client.ts` uses `new HocuspocusProvider({...})`
  (`@hocuspocus/provider`). Any standards-compliant Hocuspocus server is
  protocol-compatible — including one we configure ourselves.
- **`@hocuspocus/server` ^2.15.2 is already a dependency** (root `package.json`),
  so no new realtime dep. Its `onLoadDocument` / `onStoreDocument` / `onChange`
  hooks are the documented persistence seam — the DB coupling we found is
  upstream's own code in `collab.ts`, not anything Hocuspocus imposes.
- **Server-side Yjs↔markdown is reusable.** `server/milkdown-headless.ts`
  exports `serializeMarkdown(doc: ProseMirrorNode): Promise<string>` and a
  `parseMarkdown(markdown) → ProseMirrorNode`; combined with the standard
  `y-prosemirror` fragment conversion, the persist hook can turn the live Yjs doc
  into markdown, `embedMarks(...)`, and hand it to the M1 engine.

## 3. Recommended M2 architecture (updates Phase 1 of the scope)

```
browser editor(s)
   │  HocuspocusProvider  (src/bridge/collab-client.ts — UNCHANGED)
   ▼
@hocuspocus/server  (OURS, in mddocs-local — NOT server/collab.ts)
   ├── onLoadDocument(slug=file): loadDoc(file) → parseMarkdown → seed Y.Doc fragment
   └── onStoreDocument / onChange (debounced):
          Y.Doc fragment → ProseMirror node → serializeMarkdown
              → embedMarks(markdown, marks) → createSession.persist
                  → saveDoc (atomic) + reanchor + debounced git autocommit
```

The persist tail is **exactly the M1 `createSession` path** — already built and
tested. M2 only adds the Hocuspocus front and the Yjs→markdown conversion.

## 4. Open sub-questions (Phase 1 detail, NOT gating)

1. **Editor collab-mode bootstrap.** M1 used `?apiPort=` to put the editor in CLI
   mode. We need the analogous minimal config to put it in *collab* mode pointed
   at our `collabWsUrl` while bypassing the hosted **share** machinery
   (`share-client.ts` does `/d/:slug` fetch + share tokens + auth). Trace how
   `init()` selects cli/share/collab mode and whether a "local collab" config
   (collabWsUrl + document name, no share token) is accepted. Likely a
   `window.__PROOF_CONFIG__` shape or a query flag.
2. **Where do marks live in the live doc?** Confirm whether comments/suggestions
   ride inside the synced Yjs doc (so `onStoreDocument` sees them) or via a side
   channel; this decides how the persist hook assembles `embedMarks` input.
3. **Slug ↔ file mapping** for a single-file local session (likely
   `basename(file)` or a fixed slug; one doc per server in M2).

## 5. Risks / mitigations

| Risk | Mitigation |
|---|---|
| Editor refuses collab mode without a share token | Serve a minimal local-collab config (sub-question 1); fall back to injecting `window.__PROOF_CONFIG__` like CLI mode |
| Yjs→markdown round-trip lossiness vs. the editor's own serializer | Reuse `server/milkdown-headless.ts` (same Milkdown schema the editor uses) — not a hand-rolled serializer |
| Marks not in the synced doc | Sub-question 2; if side-channel, sync marks via Hocuspocus `stateless`/awareness or a second map |
| Commit noise from live edits | Debounced autocommit already in `createSession`; optional squash-on-session-end |

## 6. Bottom line for the plan

Phase 0 is **GREEN**: the canonicity decision holds and the path is concrete.
Phase 1 becomes "build `mddocs-local/src/collab.ts` = our Hocuspocus server with
file-backed hooks, persisting via `createSession`," headless-tested by driving two
`HocuspocusProvider` clients and asserting the file + git converge. `server/collab.ts`
and `doc-store-sqlite` are **not** reused.
