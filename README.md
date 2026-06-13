# mddocs

> **Local-first, git-native collaboration for Markdown — with a CLI, real-time
> multiplayer, and an agent API.**
> Think "Google Docs for `.md` files" that lives in your repo: comments,
> suggestions, authorship/provenance, and full history — stored *inside* the
> Markdown file and versioned by plain git. Humans and AI agents edit the same
> document together, live. No hosted service.

`mddocs` is a thin, self-hostable layer built on the MIT-licensed
[`proof-sdk`](https://github.com/EveryInc/proof-sdk). It reuses Proof's
battle-tested marks model and browser editor, and adds a **local-first,
git-backed** workflow, a **command-line interface**, a **real-time collaboration
server**, and an **agent HTTP API** — all keeping the `.md` file + git as the
single source of truth.

> ⚠️ **`mddocs` is a placeholder name.** Not yet published to npm — run via `tsx`
> (see [Install](#install)).

---

## Why

Proof is a great collaborative Markdown editor, and `proof-sdk` is open-source —
but the usual way to *self-host* collaboration is "stand up a database-backed
server." `mddocs` takes the opposite bet:

- **The file is the database.** Comments, suggestions, and provenance are
  serialized into a `<!-- PROOF … -->` JSON footer *inside the same `.md` file*.
  Open the file anywhere; the collaboration state travels with it.
- **git is the history + async-sync layer.** Edits are ordinary commits.
  Async "multiplayer" is just branches and merges; a conflicted collaboration
  footer is union-resolved by `mddocs resolve`.
- **Live multiplayer is a relay, not a new source of truth.** `mddocs serve`
  hosts a real-time session (Yjs over WebSocket); every settled change is written
  straight back to the `.md` and auto-committed. The database never takes over.
- **The CLI and HTTP API are first-class clients.** Add a comment, file a
  suggestion, or read state without a browser — ideal for scripts and AI agents.

---

## What you get

| Capability | How |
|---|---|
| Browser editor (comments, suggestions, provenance) | `mddocs open <file>` (single-user) · `mddocs serve <file>` (multiplayer) |
| **Real-time multiplayer** with presence | `mddocs serve <file>` — everyone on the URL co-edits live; edits persist to the file + git |
| **Role-based share links** (editor / commenter / viewer) | `serve` prints a link per role; viewers are **read-only, enforced server-side** |
| **Agent HTTP API** | AI tools read state and post comments/suggestions live, attributed to `ai:<model>` |
| Comments / suggestions from the terminal | `mddocs comment …`, `mddocs suggest …`, `mddocs accept|reject …` |
| History & diff | `mddocs log <file>`, `mddocs diff <file> [rev]` (plain git underneath) |
| Async multiplayer + conflict resolution | edit on branches; `mddocs resolve <file>` unions a conflicted PROOF footer |
| Authorship & provenance | every mark records `by` (`human:<user>` / `ai:<model>`) and `at` |
| Re-anchoring | marks re-attach to their quoted text after external edits; unmatched marks are flagged orphaned, never dropped |

---

## Requirements

- **Node 20+** (developed on v24)
- **git** on your PATH (for history / multiplayer)

## Install

```bash
git clone https://github.com/devYRPauli/mddocs.git
cd mddocs
npm install
npm run build      # builds the browser editor bundle into dist/ (needed for open/serve)
```

`npm run build` only needs to be re-run if you change the editor/`@proof/*`
sources. The CLI itself runs straight from source via `tsx`.

> Until the package is published, run the CLI through `tsx`:
> ```bash
> alias mddocs='npx tsx "$(pwd)/packages/mddocs-cli/src/bin.ts"'
> ```
> The examples below use `mddocs` as if it were installed on your PATH.

---

## Quickstart

```bash
# In a git repo holding your markdown:
git init                       # if it isn't one already
mddocs init                    # mark .md files as mddocs-managed (.gitattributes)

# Single-user editing in the browser (comments/suggestions persist to the file):
mddocs open notes.md

# …or a live multiplayer session you can share on your LAN:
mddocs serve notes.md          # prints role links + an agent API block; Ctrl-C to stop

# …or collaborate straight from the terminal:
mddocs comment add notes.md --quote "the API is fast" --text "cite a benchmark?"
mddocs suggest      notes.md --quote "teh" --replace "the"
mddocs accept       <suggestion-id> --file notes.md

# History — it's just git:
mddocs log  notes.md
mddocs diff notes.md
```

---

## Real-time multiplayer & sharing — `mddocs serve`

```bash
mddocs serve notes.md [--port <n>] [--host <ip>] [--no-autocommit]
```

Hosts a live editing session on one port: the browser editor, a Yjs/WebSocket
collaboration channel, and the agent API. Everyone who opens the URL co-edits the
same document in real time; every settled change is serialized back to `notes.md`
and auto-committed to git. Use `--host 0.0.0.0` to share on your LAN.

`serve` prints **three role links** — share the one matching the access you want
to grant:

| Link | Role | Can do |
|---|---|---|
| edit (you) | editor | read · comment · edit |
| comment link | commenter | read · comment |
| view link | viewer | read only |

- An absent/unknown token gets the **least privilege** (viewer), so a leaked bare
  URL can't edit.
- **Viewers are enforced server-side**: a viewer's WebSocket connection is
  read-only, so a crafted client still can't write. The commenter-vs-editor split
  is gated in the editor UI (a comment is itself a write).

---

## Agent HTTP API (M3)

A live `serve` session also exposes an HTTP API so AI agents can read the
document and post comments/suggestions — appearing in every connected editor in
real time and persisting to git, attributed to `ai:<model>`. `serve` prints the
base URL and an **agent token**; send it as the `x-share-token` header.

```
GET  /api/agent/:slug/state                       → { content, marks }
POST /api/agent/:slug/comment  { quote, text, model? }            → { id }
POST /api/agent/:slug/suggest  { quote, replace|insert|delete, model? } → { id, kind }
```

```bash
# Read the live document:
curl -H "x-share-token: $TOKEN" http://127.0.0.1:<port>/api/agent/notes.md/state

# Post a comment as an agent:
curl -X POST -H "x-share-token: $TOKEN" -H 'content-type: application/json' \
  -d '{"quote":"The latency is acceptable.","text":"Quantify — p50 or p99?","model":"claude-opus-4-8"}' \
  http://127.0.0.1:<port>/api/agent/notes.md/comment
```

See [`examples/agent-reviewer.mjs`](examples/agent-reviewer.mjs) for a runnable
"reviewer agent" and a human + agent walkthrough.

---

## Resolving merge conflicts — `mddocs resolve`

When two people edit a document on different branches and you `git merge`, the
prose merges normally but the `<!-- PROOF -->` footer can conflict. Union both
sides' marks:

```bash
git merge other-branch         # may leave a conflicted footer
mddocs resolve notes.md        # unions both sides' marks; on id collision, latest `at` wins
git add notes.md && git commit
```

---

## Command reference

```
mddocs open  <file> [--port <n>] [--no-autocommit]          single-user browser editor (loopback)
mddocs serve <file> [--port <n>] [--host <ip>] [--no-autocommit]
                                                            live multiplayer + role links + agent API
mddocs init                                                 mark the repo as mddocs-managed
mddocs resolve <file>                                       union a git-conflicted PROOF footer

mddocs comment add  <file> --quote <q> --text <t>           add a comment anchored to <q>
mddocs comment ls   <file> [--open|--resolved|--orphaned]
mddocs comment reply <id> --text <t> --file <f>             reply in a comment thread
mddocs comment resolve <id> --file <f>                      resolve a comment thread

mddocs suggest <file> --quote <q> (--replace <c> | --insert <c> | --delete)
mddocs accept  <id> --file <f>                              mark a suggestion accepted
mddocs reject  <id> --file <f>                              mark a suggestion rejected

mddocs log  <file>                                          commit history for a document
mddocs diff <file> [rev]                                    changes vs working tree / a revision
```

> **Notes.** Id-only commands (`reply`/`resolve`/`accept`/`reject`) take an
> explicit `--file` — a global mark→file index is a later milestone.
> `accept`/`reject` record the decision on the mark (`status`); the prose rewrite
> for an accepted suggestion is applied in the editor.

---

## Architecture

```
mddocs/  (fork of the proof-sdk monorepo)
├── packages/doc-core      @proof/core    REUSED  — marks model, embed/extract, anchoring
├── packages/doc-editor    @proof/editor  REUSED  — browser editor (served from dist/)
├── packages/mddocs-local  mddocs-local   NEW     — engine
│     doc.ts        loadDoc / saveDoc (atomic, embed/extract)
│     reanchor.ts   re-resolve marks against current text
│     footer.ts     detect + union-resolve a conflicted PROOF footer
│     git.ts        history / diff / commit (simple-git)
│     serve.ts      single-user editor host (HTTP file API)
│     collab.ts     file-backed Hocuspocus server (live relay)
│     serialize.ts  prosemirror-fragment ↔ markdown (headless Milkdown boundary)
│     share.ts      multiplayer host: role links + bootstrap + WS + agent routes
│     agent.ts      agent operations over a live Hocuspocus DirectConnection
└── packages/mddocs-cli    mddocs-cli     NEW     — commander CLI over the engine
```

**Live multiplayer** reuses upstream's Yjs + Hocuspocus stack as an in-memory
concurrency layer only; the resolved markdown + marks are persisted through the
same engine path as the CLI (`saveDoc` + reanchor + debounced git commit). The
editor's canonical content is the `prosemirror` Y.XmlFragment, which `serialize.ts`
converts to/from markdown using upstream's headless Milkdown serializer. Every
call into `@proof/core` is funnelled through one adapter
(`packages/mddocs-local/src/proof.ts`).

### How data is stored

A managed document is just Markdown with a trailing footer:

```markdown
# My document

The body everyone reads and diffs normally.

<!-- PROOF
{"version":2,"marks":{"<id>":{"kind":"comment","by":"human:alice","at":"…","quote":"…","data":{"text":"…","resolved":false}}}}
-->
```

`loadDoc`/`saveDoc` split and rejoin this footer; the prose above it stays
clean, diffable text.

---

## Development

```bash
npm test  -w mddocs-local      # engine unit + integration tests (incl. headless collab/agent)
npm test  -w mddocs-cli        # CLI integration tests against real temp git repos
npm run typecheck -w mddocs-local
npm run typecheck -w mddocs-cli
```

The live collaboration and agent paths are covered headlessly (real
`HocuspocusProvider` clients driven in-process — no browser needed); the
browser-interactive path is verified manually.

---

## Roadmap

- **M1 — local-first editor + CLI** (comments, suggestions, provenance, git history) ✅
- **M2 — live collaboration server** (real-time multiplayer, file + git canonical) ✅
- **M2.5 — share links + roles** (editor/commenter/viewer, server-side viewer enforcement) ✅
- **M3 — agent HTTP API** (read state, post comments/suggestions live) ✅

## Upcoming updates

Contributions welcome — these are the next things on the list:

- **Agent direct-rewrite endpoint** — let agents edit prose directly, not just
  propose (v1 is propose-only; humans accept).
- **Per-agent identity tokens + rate limiting** — instead of one shared agent
  token, issue per-agent tokens and throttle them.
- **Commenter-granularity enforcement** — currently viewers are enforced
  server-side and the comment-vs-edit split is UI-gated; enforce it on the wire too.
- **CLI `accept` applies the prose rewrite** — today `accept` records the
  decision; applying the edit to the body is editor-only.
- **Global mark→file index** — so id-only commands (`reply`/`resolve`/`accept`/
  `reject`) no longer need an explicit `--file`.
- **Presence / events for agents** — stream document events to agents.
- **Publish as an installable `mddocs` binary** (npm) + a real project name.
- **CI** — run both test suites on every push.
- **Upstream the `@proof/core` TS2308 fix** ([proof-sdk#57](https://github.com/EveryInc/proof-sdk/pull/57))
  and drop the local fork patch once merged.

See [`docs/superpowers/`](docs/superpowers/) for the design specs and plans
behind each milestone.

---

## Attribution & license

Built on [`proof-sdk`](https://github.com/EveryInc/proof-sdk) (MIT, © Every
Inc.). The `packages/doc-*`, `src/`, and `server/` trees originate from
proof-sdk and retain its license — see [`LICENSE`](LICENSE),
[`NOTICE.md`](NOTICE.md), and [`TRADEMARKS.md`](TRADEMARKS.md). The original
upstream README is preserved as
[`README.proof-sdk.md`](README.proof-sdk.md). "Proof" is a trademark of Every
Inc.; this project is not affiliated with or endorsed by them.

Local modifications to the vendored SDK are tracked in
[`FORK_PATCHES.md`](FORK_PATCHES.md).
