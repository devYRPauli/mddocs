# SPIKE: @proof/editor Standalone Mount

Investigation branch: `m1-implementation`  
Date: 2026-06-07  
Files traced: `packages/doc-editor/src/index.ts`, `src/editor/index.ts`,
`src/bridge/file-client.ts`, `src/bridge/share-client.ts`, `src/index.html`,
`dist/index.html`, `vite.config.ts`, `scripts/finalize-web-build.mjs`

---

## 1. Entry export and mount API

**`packages/doc-editor/package.json`** (line 7)
```json
"exports": "./src/index.ts"
```
There is no `main`/`module` field and no compiled output — the package exports
raw TypeScript.

**`packages/doc-editor/src/index.ts`** re-exports everything from the monorepo
root's `src/editor/index.ts`:
```ts
export type { EditorFullState, ProofEditor, VisualLayoutInfo } from '../../../src/editor/index.js';
export { default as proofEditor } from '../../../src/editor/index.js';
// … plus plugins/marks/suggestions/comments helpers
```

The "default" export `proofEditor` is **`window.proof`** — an imperative
singleton of type `ProofEditorImpl implements ProofEditor`.

There is **no React component, no `createEditor()` factory, and no web
component.** The editor is a global object. The mount sequence is:

```ts
// src/editor/index.ts  line 10281
window.proof = new ProofEditorImpl();

// line 10354-10363 — auto-init on DOMContentLoaded
window.proof.init();    // async, returns Promise<void>
```

`init()` (line 1158) hard-codes the host element:
```ts
const root = document.getElementById('editor');   // line 1159
```
It mounts the Milkdown editor into that element, clears its `innerHTML`, then
(only if `isCliMode` / `isShareMode`) loads a document.

**Summary:** The mount API is `window.proof.init()` on a page that has
`<div id="editor">`. Not a component — a global imperative singleton.

---

## 2. Initial data in — content and marks

### The public method

```ts
// ProofEditor interface  line 722
loadDocument(content: string, options?: { allowShareContentMutation?: boolean }): void;
```

`content` is a **markdown string** that may or may not contain an embedded
marks block (the `<!-- proof-marks: … -->` sidecar). The implementation
(`src/editor/index.ts` line 5550-5557) calls `extractMarks(content)` to strip
the sidecar, then applies the resulting `Record<string, StoredMark>` to the
ProseMirror state via `applyRemoteMarks`.

So to seed with both content and marks either:
- pass `embedMarks(markdownText, marksRecord)` as the `content` argument
  (marks are serialised inline as a fenced JSON block), **or**
- call `loadDocument(markdownText)` (no marks block) and then call
  `window.proof.applyRemoteMarks(marksRecord)` — but that is a private path;
  the clean public surface is the embedded format.

### How proof-sdk's own app does it (CLI mode)

`initFromCli()` (`src/editor/index.ts` line 1328-1351) calls
`fileClient.loadFile()` → `GET /api/file` → response is `{ content: string }`
where `content` is the raw file bytes (may contain embedded marks). It then
calls:
```ts
this.loadDocument(fileData.content);
```
The file server reads the file verbatim, so marks embedded at the bottom of the
`.md` file survive round-trips.

### The file-client detection

`FileClient.isCliMode()` returns `true` when `window.location.search` contains
`?apiPort=<n>` (file-client.ts line 27-33). So `serve` can trigger CLI mode
by appending `?apiPort=<port>` to the URL it opens in the browser.

---

## 3. Changes out — persistence hook

There is **no exposed `onChange` callback or event emitter on the public
`ProofEditor` interface**. The editor drives persistence internally.

The change cycle is:
1. Milkdown `listenerCtx.updated` fires on every ProseMirror transaction that
   changes the document (line 1237-1240).
2. This calls `this.scheduleContentSync()` (line 1239) which debounces ~150 ms.
3. `scheduleContentSync` serialises markdown, calls `sendDocumentSnapshot(view,
   markdown)` (line 5324).
4. `sendDocumentSnapshot` (line 5513-5524) calls:
   ```ts
   const metadata = getMarkMetadataForDisk(view.state);
   const contentWithMarks = embedMarks(markdown, metadata);
   if (this.isCliMode) {
     fileClient.debouncedSave(contentWithMarks);  // → PUT /api/file
   }
   ```
5. `fileClient.debouncedSave` issues `PUT /api/file` with body
   `{ content: contentWithMarks }` after a further 1 s debounce.

Marks changes (add/resolve/delete) also call `sendDocumentSnapshot` directly
through `handleMarksChange` (line 5447-5484) → `sendDocumentSnapshot` (line
5464).

**What is saved:** a single string — the markdown text with embedded marks
sidecar appended. The sidecar looks like:
```
<!-- proof-marks:begin -->
{ "version": 2, "marks": { "<uuid>": { "kind": "comment", "by": "human:…", … } } }
<!-- proof-marks:end -->
```

**For `serve`:** implement `PUT /api/file` on the local HTTP server with body
`{ content: string }`. No separate marks endpoint is needed; marks are always
embedded. Reading back the file and serving it from `GET /api/file` as
`{ content: string }` completes the round-trip.

Polling alternative: `window.proof.getMarkdownSnapshot()` returns
`{ content: string } | null` synchronously — useful if serve wants to pull
state on demand rather than receive pushes.

---

## 4. How comments/suggestions are created in the UI

The editor manages marks **internally**. The user interacts via:
- Selecting text → the `markSelectionBarPlugin` renders a floating toolbar
  (`src/editor/plugins/mark-selection-bar.ts`) with "Comment", "Suggest", etc.
  buttons.
- Clicking "Comment" → calls `openCommentComposer` (mark-popover plugin).
- The popover calls `window.proof.markComment(quote, by, text)` on the
  `ProofEditor` interface.
- The host does not need to do anything; mark creation is self-contained inside
  the editor runtime.

`serve` should not need to orchestrate comment/suggestion creation — it just
provides content load/save.

---

## 5. Bundling requirements

**Bundler is required.** The source is TypeScript with:
- `import './editor/index.ts'` (TS extension imports)
- `@milkdown/*` ESM packages
- CSS variables inline in the HTML (no separate CSS file import — all styles are
  in `<style>` tags in `index.html`)
- Dynamic imports for Prism language plugins (`import('prismjs/components/…')`)
- JSX is not used; the editor is vanilla TS + ProseMirror DOM

`@proof/editor`'s `package.json` has `"exports": "./src/index.ts"` — raw TS,
no dist. It cannot be loaded directly in a browser.

The monorepo already has a Vite build that produces `dist/assets/editor.js` — a
single bundled IIFE with `format: 'iife'` and `inlineDynamicImports: true`
(vite.config.ts lines 17-27). **That built artifact is the intended delivery
unit for `serve`.**

**DOM requirements (from `src/index.html`):**
- `<div id="editor">` — mandatory; `init()` bails if absent (line 1159)
- `<div id="editor-container">` — layout wrapper (optional, cosmetic)
- `<div id="provenance-gutter">` — authorship gutter (optional, cosmetic)
- All CSS is inlined in the HTML; no external stylesheet is needed at runtime

**No peer deps beyond a modern browser.** No React, no Vue, no web-component
registry.

---

## 6. Realtime coupling — can it run offline?

**Yes — the editor runs fully offline without a collab provider.**

The `collab` plugin from `@milkdown/plugin-collab` is registered unconditionally
in `init()` (line 1186), but inspection of the plugin source confirms it only
binds its context slot on `EditorViewReady` — no WebSocket, no Yjs doc is
created at registration time.

```ts
// @milkdown/plugin-collab/src/index.ts
export const collab: MilkdownPlugin = (ctx) => {
  const collabService = new CollabService()
  ctx.inject(collabServiceCtx, collabService).record(CollabReady)
  return async () => {
    await ctx.wait(EditorViewReady)
    collabService.bindCtx(ctx)          // ← only binds context, no connection
    ctx.done(CollabReady)
  }
}
```

`connectCollabService()` (line 2015) — the code that actually calls
`collabService.bindDoc(ydoc)` and `collabService.connect()` — is only invoked
from `initFromShare()` when `collabSession` is present (line 1442-1558). In CLI
mode (`initFromCli`) it is never called.

**In CLI mode (offline):**
- `isShareMode = false`, `collabEnabled = false`
- `initFromCli()` runs → `GET /api/config` + `GET /api/file` → `loadDocument()`
- All mark operations use local ProseMirror state only
- Saves go to `PUT /api/file` (the local HTTP server)
- No Hocuspocus, no Yjs provider, no WebSocket to a collab server

**Minimal setup for `serve`:** implement a tiny HTTP server with three routes:
```
GET  /api/config   → { file, fileName, readOnly, newFile }
GET  /api/file     → { content: "<markdown + embedded marks>" }
PUT  /api/file     ← body: { content: string } → save to disk
```
Serve the built `dist/index.html` + `dist/assets/editor.js` as static files.
Open browser to `http://localhost:<port>/?apiPort=<port>`.

---

## Recommended mount approach for `serve` (Tasks 8/9)

**Use the pre-built `dist/` artifact served over HTTP — do not run Vite dev
server inside `serve`.**

```
serve
  ├── serves dist/index.html + dist/assets/editor.js as static files
  ├── GET  /api/config  → { file: absPath, fileName: basename, readOnly: false, newFile: false }
  ├── GET  /api/file    → { content: fs.readFileSync(absPath, 'utf8') }
  └── PUT  /api/file    → fs.writeFileSync(absPath, body.content, 'utf8')

Browser URL:  http://localhost:<port>/?apiPort=<port>
```

Exact wiring:
1. `ProofEditorImpl.constructor()` reads `window.__PROOF_CONFIG__` if present;
   for CLI mode that is not required — `apiPort` query param is sufficient.
2. `FileClient.detectApiPort()` reads `?apiPort=` from `location.search` (line
   27-33 of file-client.ts). Set `apiPort` to the same port as your HTTP server.
3. On load, `init()` runs → `initFromCli()` → `loadDocument(fileData.content)`.
4. Every edit debounces 150 ms then debounces again 1 s → `PUT /api/file`.
5. The `content` payload includes embedded marks, so a plain `fs.writeFileSync`
   round-trips everything.

---

## Bundler required? — yes

`@proof/editor`'s exports are raw `.ts`. The Vite build config
(`vite.config.ts`) already compiles everything into `dist/assets/editor.js`
(IIFE, single file, ~all deps inlined). `serve` should consume that artifact
directly — it does not need its own Vite instance.

If the build artifact needs to be rebuilt (e.g. upstream source changes), run:
```
npm run build   # in the monorepo root
```

---

## Space-in-path caveat (`finalize-web-build.mjs`)

The script at `scripts/finalize-web-build.mjs` uses `path.resolve` and
`path.join` throughout — no shell string interpolation — so **it is safe with
spaces in the path**. The only externally-spawned command is:
```js
execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' })
```
`cwd` is passed as an object option to `child_process.execSync`, not via a
shell string, so the space in `Open-Source Projects/` does not break it.

The current repo path (`/Users/yashrajpandey/Open-Source Projects/mddocs`) is
therefore fine for both `npm run build` and `node scripts/finalize-web-build.mjs`.
No need to move the repo.

---

## Summary table

| Question | Answer |
|---|---|
| Mount API | Imperative singleton: `window.proof.init()` on a page with `<div id="editor">`. Not a component. |
| Init-in | `window.proof.loadDocument(embedMarks(markdown, marksRecord))` — one string call after `init()` resolves |
| Changes-out | Internal: editor calls `PUT /api/file` with `{ content }` automatically (debounced) when `?apiPort=` is in URL. No explicit callback needed. |
| Bundler | Yes — consume pre-built `dist/assets/editor.js` (IIFE). Do not import raw TS. |
| Offline | Yes — CLI mode (`?apiPort=<n>`) works with no collab server. `collab` plugin is registered but never connected. |
| Marks management | Internal — the editor handles creation/editing UI. Host only stores/restores the embedded-marks string. |
