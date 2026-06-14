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
  dir = await mkdtemp(join(tmpdir(), 'mddocs-rewrite-'))
  dist = await mkdtemp(join(tmpdir(), 'mddocs-rewrite-dist-'))
  await writeFile(join(dist, 'index.html'), '<div id="editor"></div>')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(dist, { recursive: true, force: true })
})

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 12000): Promise<void> {
  const start = Date.now()
  while (true) {
    if (await pred()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 40))
  }
}

function join_(h: { host: string; port: number; slug: string }): { doc: Y.Doc; provider: HocuspocusProvider; socket: HocuspocusProviderWebsocket } {
  const doc = new Y.Doc()
  const socket = new HocuspocusProviderWebsocket({ url: `ws://${h.host}:${h.port}`, WebSocketPolyfill: WebSocket as unknown as typeof WebSocket })
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: h.slug, document: doc, token: 'x' })
  return { doc, provider, socket }
}

describe('agent direct-rewrite endpoint', () => {
  it('replaces the whole body live and persists with ai provenance', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Spec\n\nThe latency is acceptable.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })
    const base = h.url.replace(/\/d\/.*/, '')
    const headers = { 'content-type': 'application/json', 'x-share-token': h.agentToken }

    const { doc, provider, socket } = join_(h)
    await waitFor(() => doc.getXmlFragment('prosemirror').toString().includes('latency is acceptable'))

    const r = await fetch(`${base}/api/agent/${h.slug}/rewrite`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ markdown: '# Spec\n\nThe latency is excellent now.\n', model: 'tester' }),
    })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.by).toBe('ai:tester')
    expect(body.chars).toBeGreaterThan(0)

    await waitFor(() => doc.getXmlFragment('prosemirror').toString().includes('excellent now'))
    expect(doc.getXmlFragment('prosemirror').toString()).not.toContain('acceptable')

    await waitFor(async () => (await readFile(p, 'utf8')).includes('excellent now'))
    const onDisk = await readFile(p, 'utf8')
    expect(onDisk).not.toContain('acceptable')
    expect(onDisk).toContain('ai:tester')

    provider.destroy()
    socket.destroy()
    await h.stop()
  }, 25000)

  it('replaces a quoted span and leaves the rest intact', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nThe quick brown fox.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })
    const base = h.url.replace(/\/d\/.*/, '')
    const headers = { 'content-type': 'application/json', 'x-share-token': h.agentToken }

    const { doc, provider, socket } = join_(h)
    await waitFor(() => doc.getXmlFragment('prosemirror').toString().includes('quick brown fox'))

    const r = await fetch(`${base}/api/agent/${h.slug}/rewrite`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ quote: 'quick brown fox', markdown: 'lazy dog', model: 'tester' }),
    })
    expect(r.status).toBe(200)

    await waitFor(async () => (await readFile(p, 'utf8')).includes('lazy dog'))
    const onDisk = await readFile(p, 'utf8')
    expect(onDisk).toContain('The lazy dog.')
    expect(onDisk).not.toContain('quick brown fox')

    provider.destroy()
    socket.destroy()
    await h.stop()
  }, 25000)

  it('400s on a missing markdown body and 404s for a bad quote', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nHello world.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })
    const base = h.url.replace(/\/d\/.*/, '')
    const headers = { 'content-type': 'application/json', 'x-share-token': h.agentToken }

    const { doc, provider, socket } = join_(h)
    await waitFor(() => doc.getXmlFragment('prosemirror').toString().includes('Hello world'))

    const bad = await fetch(`${base}/api/agent/${h.slug}/rewrite`, {
      method: 'POST', headers, body: JSON.stringify({ model: 'tester' }),
    })
    expect(bad.status).toBe(400)

    const noQuote = await fetch(`${base}/api/agent/${h.slug}/rewrite`, {
      method: 'POST', headers,
      body: JSON.stringify({ quote: 'not in the document at all', markdown: 'x', model: 'tester' }),
    })
    expect(noQuote.status).toBe(500)

    provider.destroy()
    socket.destroy()
    await h.stop()
  }, 25000)
})
