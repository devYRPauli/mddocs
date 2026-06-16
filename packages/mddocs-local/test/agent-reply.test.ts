import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { serveShare } from '../src/share'

let dir: string
let dist: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-reply-'))
  dist = await mkdtemp(join(tmpdir(), 'mddocs-reply-dist-'))
  await writeFile(join(dist, 'index.html'), '<div id="editor"></div>')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(dist, { recursive: true, force: true })
})

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 12000): Promise<void> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await pred()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 40))
  }
}

describe('agent HTTP API: threaded comment replies', () => {
  it('an agent reply appends to a comment thread, is seen live, and persists', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Spec\n\nThe latency is acceptable.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })
    const base = h.url.replace(/\/d\/.*/, '')
    const agentHeaders = { 'content-type': 'application/json', 'x-share-token': h.agentToken }

    // A human editor joins.
    const doc = new Y.Doc()
    const socket = new HocuspocusProviderWebsocket({ url: `ws://${h.host}:${h.port}`, WebSocketPolyfill: WebSocket as unknown as typeof WebSocket })
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: h.slug, document: doc, token: 'x' })
    await waitFor(() => doc.getXmlFragment('prosemirror').toString().includes('latency is acceptable'))

    // Agent opens a comment thread.
    const c = await fetch(`${base}/api/agent/${h.slug}/comment`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ quote: 'The latency is acceptable.', text: 'Quantify "acceptable" (ms)?', model: 'claude-opus-4-8' }),
    })
    const { id } = await c.json()
    await waitFor(() => doc.getMap('marks').has(id))

    // Agent replies into that thread.
    const r = await fetch(`${base}/api/agent/${h.slug}/reply`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ id, text: 'Target is under 200ms p95.', model: 'claude-opus-4-8' }),
    })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.id).toBe(id)
    expect(body.replies).toBe(1)

    // The human sees the reply live on the same comment mark.
    await waitFor(() => {
      const m = doc.getMap('marks').get(id) as { data?: { replies?: Array<{ text: string; by: string }> } } | undefined
      return (m?.data?.replies?.length ?? 0) === 1
    })
    const live = doc.getMap('marks').get(id) as { data: { replies: Array<{ text: string; by: string }> } }
    expect(live.data.replies[0].text).toBe('Target is under 200ms p95.')
    expect(live.data.replies[0].by).toBe('ai:claude-opus-4-8')

    // And it persists to the file.
    await waitFor(async () => (await readFile(p, 'utf8')).includes('Target is under 200ms p95.'))

    provider.destroy()
    socket.destroy()
    await h.stop()
  }, 25000)

  it('rejects a reply to a missing comment (404) and bad input (400)', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nbody.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })
    const base = h.url.replace(/\/d\/.*/, '')
    const agentHeaders = { 'content-type': 'application/json', 'x-share-token': h.agentToken }

    const missing = await fetch(`${base}/api/agent/${h.slug}/reply`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ id: 'does-not-exist', text: 'hi' }),
    })
    expect(missing.status).toBe(404)

    const bad = await fetch(`${base}/api/agent/${h.slug}/reply`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ id: 'x' }),
    })
    expect(bad.status).toBe(400)

    await h.stop()
  }, 25000)
})
