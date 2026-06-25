#!/usr/bin/env node
// A tiny "watcher agent" for mddocs. It subscribes to a live document's event
// stream over the agent HTTP API (Server-Sent Events) and prints every change -
// human edits in the browser AND other agents' mutations - the instant it
// happens, instead of polling. This is the push counterpart to the poll-based
// agent-reviewer.mjs.
//
// Usage:
//   node examples/agent-watcher.mjs <agent-base-url> <agent-token> [--after <id>]
//
// where <agent-base-url> looks like  http://127.0.0.1:7460/api/agent/notes.md
// and <agent-token> is the token printed by `mddocs serve`.
//
//   --after <id>   replay events newer than <id> from the in-memory backlog
//                  before streaming live (default: live only, from now).
//
// The watcher reconnects automatically if the connection drops, resuming from
// the last event id it saw (via the standard Last-Event-ID header) so no event
// in the buffer is missed across a reconnect. Ctrl-C to stop.

const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith('--'))
const afterFlagIndex = args.indexOf('--after')
const afterArg = afterFlagIndex >= 0 ? args[afterFlagIndex + 1] : undefined
const [baseArg, token] = positional

if (!baseArg || !token) {
  console.error('usage: node examples/agent-watcher.mjs <agent-base-url> <agent-token> [--after <id>]')
  console.error('  (copy the base URL + token from the `mddocs serve` output)')
  process.exit(1)
}
const base = baseArg.replace(/\/$/, '')
const headers = { 'x-share-token': token }

// Track the last event id we have seen so a reconnect resumes exactly where we
// left off. Seeded from --after (0 = the whole backlog) when provided.
let lastId = afterArg !== undefined ? Math.max(0, Number.parseInt(afterArg, 10) || 0) : undefined

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Render one event as a single readable line. The `data` payload is the same
// DocEvent shape the poll endpoint (events/pending) returns.
function printEvent(e) {
  const detail =
    e.type.startsWith('mark.') ? `${e.data.kind ?? 'mark'} ${e.data.markId ?? ''}${e.data.status ? ` [${e.data.status}]` : ''}`
    : e.type === 'document.changed' ? `${e.data.chars ?? '?'} chars`
    : e.type.startsWith('agent.') ? `${e.data.status ?? ''}`
    : ''
  console.log(`#${e.id}  ${e.type.padEnd(16)} by ${e.actor.padEnd(20)} ${detail}`.trimEnd())
}

// Parse a raw SSE frame ("id: ..\nevent: ..\ndata: ..") into the event object.
// Comment frames (": ping") are heartbeats and are ignored by the caller.
function parseFrame(raw) {
  if (raw.startsWith(':') || raw.trim() === '') return undefined
  let id, data
  for (const line of raw.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('data:')) data = line.slice(5).trim()
  }
  if (!data) return undefined
  try {
    return { sseId: id, event: JSON.parse(data) }
  } catch {
    return undefined
  }
}

async function streamOnce() {
  // ?after seeds the first connection from the backlog; Last-Event-ID resumes a
  // reconnect from the last id we saw. The server honors either.
  const q = lastId !== undefined ? `?after=${lastId}` : ''
  const reqHeaders = { ...headers }
  if (lastId !== undefined) reqHeaders['last-event-id'] = String(lastId)

  const res = await fetch(`${base}/events/stream${q}`, { headers: reqHeaders })
  if (res.status === 403) {
    console.error('watcher: 403 - invalid or missing agent token.')
    process.exit(1)
  }
  if (!res.ok || !res.body) throw new Error(`events/stream -> ${res.status}`)
  console.log(`watcher: connected${lastId !== undefined ? ` (resuming after #${lastId})` : ''}; waiting for changes...`)

  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const parsed = parseFrame(raw)
      if (!parsed) continue
      printEvent(parsed.event)
      lastId = parsed.event.id // advance the cursor so a reconnect resumes here
    }
  }
}

process.on('SIGINT', () => {
  console.log('\nwatcher: stopped.')
  process.exit(0)
})

// Reconnect loop: if the stream ends or errors, resume from the last id seen.
// A fresh connect with lastId still undefined would re-read live-only; once we
// have seen any event, lastId is set and the reconnect replays the gap.
while (true) {
  try {
    await streamOnce()
    console.log('watcher: stream ended; reconnecting...')
  } catch (err) {
    console.error(`watcher: ${err.message}; reconnecting in 1s...`)
    await sleep(1000)
  }
}
