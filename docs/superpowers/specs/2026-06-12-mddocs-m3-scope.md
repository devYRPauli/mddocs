# mddocs M3 — Agent HTTP API (scope)

**Status:** Scope + Phase 0 spike GREEN, 2026-06-12.
**Predecessors:** M1 (engine + CLI), M2 (live collab server + roles).

## Goal

Let an AI agent read a document and contribute **comments and suggestions
programmatically over HTTP**, so its contributions appear in every connected
human's editor in real time and persist to git with `ai:<model>` provenance.
This is the "agent-first collaboration" piece of the original vision.

## Decision: inject into the LIVE session (not a separate file-poker)

The agent API is part of the running `mddocs serve` session and mutates the live
Y.Doc via Hocuspocus `openDirectConnection(slug).transact(...)`. Confirmed by the
Phase 0 spike: a server-side transact that sets a marks-map entry was received
live by a connected human client AND persisted to the file (with ai provenance).
So agent contributions are real-time + git-backed, reusing the M1 persistence
path — no new source of truth, consistent with M2's file-canonical model.

Works even with no humans connected: `openDirectConnection` loads the doc
(seeding from the file), applies the change, and `onStoreDocument` persists it.

## API (v1)

All under the live server, authenticated by a dedicated **agent token**
(`x-share-token: <agentToken>`; 403 otherwise). The agent token is generated at
startup and printed by `mddocs serve`.

- `GET  /api/agent/:slug/state`
  → `{ content, marks }` — the current document (read from the live doc).
- `POST /api/agent/:slug/comment`  `{ quote, text, model? }`
  → `{ id }` — adds a comment mark (`by: ai:<model>`), anchored by quote.
- `POST /api/agent/:slug/suggest`  `{ quote, replace? | insert? | delete?, model? }`
  → `{ id, kind }` — adds a replace/insert/delete suggestion.

Reuses the same `@proof/core` mark factories as the CLI (`createComment`,
`createReplaceSuggestion`, …) so agent and human marks are identical in shape.
The human accepts/rejects suggestions as usual (CLI `accept`/`reject` or the
editor UI).

## Out of scope for v1 (later)
- Direct content rewrite by the agent (v1 = propose via comment/suggest; humans
  apply). A `rewrite` endpoint can come once we want agents editing prose
  directly.
- Presence/events streaming for agents.
- Per-agent identity tokens / rate limiting.

## Build order
1. `agent.ts` — `createAgentApi(hocuspocus, slug, file)` → `{ getState, addComment,
   addSuggestion, stop }` over a reused DirectConnection. (TDD: call methods, assert
   a live client sees the change + the file persists.)
2. Wire `/api/agent/:slug/*` routes + agent-token auth into `serveShare`.
3. `mddocs serve` prints the agent token + a sample curl. (HTTP integration test.)
