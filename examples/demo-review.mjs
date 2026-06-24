#!/usr/bin/env node
// Demo reviewer agent for the README screencast. It announces presence, reads the
// live document over the agent HTTP API, leaves one pointed comment, and proposes
// one concrete fix (a typo correction) - all attributed to `ai:<model>` and
// visible live in every connected editor. It writes the suggestion id to
// .last-suggestion so the screencast's human step can accept it.
//
// Usage: node examples/demo-review.mjs <agent-base-url> <agent-token> [model]

import { writeFileSync } from 'node:fs'

const [, , baseArg, token, model = 'claude-opus-4-8'] = process.argv
if (!baseArg || !token) {
  console.error('usage: node examples/demo-review.mjs <agent-base-url> <agent-token> [model]')
  process.exit(1)
}
const base = baseArg.replace(/\/$/, '')
const headers = { 'content-type': 'application/json', 'x-share-token': token }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, init) {
  const res = await fetch(`${base}${path}`, { headers, ...init })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

await api('/presence', { method: 'POST', body: JSON.stringify({ status: 'reviewing' }) })
console.log(`ai:${model}  joined the document (reviewing)`)
await sleep(900)

const { content } = await api('/state', { method: 'GET' })
console.log(`ai:${model}  read the live document`)
await sleep(900)

const claim = 'Our new editor is the fastest on the market.'
if (content.includes(claim)) {
  await api('/comment', {
    method: 'POST',
    body: JSON.stringify({
      quote: claim,
      text: 'Unbacked superlative - quantify it or soften the claim before launch.',
      model,
    }),
  })
  console.log(`ai:${model}  commented on the "fastest on the market" claim`)
  await sleep(900)
}

const typo = 'onbaording'
let sid = ''
if (content.includes(typo)) {
  const { id } = await api('/suggest', {
    method: 'POST',
    body: JSON.stringify({ quote: typo, replace: 'onboarding', model }),
  })
  sid = id
  console.log(`ai:${model}  suggested a fix: "${typo}" -> "onboarding"`)
}
if (sid) writeFileSync('.last-suggestion', sid)
console.log(`ai:${model}  done - changes are live and saved to git`)
