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

### Task 4 — Manual browser checkpoint  [LARGELY VALIDATED 2026-06-12]
Drove the real editor in Chrome against `mddocs serve`. CONFIRMED: the editor
mounts in collab mode via our bootstrap, sets the tab title from our `doc`
("demo.md - Proof"), shows the share name prompt, and joins the file-seeded
collab room (a headless collaborator on the same server saw the seeded content,
and its edit persisted to the file + autocommitted). Surfaced + fixed two real
bugs (assets under `/d/`, `/api` route prefix) now covered by regression tests.
REMAINING (needs a human click — browser input is blocked at computer-use "read"
tier): dismiss the name modal, confirm the document renders with content, type a
sentence, and confirm it lands in the file (editor→Y.Doc→disk write path).

### Task 4.5 — Persist live CONTENT (not just marks)  [DISCOVERED via browser test; NEXT]
The browser test revealed the editor's canonical content lives in the
`prosemirror` Y.XmlFragment, NOT `getText('markdown')` (which is only a one-way
seed). So the current `onStoreDocument` persists marks correctly but not typed
content. Confirmed-feasible fix (all pieces verified in Node):
- Warm `getHeadlessMilkdownParser()` once (works headless; schema includes all
  proof marks + nodes).
- `onStoreDocument`: if `doc.getXmlFragment('prosemirror')` is non-empty →
  `yXmlFragmentToProsemirrorJSON` → strip `proof*` marks from the JSON (content
  only) → `schema.nodeFromJSON` → `serializeMarkdown` → `embedMarks(md,
  getMap('marks').toJSON())` → `session.applyContent`. Guard the empty fragment
  (don't clobber the file).
- The editor seeds the fragment from open-context `doc.markdown` when empty, so
  `onLoadDocument` need not seed the fragment.
Risks to handle: empty/degenerate fragment (serialize throws), marks-vs-inline
double-encoding (strip proof marks from content, keep the marks map for the
footer), and pulling `server/milkdown-headless` (@milkdown/* deps) into
`mddocs-local` without bloating its clean typecheck/footprint. Headless-test by
writing to the fragment via `prosemirrorToYXmlFragment` (mimics the editor) and
asserting the file gets the markdown; then a browser re-test.

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
