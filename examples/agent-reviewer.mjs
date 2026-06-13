#!/usr/bin/env node
// A tiny "reviewer agent" for mddocs. It reads a live document over the M3 agent
// HTTP API and posts review comments (and one suggestion) on its sentences.
// Everything it posts appears in every connected human editor in real time and
// is persisted to the file + git, attributed to `ai:<model>`.
//
// Usage:
//   node examples/agent-reviewer.mjs <agent-base-url> <agent-token> [model]
//
// where <agent-base-url> looks like  http://127.0.0.1:7460/api/agent/notes.md
// and <agent-token> is the token printed by `mddocs serve`.

const [, , baseArg, token, model = 'claude-opus-4-8'] = process.argv

if (!baseArg || !token) {
  console.error('usage: node examples/agent-reviewer.mjs <agent-base-url> <agent-token> [model]')
  console.error('  (copy the base URL + token from the `mddocs serve` output)')
  process.exit(1)
}
const base = baseArg.replace(/\/$/, '')
const headers = { 'content-type': 'application/json', 'x-share-token': token }

// A few review angles the agent rotates through, keyed to what it "notices".
const remarks = [
  (q) => `Can we quantify this? "${q}" reads as a claim without a number.`,
  (q) => `Worth citing a source for: "${q}".`,
  (q) => `Is this still true? Double-check "${q}" before publishing.`,
  (q) => `Consider tightening the wording here: "${q}".`,
]

function sentencesOf(markdown) {
  return markdown
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('<!--'))
    .join(' ')
    .match(/[^.!?]+[.!?]/g)
    ?.map((s) => s.trim())
    .filter((s) => s.length > 12) ?? []
}

async function api(path, init) {
  const res = await fetch(`${base}${path}`, { headers, ...init })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const state = await api('/state', { method: 'GET' })
const sentences = sentencesOf(state.content)
console.log(`agent: read ${sentences.length} sentence(s) from the live document.`)
if (sentences.length === 0) {
  console.log('agent: nothing to review (empty document).')
  process.exit(0)
}

// Comment on up to the first 3 sentences, pausing so a human watching the editor
// sees them pop in one at a time.
for (let i = 0; i < Math.min(3, sentences.length); i++) {
  const quote = sentences[i]
  const text = remarks[i % remarks.length](quote.length > 40 ? quote.slice(0, 40) + '…' : quote)
  const { id } = await api('/comment', { method: 'POST', body: JSON.stringify({ quote, text, model }) })
  console.log(`agent: commented on sentence ${i + 1} (${id})`)
  await sleep(1500)
}

// And propose one concrete edit on the first sentence.
const target = sentences[0]
const { id, kind } = await api('/suggest', {
  method: 'POST',
  body: JSON.stringify({ quote: target, replace: target.replace(/\.$/, ' (revised).'), model }),
})
console.log(`agent: proposed a ${kind} suggestion on sentence 1 (${id})`)
console.log('agent: done — check the editor; the comments/suggestion should be live.')
