import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { serveShare, type ShareServeHandle } from '../src/share'

let dir: string
let dist: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-events-'))
  dist = await mkdtemp(join(tmpdir(), 'mddocs-events-dist-'))
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

type AgentEvent = {
  id: number
  type: string
  data: Record<string, unknown>
  actor: string
  createdAt: string
  ackedAt?: string
  ackedBy?: string
}

function base(h: ShareServeHandle): string {
  return h.url.replace(/\/d\/.*/, '')
}

function join_(
  h: ShareServeHandle,
  token: string,
): { doc: Y.Doc; provider: HocuspocusProvider; socket: HocuspocusProviderWebsocket } {
  const doc = new Y.Doc()
  const socket = new HocuspocusProviderWebsocket({
    url: `ws://${h.host}:${h.port}`,
    WebSocketPolyfill: WebSocket as unknown as typeof WebSocket,
  })
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: h.slug, document: doc, token })
  return { doc, provider, socket }
}

async function pollEvents(h: ShareServeHandle, headers: Record<string, string>, after = 0): Promise<{ events: AgentEvent[]; cursor: number }> {
  const r = await fetch(`${base(h)}/api/agent/${h.slug}/events/pending?after=${after}`, { headers })
  expect(r.status).toBe(200)
  return r.json()
}

describe('agent presence + events', () => {
  it('registers and disconnects agent presence, and reflects it in state', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Spec\n\nThe latency is acceptable.\n')
    // Identity is bound to the agent token, so name the agent 'reviewer'.
    const h = await serveShare(p, {
      autocommit: false,
      distDir: dist,
      storeDebounceMs: 60,
      agents: [{ name: 'reviewer' }],
    })
    const headers = { 'content-type': 'application/json', 'x-share-token': h.agentToken }

    // A client-supplied id is ignored; the registered id is the token's ai:<name>.
    const reg = await fetch(`${base(h)}/api/agent/${h.slug}/presence`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'ai:impostor', status: 'reviewing', details: 'reading the spec' }),
    })
    expect(reg.status).toBe(200)
    const regBody = await reg.json()
    expect(regBody.success).toBe(true)
    expect(Array.isArray(regBody.presence)).toBe(true)
    expect(regBody.presence.some((e: { id: string }) => e.id === 'ai:reviewer')).toBe(true)
    // The spoofed id must not appear.
    expect(regBody.presence.some((e: { id: string }) => e.id === 'ai:impostor')).toBe(false)

    // State exposes who is present.
    const st = await fetch(`${base(h)}/api/agent/${h.slug}/state`, { headers })
    const stBody = await st.json()
    expect(stBody.presence.some((e: { id: string; status: string }) => e.id === 'ai:reviewer' && e.status === 'reviewing')).toBe(true)

    // A presence registration emits a pollable event attributed to the token.
    const { events } = await pollEvents(h, headers)
    expect(events.some((e) => e.type === 'agent.presence' && e.actor === 'ai:reviewer')).toBe(true)

    // Disconnect removes the caller's own presence (no client-supplied id needed).
    const dis = await fetch(`${base(h)}/api/agent/${h.slug}/presence/disconnect`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })
    expect(dis.status).toBe(200)
    const disBody = await dis.json()
    expect(disBody.disconnected).toBe(true)
    expect(disBody.agentId).toBe('ai:reviewer')

    const st2 = await fetch(`${base(h)}/api/agent/${h.slug}/state`, { headers })
    const stBody2 = await st2.json()
    expect(stBody2.presence.some((e: { id: string }) => e.id === 'ai:reviewer')).toBe(false)

    await h.stop()
  }, 25000)

  it('surfaces agent and human activity as pollable events with cursor + ack', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Spec\n\nThe latency is acceptable.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60, eventDebounceMs: 40 })
    const headers = { 'content-type': 'application/json', 'x-share-token': h.agentToken }

    // Agent comment -> mark.added event attributed to the agent.
    const c = await fetch(`${base(h)}/api/agent/${h.slug}/comment`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ quote: 'The latency is acceptable.', text: 'Quantify?', model: 'tester' }),
    })
    expect(c.status).toBe(200)

    await waitFor(async () => {
      const { events } = await pollEvents(h, headers)
      return events.some((e) => e.type === 'mark.added' && e.data.kind === 'comment' && e.actor === 'ai:tester')
    })

    // Human (editor) writes a mark on the shared doc -> mark.added attributed to the human.
    const editorToken = new URL(h.links.editor).searchParams.get('token') as string
    const { doc, provider, socket } = join_(h, editorToken)
    await waitFor(() => provider.synced)
    doc.transact(() => {
      doc.getMap('marks').set('m-human-1', {
        id: 'm-human-1',
        kind: 'comment',
        by: 'human:alice',
        quote: 'Spec',
        data: { text: 'looks good' },
      })
    })

    await waitFor(async () => {
      const { events } = await pollEvents(h, headers)
      return events.some((e) => e.type === 'mark.added' && e.actor === 'human:alice')
    })

    // Agent rewrite changes the prose -> document.changed event.
    const rw = await fetch(`${base(h)}/api/agent/${h.slug}/rewrite`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ markdown: '# Spec\n\nThe latency is excellent now.\n', model: 'tester' }),
    })
    expect(rw.status).toBe(200)
    await waitFor(async () => {
      const { events } = await pollEvents(h, headers)
      return events.some((e) => e.type === 'document.changed')
    })

    // Cursor: polling after the last id returns nothing new.
    const all = await pollEvents(h, headers)
    expect(all.events.length).toBeGreaterThan(0)
    const tail = await pollEvents(h, headers, all.cursor)
    expect(tail.events.length).toBe(0)

    // Ack up to the cursor marks events acknowledged. A client-supplied `by` is
    // ignored; the ack actor is the authenticated token (default name 'agent').
    const ack = await fetch(`${base(h)}/api/agent/${h.slug}/events/ack`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ upToId: all.cursor, by: 'ai:impostor' }),
    })
    expect(ack.status).toBe(200)
    const ackBody = await ack.json()
    expect(ackBody.acked).toBeGreaterThan(0)

    const after = await pollEvents(h, headers)
    expect(after.events.every((e) => e.id > all.cursor || (e.ackedAt && e.ackedBy === 'ai:agent'))).toBe(true)

    provider.destroy()
    socket.destroy()
    await h.stop()
  }, 30000)
})
