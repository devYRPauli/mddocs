import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import { serveShare, type ShareServeHandle } from '../src/share'

let dir: string
let dist: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-sse-'))
  dist = await mkdtemp(join(tmpdir(), 'mddocs-sse-dist-'))
  await writeFile(join(dist, 'index.html'), '<div id="editor"></div>')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(dist, { recursive: true, force: true })
})

function base(h: ShareServeHandle): string {
  return h.url.replace(/\/d\/.*/, '')
}

async function waitFor(pred: () => boolean, timeoutMs = 12000): Promise<void> {
  const start = Date.now()
  while (true) {
    if (pred()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 40))
  }
}

type Frame = { id?: string; event?: string; data?: any }

function openStream(
  h: ShareServeHandle,
  token: string,
  opts: { after?: number; lastEventId?: number } = {},
): Promise<{ res: http.IncomingMessage; req: http.ClientRequest; frames: Frame[] }> {
  const url = new URL(`${base(h)}/api/agent/${h.slug}/events/stream`)
  if (opts.after != null) url.searchParams.set('after', String(opts.after))
  const headers: Record<string, string> = { 'x-share-token': token }
  if (opts.lastEventId != null) headers['last-event-id'] = String(opts.lastEventId)
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const frames: Frame[] = []
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        buf += chunk
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          if (raw.startsWith(':') || raw.trim() === '') continue // heartbeat / comment
          const f: Frame = {}
          for (const line of raw.split('\n')) {
            if (line.startsWith('id:')) f.id = line.slice(3).trim()
            else if (line.startsWith('event:')) f.event = line.slice(6).trim()
            else if (line.startsWith('data:')) f.data = JSON.parse(line.slice(5).trim())
          }
          frames.push(f)
        }
      })
      resolve({ res, req, frames })
    })
    req.on('error', reject)
  })
}

async function pollCursor(h: ShareServeHandle, headers: Record<string, string>): Promise<number> {
  const r = await fetch(`${base(h)}/api/agent/${h.slug}/events/pending?after=0`, { headers })
  const body = await r.json()
  return body.cursor as number
}

describe('agent events SSE stream', () => {
  it('streams document events over SSE as they happen', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Spec\n\nThe latency is acceptable.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60, eventDebounceMs: 40 })
    const headers = { 'content-type': 'application/json', 'x-share-token': h.agentToken }

    const s = await openStream(h, h.agentToken)
    expect(s.res.statusCode).toBe(200)
    expect(String(s.res.headers['content-type'])).toContain('text/event-stream')

    const c = await fetch(`${base(h)}/api/agent/${h.slug}/comment`, {
      method: 'POST', headers,
      body: JSON.stringify({ quote: 'The latency is acceptable.', text: 'Quantify?', model: 'tester' }),
    })
    expect(c.status).toBe(200)

    await waitFor(() => s.frames.some((f) => f.event === 'mark.added' && f.data?.actor === 'ai:tester'))
    const f = s.frames.find((x) => x.event === 'mark.added')!
    expect(f.id).toBe(String(f.data.id)) // SSE id mirrors the event id for Last-Event-ID

    s.req.destroy()
    await h.stop()
  }, 30000)

  it('replays the backlog via ?after and Last-Event-ID, then streams live', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Spec\n\nThe latency is acceptable.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60, eventDebounceMs: 40 })
    const headers = { 'content-type': 'application/json', 'x-share-token': h.agentToken }

    // Create one backlog event.
    await fetch(`${base(h)}/api/agent/${h.slug}/comment`, {
      method: 'POST', headers,
      body: JSON.stringify({ quote: 'The latency is acceptable.', text: 'first', model: 'tester' }),
    })
    const firstId = await pollCursor(h, headers)
    expect(firstId).toBeGreaterThan(0)

    // after=0 replays the backlog event.
    const s1 = await openStream(h, h.agentToken, { after: 0 })
    await waitFor(() => s1.frames.some((f) => Number(f.id) === firstId))
    s1.req.destroy()

    // Last-Event-ID: 0 replays equivalently.
    const s3 = await openStream(h, h.agentToken, { lastEventId: 0 })
    await waitFor(() => s3.frames.some((f) => Number(f.id) === firstId))
    s3.req.destroy()

    // after=firstId does NOT replay the backlog; a new mutation still streams.
    const s2 = await openStream(h, h.agentToken, { after: firstId })
    await fetch(`${base(h)}/api/agent/${h.slug}/comment`, {
      method: 'POST', headers,
      body: JSON.stringify({ quote: 'The latency is acceptable.', text: 'second', model: 'tester' }),
    })
    await waitFor(() => s2.frames.some((f) => f.event === 'mark.added'))
    expect(s2.frames.every((f) => Number(f.id) > firstId)).toBe(true)
    s2.req.destroy()

    await h.stop()
  }, 30000)

  it('rejects an invalid token with 403 and opens no stream', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Spec\n\nbody.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })

    const r = await fetch(`${base(h)}/api/agent/${h.slug}/events/stream`, { headers: { 'x-share-token': 'nope' } })
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(String(body.error)).toMatch(/token/)

    await h.stop()
  }, 20000)
})
