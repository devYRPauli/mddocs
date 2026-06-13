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
  dir = await mkdtemp(join(tmpdir(), 'mddocs-agent-'))
  dist = await mkdtemp(join(tmpdir(), 'mddocs-agent-dist-'))
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

describe('M3 agent HTTP API', () => {
  it('an agent comment appears live to a human and persists with ai provenance', async () => {
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

    // Agent reads state over HTTP.
    const state = await (await fetch(`${base}/api/agent/${h.slug}/state`, { headers: agentHeaders })).json()
    expect(state.content).toContain('latency is acceptable')

    // Agent posts a comment.
    const r = await fetch(`${base}/api/agent/${h.slug}/comment`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ quote: 'The latency is acceptable.', text: 'Quantify "acceptable" (ms)?', model: 'claude-opus-4-8' }),
    })
    expect(r.status).toBe(200)
    const { id } = await r.json()
    expect(typeof id).toBe('string')

    // The human sees it live.
    await waitFor(() => doc.getMap('marks').has(id))
    const live = doc.getMap('marks').get(id) as { by: string; data: { text: string } }
    expect(live.by).toBe('ai:claude-opus-4-8')
    expect(live.data.text).toContain('Quantify')

    // And it persists to the file.
    await waitFor(async () => (await readFile(p, 'utf8')).includes('ai:claude-opus-4-8'))
    expect(await readFile(p, 'utf8')).toContain('Quantify')

    provider.destroy()
    socket.destroy()
    await h.stop()
  }, 25000)

  it('agent suggest creates a pending replace; missing token is 403', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nold phrase here.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })
    const base = h.url.replace(/\/d\/.*/, '')

    // No token → 403.
    const denied = await fetch(`${base}/api/agent/${h.slug}/state`)
    expect(denied.status).toBe(403)

    // Suggest with the agent token.
    const r = await fetch(`${base}/api/agent/${h.slug}/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-share-token': h.agentToken },
      body: JSON.stringify({ quote: 'old phrase', replace: 'new phrase', model: 'tester' }),
    })
    expect(r.status).toBe(200)
    const { id, kind } = await r.json()
    expect(kind).toBe('replace')

    await waitFor(async () => (await readFile(p, 'utf8')).includes(id))
    const onDisk = await readFile(p, 'utf8')
    expect(onDisk).toContain('"kind": "replace"')
    expect(onDisk).toContain('ai:tester')

    await h.stop()
  }, 25000)
})
