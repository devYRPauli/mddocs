# mddocs

Real-time, git-native collaboration for Markdown: a CLI, multiplayer editing, and
a structured agent API, all local-first with no hosted service.

Think of it as "Google Docs for `.md` files" that lives in your repo. Humans and
AI agents work the same document together, live, with comments, suggestions,
presence, and authorship/provenance, all stored inside the Markdown file and
versioned by plain git.

Most "Markdown for agents" tools stop at letting an agent edit a file on disk.
mddocs goes further: agents are first-class collaborators over a structured HTTP
API. They read document state, post comments and suggestions a human can accept
or reject, rewrite prose, announce presence, and poll a live event stream of what
humans and other agents are doing, each bound to its own token identity
(`ai:<model>`). That is collaboration, not just file access.

![mddocs demo: an AI reviewer agent and a human working the same Markdown file from the terminal](examples/demo.gif)

Above: a human and an AI reviewer agent on the same `notes.md`. The agent reads
the live document, leaves a comment, and proposes a fix over the agent API; the
human accepts it from the CLI; and every change is an ordinary git commit with
authorship recorded in the file. Reproduce it with
[`examples/demo.tape`](examples/demo.tape) (`vhs examples/demo.tape`).

`mddocs` is a thin, self-hostable layer built on the MIT-licensed
[`proof-sdk`](https://github.com/EveryInc/proof-sdk). It reuses Proof's marks
model and browser editor, and adds a local-first, git-backed workflow, a
command-line interface, a real-time collaboration server, and an agent HTTP API,
all keeping the `.md` file plus git as the single source of truth.

Install from npm:

```bash
npm install -g @devyrpauli/mddocs
mddocs --help
```

The npm package is published under the `@devyrpauli` scope; the command it
installs is `mddocs`. You can also run from source (see
[Install from source](#install-from-source)).

## Why

Proof is a good collaborative Markdown editor, and `proof-sdk` is open-source,
but the usual way to self-host collaboration is to stand up a database-backed
server. `mddocs` takes a different approach:

- The file is the database. Comments, suggestions, and provenance are serialized
  into a `<!-- PROOF ... -->` JSON footer inside the same `.md` file. Open the
  file anywhere and the collaboration state travels with it.
- git is the history and async-sync layer. Edits are ordinary commits. Async
  collaboration is just branches and merges; a conflicted footer is union-resolved
  by `mddocs resolve`.
- Live multiplayer is a relay, not a new source of truth. `mddocs serve` hosts a
  real-time session (Yjs over WebSocket); every settled change is written straight
  back to the `.md` and auto-committed. The database never takes over.
- The CLI and HTTP API are clients too. Add a comment, file a suggestion, or read
  state without a browser, which is useful for scripts and AI agents.

## What you get

| Capability | How |
|---|---|
| Browser editor (comments, suggestions, provenance) | `mddocs open <file>` (single-user) or `mddocs serve <file>` (multiplayer) |
| Real-time multiplayer with presence | `mddocs serve <file>`: everyone on the URL co-edits live; edits persist to the file plus git |
| Role-based share links (editor / commenter / viewer) | `serve` prints a link per role; roles enforced server-side (viewers read-only, commenters cannot edit prose) |
| Agent HTTP API | AI tools read state, post comments/suggestions, rewrite prose, announce presence, and poll document events live, attributed to `ai:<model>` |
| Comments and suggestions from the terminal | `mddocs comment ...`, `mddocs suggest ...`, `mddocs accept`/`reject` |
| History and diff | `mddocs log <file>`, `mddocs diff <file> [rev]` (plain git underneath) |
| Async multiplayer and conflict resolution | edit on branches; `mddocs resolve <file>` unions a conflicted PROOF footer |
| Authorship and provenance | every mark records `by` (`human:<user>` or `ai:<model>`) and `at` |
| Re-anchoring | marks re-attach to their quoted text after external edits; unmatched marks are flagged orphaned, never dropped |

## Requirements

- Node 20+ (developed on v24)
- git on your PATH (for history and multiplayer)

## Install from source

For development, or to run the latest from the repo:

```bash
git clone https://github.com/devYRPauli/mddocs.git
cd mddocs
npm install
npm run build      # builds the browser editor bundle into dist/ (needed for open/serve)
```

`npm run build` only needs to be re-run if you change the editor or `@proof/*`
sources. The CLI itself runs straight from source via `tsx`.

To run the CLI from a source checkout without installing it globally, go
through `tsx`:

```bash
alias mddocs='npx tsx "$(pwd)/packages/mddocs-cli/src/bin.ts"'
```

The examples below use `mddocs` as if it were installed on your PATH.

## Quickstart

```bash
# In a git repo holding your markdown:
git init                       # if it isn't one already
mddocs init                    # mark .md files as mddocs-managed (.gitattributes)

# Single-user editing in the browser (comments/suggestions persist to the file):
mddocs open notes.md

# A live multiplayer session you can share on your LAN:
mddocs serve notes.md          # prints role links and an agent API block; Ctrl-C to stop

# Or collaborate straight from the terminal:
mddocs comment add notes.md --quote "the API is fast" --text "cite a benchmark?"
mddocs suggest      notes.md --quote "teh" --replace "the"
mddocs accept       <suggestion-id> --file notes.md

# History is just git:
mddocs log  notes.md
mddocs diff notes.md
```

## Real-time multiplayer and sharing: `mddocs serve`

```bash
mddocs serve notes.md [--port <n>] [--host <ip>] [--no-autocommit]
```

Hosts a live editing session on one port: the browser editor, a Yjs/WebSocket
collaboration channel, and the agent API. Everyone who opens the URL co-edits the
same document in real time; every settled change is serialized back to `notes.md`
and auto-committed to git. Use `--host 0.0.0.0` to share on your LAN.

`serve` prints three role links. Share the one matching the access you want to
grant:

| Link | Role | Can do |
|---|---|---|
| edit (you) | editor | read, comment, edit |
| comment link | commenter | read, comment |
| view link | viewer | read only |

- An absent or unknown token gets the least privilege (viewer), so a leaked bare
  URL cannot edit.
- Roles are enforced server-side, not just in the editor UI. A viewer's WebSocket
  connection is read-only, so a crafted client cannot write at all. A commenter
  may write comments (a comment is a write to the marks map) but cannot edit the
  prose: any prose change from a commenter connection is reverted server-side
  before it persists or reaches other clients. Editors can do both.

## Agent HTTP API

A live `serve` session also exposes an HTTP API so AI agents can read the
document, post comments/suggestions, and edit the prose directly. Everything
appears in every connected editor in real time and persists to git, attributed to
`ai:<model>`. `serve` prints the base URL and an agent token; send it as the
`x-share-token` header.

```
GET  /api/agent/:slug/state                                              -> { content, marks, presence }
POST /api/agent/:slug/comment  { quote, text, model? }                   -> { id }
POST /api/agent/:slug/reply    { id, text, model? }                      -> { id, replies }
POST /api/agent/:slug/suggest  { quote, replace|insert|delete, model? }  -> { id, kind }
POST /api/agent/:slug/rewrite  { markdown, quote?, model? }              -> { chars, by, markId? }
POST /api/agent/:slug/presence { name?, status?, details? }              -> { presence }
POST /api/agent/:slug/presence/disconnect                               -> { disconnected }
GET  /api/agent/:slug/events/pending?after=<id>&limit=<n>                -> { events, cursor }
POST /api/agent/:slug/events/ack { upToId }                             -> { acked }
```

`reply` appends to an existing comment thread (the same threads the CLI's
`comment reply` writes to); `id` is the comment mark id from `state` or a prior
`comment` call. `suggest` proposes a change a human accepts; `rewrite` edits the prose directly.
With a `quote`, `rewrite` replaces that span; without one it replaces the whole
body. The change is applied to the live document and recorded as an authored mark.

### Presence and events

`presence` lets an agent announce it is active on the document (with a `status`
like `reviewing` and a free-text `details`); it shows up in every `state` read's
`presence` array and as an `agent.presence` event. `presence/disconnect` removes
the caller's own presence (and emits `agent.disconnected`). The presence identity
and every event `actor` are bound to the agent token (`ai:<name>`, from the
token's `--agent` name) and cannot be set from the request, so one agent cannot
impersonate or disconnect another. Run `serve --agent <name>` (repeatable) to
give each agent its own token and identity.

`events/pending` is how an agent reacts to what humans and other agents did,
without holding a WebSocket. Both browser edits and agent mutations land on the
same live document, so all activity surfaces uniformly:

- `mark.added` / `mark.updated` / `mark.removed` - a comment, suggestion,
  accept/reject, reply, or provenance mark changed (`data.markId`, `data.kind`,
  `data.by`, and `data.status` for suggestions).
- `document.changed` - the prose changed (coalesced while someone is typing).
- `agent.presence` / `agent.disconnected` - presence came or went.

Poll with `?after=<cursor>` to receive only events newer than the last `cursor`
you saw; each event carries a monotonic `id` and an `actor` (`ai:<model>`,
`human:<name>`, or `unknown`). Call `events/ack` with `upToId` once you have
handled them. Events are kept in memory for the life of the `serve` session.

By default `serve` issues one shared agent token. Pass `--agent <name>` (repeatable)
to register named agents, each with its own token; `serve` then prints a token per
agent. A request that omits `model` is attributed to the token's agent name
(`ai:<name>`). Per-agent rate limits are available through the engine API
(`serveShare({ agents: [{ name, rateLimit: { maxRequests, windowMs } }] })`),
returning HTTP 429 when exceeded.

```bash
# Read the live document:
curl -H "x-share-token: $TOKEN" http://127.0.0.1:<port>/api/agent/notes.md/state

# Post a comment as an agent:
curl -X POST -H "x-share-token: $TOKEN" -H 'content-type: application/json' \
  -d '{"quote":"The latency is acceptable.","text":"Quantify, p50 or p99?","model":"claude-opus-4-8"}' \
  http://127.0.0.1:<port>/api/agent/notes.md/comment
```

See [`examples/agent-reviewer.mjs`](examples/agent-reviewer.mjs) for a runnable
reviewer agent and a human-plus-agent walkthrough.

## Resolving merge conflicts: `mddocs resolve`

When two people edit a document on different branches and you `git merge`, the
prose merges normally but the `<!-- PROOF -->` footer can conflict. Union both
sides' marks:

```bash
git merge other-branch         # may leave a conflicted footer
mddocs resolve notes.md        # unions both sides' marks; on id collision, latest `at` wins
git add notes.md && git commit
```

## Command reference

```
mddocs open  <file> [--port <n>] [--no-autocommit]          single-user browser editor (loopback)
mddocs serve <file> [--port <n>] [--host <ip>] [--no-autocommit] [--agent <name>]
                                                            live multiplayer, role links, agent API
mddocs init                                                 mark the repo as mddocs-managed
mddocs resolve <file>                                       union a git-conflicted PROOF footer

mddocs comment add  <file> --quote <q> --text <t>           add a comment anchored to <q>
mddocs comment ls   <file> [--open|--resolved|--orphaned]
mddocs comment reply <id> --text <t> [--file <f>]          reply in a comment thread
mddocs comment resolve <id> [--file <f>]                   resolve a comment thread

mddocs suggest <file> --quote <q> (--replace <c> | --insert <c> | --delete)
mddocs accept  <id> [--file <f>]                            apply a suggestion to the prose
mddocs reject  <id> [--file <f>]                            mark a suggestion rejected

mddocs log  <file>                                          commit history for a document
mddocs diff <file> [rev]                                    changes vs working tree or a revision
```

Notes. Id-only commands (`reply`, `resolve`, `accept`, `reject`) find their
document automatically by scanning the managed `.md` files for the mark; pass
`--file <path>` to skip the scan or disambiguate. `accept` applies the suggested
change to the prose (replace, insert, or delete, anchored by the suggestion's
quote) and keeps the suggestion as an accepted record, preserving who proposed it
(`by`); `reject` records the decision on the mark and leaves the prose unchanged.
Both decisions stay in the file as provenance.

## Architecture

```
mddocs/  (fork of the proof-sdk monorepo)
  packages/doc-core      @proof/core    reused   marks model, embed/extract, anchoring
  packages/doc-editor    @proof/editor  reused   browser editor (served from dist/)
  packages/mddocs-local  mddocs-local   new      engine
        doc.ts        loadDoc / saveDoc (atomic, embed/extract)
        reanchor.ts   re-resolve marks against current text
        footer.ts     detect and union-resolve a conflicted PROOF footer
        git.ts        history / diff / commit (simple-git)
        serve.ts      single-user editor host (HTTP file API)
        collab.ts     file-backed Hocuspocus server (live relay)
        serialize.ts  prosemirror-fragment to/from markdown (headless Milkdown boundary)
        share.ts      multiplayer host: role links, bootstrap, WS, agent routes
        agent.ts      agent operations over a live Hocuspocus DirectConnection
  packages/mddocs-cli    mddocs-cli     new      commander CLI over the engine
```

Live multiplayer reuses upstream's Yjs and Hocuspocus stack as an in-memory
concurrency layer only; the resolved markdown and marks are persisted through the
same engine path as the CLI (`saveDoc`, reanchor, debounced git commit). The
editor's canonical content is the `prosemirror` Y.XmlFragment, which `serialize.ts`
converts to and from markdown using upstream's headless Milkdown serializer.
Every call into `@proof/core` goes through one adapter
(`packages/mddocs-local/src/proof.ts`).

### How data is stored

A managed document is just Markdown with a trailing footer:

```markdown
# My document

The body everyone reads and diffs normally.

<!-- PROOF
{"version":2,"marks":{"<id>":{"kind":"comment","by":"human:alice","at":"...","quote":"...","data":{"text":"...","resolved":false}}}}
-->
```

`loadDoc`/`saveDoc` split and rejoin this footer; the prose above it stays clean,
diffable text.

## Development

```bash
npm test  -w mddocs-local      # engine unit and integration tests (incl. headless collab/agent)
npm test  -w mddocs-cli        # CLI integration tests against real temp git repos
npm run typecheck -w mddocs-local
npm run typecheck -w mddocs-cli
```

The live collaboration and agent paths are covered headlessly (real
`HocuspocusProvider` clients driven in-process, no browser needed); the
browser-interactive path is verified manually.

## Roadmap

- M1: local-first editor and CLI (comments, suggestions, provenance, git history). Done.
- M2: live collaboration server (real-time multiplayer, file plus git canonical). Done.
- M2.5: share links and roles (editor/commenter/viewer, server-side role
  enforcement: viewers read-only, commenters cannot edit prose). Done.
- M3: agent HTTP API (read state, comment, suggest, and rewrite prose live). Done.
- M3.5: agent presence and events (announce activity; poll mark/prose/presence
  changes from humans and other agents with an after-cursor and ack). Done.

## Upcoming updates

Contributions welcome. Next on the list:

- Upstream the `@proof/core` TS2308 fix
  ([proof-sdk#57](https://github.com/EveryInc/proof-sdk/pull/57)) and drop the
  local fork patch once merged.

## Attribution and license

Built on [`proof-sdk`](https://github.com/EveryInc/proof-sdk) (MIT, Every Inc).
The `packages/doc-*`, `src/`, and `server/` trees originate from proof-sdk and
retain its license; see [`LICENSE`](LICENSE), [`NOTICE.md`](NOTICE.md), and
[`TRADEMARKS.md`](TRADEMARKS.md). The original upstream README is preserved as
[`README.proof-sdk.md`](README.proof-sdk.md). "Proof" is a trademark of Every
Inc.; this project is not affiliated with or endorsed by them.

Local modifications to the vendored SDK are tracked in
[`FORK_PATCHES.md`](FORK_PATCHES.md).
