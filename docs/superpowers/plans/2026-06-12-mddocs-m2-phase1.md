# mddocs M2 Phase 1 — File-backed collab server (plan)

**Scope doc:** `docs/superpowers/specs/2026-06-12-mddocs-m2-scope.md`
**Spike:** `packages/mddocs-local/SPIKE-collab.md` (Phase 0, GREEN)
**Sub-questions resolved 2026-06-12** (traced in `src/editor/index.ts`,
`src/bridge/collab-client.ts`, `src/bridge/share-client.ts`):

- **Marks + content both live in the synced Y.Doc:** `ydoc.getText('markdown')`
  and `ydoc.getMap('marks')` (collab-client reads exactly these). The persist
  hook reads them straight off the doc — no ProseMirror serialization needed.
- **Collab activates only via share mode.** The editor needs: a `/d/:slug` URL,
  `GET /documents/:slug/open-context` → `{ doc, capabilities }`, and
  `GET /documents/:slug/collab-session` → `{ session, capabilities }` where
  `session: CollabSessionInfo` requires **exactly**:
  `{ docId, slug, role, shareState:'ACTIVE', accessEpoch:number,
  syncProtocol:'pm-yjs-v1', collabWsUrl, token, snapshotVersion:number }`.
- **Slug↔file:** one document per server; a fixed slug maps to the single file.

---

## Tasks

### Task 1 — `createCollabServer(file, opts)`: file-backed Hocuspocus (headless, TDD) ← THIS PHASE'S CORE
Our own `@hocuspocus/server` instance (NOT `server/collab.ts`):
- `onLoadDocument`: `loadDoc(file)` → set `doc.getText('markdown')` = content,
  populate `doc.getMap('marks')` from marks.
- `onStoreDocument`/`onChange` (debounced): read `getText('markdown')` +
  `getMap('marks').toJSON()` → `embedMarks` → **M1 `createSession.persist`**
  (`saveDoc` atomic + reanchor + debounced git autocommit).
- **Test (headless, no browser):** drive two `HocuspocusProvider` clients (with
  the `ws` polyfill) against the in-process server; client A edits
  `getText('markdown')`, assert (a) client B converges and (b) the file on disk
  + a git commit reflect the merged result. This is the definitive proof the
  relay model works end-to-end at the data layer.

### Task 2 — Minimal no-auth share bootstrap HTTP routes
Extend `serve.ts` (or a sibling) with the three editor-facing routes returning a
synthetic, tokenless-but-shaped session pointing `collabWsUrl` at our Hocuspocus;
serve the editor at `/d/:slug`. Headless test: `fetch` each route, validate the
shapes against the `CollabSessionInfo`/open-context contracts above.

### Task 3 — `mddocs serve <file> --share` CLI verb
Boot Task 1 + Task 2 on one host/port; print the LAN `/d/:slug` URL. (M1 `open`
stays untouched.)

### Task 4 — Manual browser checkpoint
Two tabs at the printed URL co-edit one file: presence shows, edits merge live,
`notes.md` + `git log` reflect the result. Confirms the editor truly writes
`getText('markdown')`/`getMap('marks')` (the one client-side assumption the
headless tests can't observe).

### Task 5 — Reconcile live ↔ async(git) merge
Confirm M1's `resolveFooterConflictText` still resolves a git conflict produced
when a live session and an offline edit both touched the footer.

---

## Risks
- Editor might keep canonical content in a PM `XmlFragment`, not the `markdown`
  Y.Text → Task 4 verifies; if so, add a `server/milkdown-headless` conversion in
  the persist hook (already available, see spike).
- Hocuspocus `onStoreDocument` debounce vs. our autocommit debounce → keep
  Hocuspocus debounce short, let `createSession` own the git-commit debounce.
