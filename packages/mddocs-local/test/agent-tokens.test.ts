import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveShare } from '../src/share'

let dir: string
let dist: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-tok-'))
  dist = await mkdtemp(join(tmpdir(), 'mddocs-tok-dist-'))
  await writeFile(join(dist, 'index.html'), '<div id="editor"></div>')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(dist, { recursive: true, force: true })
})

const baseOf = (url: string) => url.replace(/\/d\/.*/, '')

describe('per-agent tokens and rate limiting', () => {
  it('issues a distinct token per named agent and gates each independently', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nsome text.\n')
    const h = await serveShare(p, {
      autocommit: false, distDir: dist, storeDebounceMs: 60,
      agents: [
        { name: 'writer', rateLimit: { maxRequests: 2, windowMs: 5000 } },
        { name: 'reviewer' },
      ],
    })
    const base = baseOf(h.url)

    expect(h.agentTokens).toBeDefined()
    const writer = h.agentTokens!.writer
    const reviewer = h.agentTokens!.reviewer
    expect(writer).toBeTruthy()
    expect(reviewer).toBeTruthy()
    expect(writer).not.toBe(reviewer)
    // Backward compat: agentToken is the first registered agent's token.
    expect(h.agentToken).toBe(writer)

    const state = (tok: string) =>
      fetch(`${base}/api/agent/${h.slug}/state`, { headers: { 'x-share-token': tok } })

    expect((await state('bogus')).status).toBe(403)
    expect((await state(writer)).status).toBe(200) // 1
    expect((await state(writer)).status).toBe(200) // 2
    expect((await state(writer)).status).toBe(429) // 3 -> over the limit
    // reviewer has its own (unlimited) budget, unaffected by writer's usage.
    expect((await state(reviewer)).status).toBe(200)

    await h.stop()
  })

  it("attributes a comment to the agent's name when the body omits model", async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nThe latency is fine.\n')
    const h = await serveShare(p, {
      autocommit: false, distDir: dist, storeDebounceMs: 60,
      agents: [{ name: 'reviewer-bot' }],
    })
    const base = baseOf(h.url)
    const tok = h.agentTokens!['reviewer-bot']

    const r = await fetch(`${base}/api/agent/${h.slug}/comment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-share-token': tok },
      body: JSON.stringify({ quote: 'The latency is fine.', text: 'numbers?' }),
    })
    expect(r.status).toBe(200)
    const { id } = await r.json()

    const s = await (await fetch(`${base}/api/agent/${h.slug}/state`, { headers: { 'x-share-token': tok } })).json()
    expect(s.marks[id].by).toBe('ai:reviewer-bot')

    await h.stop()
  })

  it('keeps the single anonymous token working when no agents are configured', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nhello.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })
    const base = baseOf(h.url)

    expect(h.agentTokens).toBeUndefined()
    expect(h.agentToken).toBeTruthy()
    const ok = await fetch(`${base}/api/agent/${h.slug}/state`, { headers: { 'x-share-token': h.agentToken } })
    expect(ok.status).toBe(200)
    const denied = await fetch(`${base}/api/agent/${h.slug}/state`)
    expect(denied.status).toBe(403)

    await h.stop()
  })
})
