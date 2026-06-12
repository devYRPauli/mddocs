# mddocs

> **Local-first, git-native collaboration for Markdown — with a CLI.**
> Think "Google Docs for `.md` files" that lives in your repo: comments,
> suggestions, authorship/provenance, and full history — stored *inside* the
> Markdown file and versioned by plain git. No server required.

`mddocs` is a thin, self-hostable layer built on the MIT-licensed
[`proof-sdk`](https://github.com/EveryInc/proof-sdk). It reuses Proof's
battle-tested marks model and browser editor, and adds a **local-first,
git-backed** workflow plus a **command-line interface** so humans and agents can
collaborate on documents without a hosted service.

> ⚠️ **`mddocs` is a placeholder name.** The project is at **Milestone 1 (M1)**:
> a single-user / async-multiplayer, local-first editor + CLI. A live
> collaboration **server (M2)** and an **agent HTTP API (M3)** are planned but
> not yet built.

---

## Why

Proof is a great collaborative Markdown editor, and `proof-sdk` is open-source —
but the natural way to *self-host* collaboration is usually "stand up a server."
`mddocs` takes the opposite bet:

- **The file is the database.** Comments, suggestions, and provenance are
  serialized into a `<!-- PROOF … -->` JSON footer *inside the same `.md` file*.
  Open the file anywhere; the collaboration state travels with it.
- **git is the sync + history layer.** Edits are ordinary commits. "Multiplayer"
  is just branches and merges; a conflicted collaboration footer is resolved by
  unioning everyone's marks (last-writer-wins per mark id).
- **The CLI is a first-class client.** Add a comment, file a suggestion, or read
  history without opening a browser — ideal for scripts and agents.

---

## What you get in M1

| Capability | How |
|---|---|
| Browser editor (comments, suggestions, provenance) | `mddocs open <file>` hosts the prebuilt `@proof/editor` on loopback |
| Comments: add / list / reply / resolve | `mddocs comment …` |
| Suggestions: replace / insert / delete + accept / reject | `mddocs suggest …`, `mddocs accept|reject …` |
| Authorship & provenance | every mark records `by` (`human:<user>` / `ai:<model>`) and `at` |
| History & diff | `mddocs log <file>`, `mddocs diff <file> [rev]` (plain git underneath) |
| Async multiplayer | edit on branches; conflicted footers union-merge automatically |
| Re-anchoring | marks re-attach to their quoted text after external edits; unmatched marks are flagged orphaned, never dropped |

---

## Architecture

```
mddocs/  (fork of the proof-sdk monorepo)
├── packages/doc-core      @proof/core    REUSED  — marks model, embed/extract, anchoring
├── packages/doc-editor    @proof/editor  REUSED  — browser editor (served from dist/)
├── packages/mddocs-local  mddocs-local   NEW     — engine: load/save, reanchor, footer-merge, git, serve
└── packages/mddocs-cli    mddocs-cli     NEW     — commander CLI over the engine
```

Every call into `@proof/core` is funnelled through a single adapter
(`packages/mddocs-local/src/proof.ts`) so the SDK boundary lives in exactly one
file. The engine is fully unit-tested; the CLI is integration-tested against
real temp git repos.

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

## Requirements

- **Node 20+** (developed on v24)
- **git** on your PATH (for history / multiplayer)

## Install

```bash
git clone <this-repo> mddocs
cd mddocs
npm install
```

The browser editor is served from the prebuilt `dist/` bundle that ships with
the repo. To rebuild it after upstream changes: `npm run build`.

> While the package isn't published to npm yet, run the CLI through `tsx`:
> ```bash
> alias mddocs='npx tsx "$(pwd)/packages/mddocs-cli/src/bin.ts"'
> ```
> The examples below use `mddocs` as if it were installed on your PATH.

---

## Quickstart

```bash
# 1. In a git repo holding your markdown:
git init                       # if it isn't one already
mddocs init                    # mark .md files as mddocs-managed (.gitattributes)

# 2. Edit in the browser (comments/suggestions persist into the file):
mddocs open notes.md           # prints a loopback URL and opens your browser
                               # Ctrl-C to stop

# 3. …or collaborate straight from the terminal:
mddocs comment add notes.md --quote "the API is fast" --text "cite a benchmark?"
mddocs comment ls   notes.md --open
mddocs suggest      notes.md --quote "teh" --replace "the"
mddocs accept       <suggestion-id> --file notes.md

# 4. History — it's just git:
mddocs log  notes.md
mddocs diff notes.md
```

## Command reference (M1)

```
mddocs open <file> [--port <n>] [--no-autocommit]   host the browser editor on loopback
mddocs init                                          mark the repo as mddocs-managed

mddocs comment add  <file> --quote <q> --text <t>    add a comment anchored to <q>
mddocs comment ls   <file> [--open|--resolved|--orphaned]
mddocs comment reply <id> --text <t> --file <f>      reply in a comment thread
mddocs comment resolve <id> --file <f>               resolve a comment thread

mddocs suggest <file> --quote <q> (--replace <c> | --insert <c> | --delete)
mddocs accept  <id> --file <f>                       mark a suggestion accepted
mddocs reject  <id> --file <f>                       mark a suggestion rejected

mddocs log  <file>                                   commit history for a document
mddocs diff <file> [rev]                             changes vs working tree / a revision
```

> **M1 notes.** Id-only commands (`reply`/`resolve`/`accept`/`reject`) take an
> explicit `--file` — a global mark→file index is a later milestone.
> `accept`/`reject` record the decision on the mark (`status`); the prose rewrite
> for an accepted suggestion is applied in the editor, not yet at the CLI.

---

## Development

```bash
npm test  -w mddocs-local      # engine unit tests
npm test  -w mddocs-cli        # CLI integration tests
npm run typecheck -w mddocs-local
npm run typecheck -w mddocs-cli
```

The browser-interactive path (typing in the editor persists to disk) is verified
manually — `mddocs open <file>`, edit, and watch the file change. Everything else
(including the full editor HTTP contract and the file API) is covered by
automated tests.

---

## Roadmap

- **M1 (this):** local-first editor + CLI, comments, suggestions, provenance, git history. ✅
- **M2:** optional live-collaboration server (real-time multiplayer).
- **M3:** agent HTTP API so AI tools can read/propose/comment programmatically.

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
