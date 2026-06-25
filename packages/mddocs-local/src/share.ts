import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { dirname, join, normalize, resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { configureCollab, type CollabServerOptions } from './collab'
import { createAgentApi } from './agent'
import { createEventLog, createPresenceRegistry, observeDocForEvents, type DocEvent } from './events'
import { loadDoc } from './doc'

export interface AgentRateLimit {
  /** Max requests allowed within the rolling window before HTTP 429. */
  maxRequests: number
  /** Window length in milliseconds. */
  windowMs: number
}

export interface AgentConfig {
  /** Identity used for `ai:<name>` provenance when a request omits `model`. */
  name: string
  /** Optional per-agent rate limit. When omitted, the agent is unlimited. */
  rateLimit?: AgentRateLimit
}

export interface ShareServeOptions extends CollabServerOptions {
  host?: string
  distDir?: string
  /**
   * Named agents, each issued its own token. When omitted, a single anonymous
   * agent token is generated (backward compatible).
   */
  agents?: AgentConfig[]
  /**
   * Debounce (ms) for coalescing dense prose edits into one `document.changed`
   * event. Defaults to 150ms.
   */
  eventDebounceMs?: number
}

export type ShareRole = 'editor' | 'commenter' | 'viewer'
export interface ShareCapabilities { canRead: boolean; canComment: boolean; canEdit: boolean }

export interface ShareServeHandle {
  /** The edit link - what `mddocs serve` opens for the host. */
  url: string
  /** Tokenized links per role; share the one matching the access you want to grant. */
  links: Record<ShareRole, string>
  /** Token authorizing the agent HTTP API (sent as x-share-token to /api/agent/*). */
  agentToken: string
  /** Per-agent tokens (name -> token) when `opts.agents` was provided. */
  agentTokens?: Record<string, string>
  host: string
  port: number
  slug: string
  stop(): Promise<void>
}

const CAPABILITIES: Record<ShareRole, ShareCapabilities> = {
  editor: { canRead: true, canComment: true, canEdit: true },
  commenter: { canRead: true, canComment: true, canEdit: false },
  viewer: { canRead: true, canComment: false, canEdit: false },
}

const DEFAULT_DIST = process.env.MDDOCS_DIST ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../dist')

// Matches EventLog MAX_EVENTS: the most backlog we replay on stream (re)connect.
const STREAM_REPLAY_LIMIT = 2000

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

function contentTypeFor(p: string): string {
  const dot = p.lastIndexOf('.')
  return (dot >= 0 && CONTENT_TYPES[p.slice(dot)]) || 'application/octet-stream'
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      try { resolveBody(data ? (JSON.parse(data) as Record<string, unknown>) : {}) }
      catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

// Boot a single-port live-collaboration host: static editor bundle, the minimal
// no-auth share bootstrap the editor needs to enter collab mode, and the
// Hocuspocus WebSocket (attached to this server's upgrade). The editor's
// HocuspocusProvider connects back to this same origin. See SPIKE-collab.md.
export async function serveShare(file: string, opts: ShareServeOptions = {}): Promise<ShareServeHandle> {
  const host = opts.host ?? '127.0.0.1'
  const distDir = opts.distDir ?? DEFAULT_DIST
  let boundPort = opts.port ?? 0

  // Per-role share tokens. The host opens the editor link; sharing the comment
  // or view link grants only that role. An absent/unknown token gets the least
  // privilege (viewer), so a leaked bare URL can't edit.
  const tokens: Record<ShareRole, string> = {
    editor: randomUUID(),
    commenter: randomUUID(),
    viewer: randomUUID(),
  }
  function roleForToken(token: string | undefined): ShareRole {
    if (token === tokens.editor) return 'editor'
    if (token === tokens.commenter) return 'commenter'
    return 'viewer'
  }
  function tokenFromRequest(req: IncomingMessage): string | undefined {
    const h = req.headers['x-share-token']
    if (typeof h === 'string') return h
    const q = (req.url ?? '').split('?')[1]
    return q ? new URLSearchParams(q).get('token') ?? undefined : undefined
  }

  // Separate tokens authorize the agent HTTP API (M3). They are not WebSocket
  // roles - they gate /api/agent/* programmatic access. Each named agent gets
  // its own token; with no agents configured we issue a single anonymous one so
  // the simple case (and existing callers) keep working.
  interface AgentEntry { name: string; token: string; rateLimit?: AgentRateLimit }
  const agentEntries: AgentEntry[] =
    opts.agents && opts.agents.length > 0
      ? opts.agents.map((a) => ({ name: a.name, token: randomUUID(), rateLimit: a.rateLimit }))
      : [{ name: 'agent', token: randomUUID() }]
  const agentToken = agentEntries[0].token
  const agentByToken = new Map<string, AgentEntry>(agentEntries.map((e) => [e.token, e]))

  // In-memory rolling-window rate limiter, keyed by token. Discarded on stop().
  const rateHits = new Map<string, number[]>()
  function withinRateLimit(entry: AgentEntry): boolean {
    if (!entry.rateLimit) return true
    const { maxRequests, windowMs } = entry.rateLimit
    const now = Date.now()
    const recent = (rateHits.get(entry.token) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= maxRequests) {
      rateHits.set(entry.token, recent)
      return false
    }
    recent.push(now)
    rateHits.set(entry.token, recent)
    return true
  }

  // Standard X-RateLimit-* headers so agents can self-throttle instead of being
  // surprised by a 429. Read the limiter's current state for this token without
  // mutating it; no-op when the agent has no rate limit configured. Call after
  // withinRateLimit so the counts reflect the request just recorded. On a 429 we
  // also add Retry-After (seconds until the window frees a slot).
  function applyRateHeaders(res: ServerResponse, entry: AgentEntry, limited = false): void {
    if (!entry.rateLimit) return
    const { maxRequests, windowMs } = entry.rateLimit
    const now = Date.now()
    const recent = (rateHits.get(entry.token) ?? []).filter((t) => now - t < windowMs)
    const remaining = Math.max(0, maxRequests - recent.length)
    const resetMs = recent.length > 0 ? recent[0] + windowMs : now
    res.setHeader('X-RateLimit-Limit', String(maxRequests))
    res.setHeader('X-RateLimit-Remaining', String(remaining))
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetMs / 1000)))
    if (limited) res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetMs - now) / 1000))))
  }

  // Server-side write enforcement: a viewer's WebSocket connection is readOnly,
  // so Hocuspocus drops its document updates even if a crafted client tries to
  // write. Commenters/editors keep write access (a comment is itself a write);
  // the comment-vs-edit split is gated in the editor UI via capabilities.
  const { hocuspocus, session, slug } = await configureCollab(file, {
    ...opts,
    authenticate: (token) => {
      const role = roleForToken(token)
      return { readOnly: role === 'viewer', role }
    },
  })

  // M3: agent operations inject into the live doc via a Hocuspocus DirectConnection.
  const agent = createAgentApi(hocuspocus, slug)

  // Presence + events: agents announce activity (presence) and poll for what
  // humans and other agents did (events). A dedicated direct connection gives us
  // the canonical live Y.Doc - the same instance every browser editor and agent
  // mutation touches - so observing it surfaces all activity as pollable events.
  const eventLog = createEventLog()
  const presence = createPresenceRegistry()
  const obsConn = await hocuspocus.openDirectConnection(slug)
  const disposeObserve = obsConn.document
    ? observeDocForEvents(obsConn.document, eventLog, { debounceMs: opts.eventDebounceMs })
    : () => {}

  async function serveStatic(urlPath: string, res: ServerResponse): Promise<void> {
    // The bare /d/:slug document route serves the editor shell (SPA). Asset
    // requests resolve relative to that route (e.g. /d/assets/editor.js), so we
    // strip the /d/ prefix and serve them from dist. Anything else is a plain
    // dist asset.
    const isDocRoute = urlPath === '/' || /^\/d\/[^/]+\/?$/.test(urlPath)
    const rel = isDocRoute
      ? 'index.html'
      : urlPath.replace(/^\/d\//, '').replace(/^\/+/, '')
    const target = normalize(join(distDir, rel))
    if (target !== distDir && !target.startsWith(distDir + '/')) {
      res.writeHead(403).end('Forbidden')
      return
    }
    try {
      const buf = await readFile(target)
      res.writeHead(200, { 'content-type': contentTypeFor(target) })
      res.end(buf)
    } catch {
      res.writeHead(404).end('Not found')
    }
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const urlPath = (req.url ?? '/').split('?')[0]
        if (process.env.MDDOCS_DEBUG) console.error('[req]', req.method, req.url)

        // The editor fetches this once to enter collab mode. One response carries
        // the document, the collab session, and capabilities (see share-client
        // fetchOpenContext: doc + session + capabilities -> collabClient.connect).
        if (urlPath === `/api/documents/${slug}/open-context` && req.method === 'GET') {
          const { content, marks } = await loadDoc(file)
          const role = roleForToken(tokenFromRequest(req))
          const collabWsUrl = `ws://${host}:${boundPort}`
          sendJson(res, 200, {
            success: true,
            collabAvailable: true,
            doc: { slug, title: slug, markdown: content, marks, viewers: 0 },
            session: {
              docId: slug,
              slug,
              role,
              shareState: 'ACTIVE',
              accessEpoch: 1,
              syncProtocol: 'pm-yjs-v1',
              collabWsUrl,
              token: tokens[role],
              snapshotVersion: 1,
            },
            capabilities: CAPABILITIES[role],
          })
          return
        }

        // M3 agent HTTP API - authorized by a per-agent token (x-share-token).
        // The matched agent's name is the default `ai:<model>` identity when a
        // request omits `model`.
        if (urlPath.startsWith(`/api/agent/${slug}/`)) {
          const entry = agentByToken.get(tokenFromRequest(req) ?? '')
          if (!entry) {
            sendJson(res, 403, { error: 'invalid or missing agent token' })
            return
          }
          if (!withinRateLimit(entry)) {
            applyRateHeaders(res, entry, true)
            sendJson(res, 429, { error: 'rate limit exceeded', agent: entry.name })
            return
          }
          // Reflect the rate-limit state on every agent API response so callers
          // can self-throttle before hitting the 429.
          applyRateHeaders(res, entry)
          const modelFrom = (b: Record<string, unknown>) => (b.model as string | undefined) ?? entry.name
          if (urlPath === `/api/agent/${slug}/state` && req.method === 'GET') {
            sendJson(res, 200, { ...(await agent.getState()), presence: presence.list() })
            return
          }
          if (urlPath === `/api/agent/${slug}/comment` && req.method === 'POST') {
            const b = await readJsonBody(req)
            if (typeof b.quote !== 'string' || typeof b.text !== 'string') {
              sendJson(res, 400, { error: 'comment needs { quote, text }' })
              return
            }
            sendJson(res, 200, await agent.addComment({ quote: b.quote, text: b.text, model: modelFrom(b) }))
            return
          }
          if (urlPath === `/api/agent/${slug}/reply` && req.method === 'POST') {
            const b = await readJsonBody(req)
            if (typeof b.id !== 'string' || typeof b.text !== 'string') {
              sendJson(res, 400, { error: 'reply needs { id, text }' })
              return
            }
            try {
              sendJson(res, 200, await agent.reply({ id: b.id, text: b.text, model: modelFrom(b) }))
            } catch (e) {
              const err = e as Error & { code?: string }
              if (err.code === 'NOT_FOUND') sendJson(res, 404, { error: err.message })
              else throw err
            }
            return
          }
          if (urlPath === `/api/agent/${slug}/suggest` && req.method === 'POST') {
            const b = await readJsonBody(req)
            if (typeof b.quote !== 'string') {
              sendJson(res, 400, { error: 'suggest needs { quote, replace|insert|delete }' })
              return
            }
            sendJson(res, 200, await agent.addSuggestion({
              quote: b.quote,
              replace: b.replace as string | undefined,
              insert: b.insert as string | undefined,
              delete: b.delete as boolean | undefined,
              model: modelFrom(b),
            }))
            return
          }
          if (urlPath === `/api/agent/${slug}/rewrite` && req.method === 'POST') {
            const b = await readJsonBody(req)
            if (typeof b.markdown !== 'string') {
              sendJson(res, 400, { error: 'rewrite needs { markdown, quote? }' })
              return
            }
            sendJson(res, 200, await agent.rewrite({
              markdown: b.markdown,
              quote: typeof b.quote === 'string' ? b.quote : undefined,
              model: modelFrom(b),
            }))
            return
          }
          // Presence: announce the agent is active on the doc (status/details),
          // visible to other agents via /state and as an agent.presence event.
          // Identity is bound to the authenticated token (`ai:<name>`), never to
          // a client-supplied id, so an agent cannot impersonate another's
          // presence or forge the event actor. Display fields (name/status/
          // details) are caller-controlled; identity is not.
          const selfId = `ai:${entry.name}`
          if (urlPath === `/api/agent/${slug}/presence` && req.method === 'POST') {
            const b = await readJsonBody(req)
            const at = new Date().toISOString()
            const ent = presence.upsert({
              id: selfId,
              name: typeof b.name === 'string' ? b.name : entry.name,
              color: typeof b.color === 'string' ? b.color : undefined,
              avatar: typeof b.avatar === 'string' ? b.avatar : undefined,
              status: typeof b.status === 'string' && b.status.trim() ? b.status.trim() : 'idle',
              details:
                typeof b.details === 'string'
                  ? b.details
                  : typeof b.summary === 'string'
                    ? b.summary
                    : '',
              at,
            })
            eventLog.add('agent.presence', { ...ent }, selfId)
            sendJson(res, 200, { success: true, slug, presence: presence.list() })
            return
          }
          // Disconnect removes only this token's own presence; the event actor is
          // the authenticated identity. No cross-agent disconnect.
          if (urlPath === `/api/agent/${slug}/presence/disconnect` && req.method === 'POST') {
            const b = await readJsonBody(req)
            const removed = presence.remove(selfId)
            eventLog.add(
              'agent.disconnected',
              { id: selfId, status: 'disconnected', details: typeof b.details === 'string' ? b.details : '', at: new Date().toISOString() },
              selfId,
            )
            sendJson(res, 200, { success: true, slug, agentId: selfId, disconnected: true, removed })
            return
          }
          // Events (push): stream events over SSE instead of polling. Honors
          // `?after=<id>` or the standard Last-Event-ID header to replay the
          // in-memory backlog on (re)connect, then pushes live events as they
          // are logged. Coexists with events/pending. The auth + rate-limit gate
          // above already ran (bad token never reaches here; X-RateLimit-* are
          // set and merged into writeHead), and opening a stream is one request.
          if (urlPath === `/api/agent/${slug}/events/stream` && req.method === 'GET') {
            const q = (req.url ?? '').split('?')[1]
            const params = new URLSearchParams(q ?? '')
            const lastEventId = req.headers['last-event-id']
            const afterRaw = params.get('after') ?? (typeof lastEventId === 'string' ? lastEventId : '')
            let lastSent = Math.max(0, Number.parseInt(afterRaw, 10) || 0)

            res.writeHead(200, {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-cache, no-transform',
              connection: 'keep-alive',
              'x-accel-buffering': 'no',
            })

            const send = (e: DocEvent): void => {
              if (e.id <= lastSent) return
              lastSent = e.id
              res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
            }
            // Subscribe first, then drain the backlog synchronously: with no await
            // between the two, no live event can interleave, and the id<=lastSent
            // guard dedups any overlap.
            const unsubscribe = eventLog.subscribe(send)
            for (const e of eventLog.list(lastSent, STREAM_REPLAY_LIMIT)) send(e)

            const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000)
            const cleanup = (): void => {
              clearInterval(heartbeat)
              unsubscribe()
            }
            res.on('close', cleanup)
            return
          }
          // Events: poll for activity newer than `after` (the previous cursor),
          // then ack up to a cursor once handled. Captures human + agent edits.
          if (urlPath === `/api/agent/${slug}/events/pending` && req.method === 'GET') {
            const q = (req.url ?? '').split('?')[1]
            const params = new URLSearchParams(q ?? '')
            const after = Math.max(0, Number.parseInt(params.get('after') ?? '0', 10) || 0)
            const rawLimit = Number.parseInt(params.get('limit') ?? '100', 10)
            const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100
            const events = eventLog.list(after, limit)
            sendJson(res, 200, {
              success: true,
              events,
              cursor: events.length > 0 ? events[events.length - 1].id : after,
            })
            return
          }
          if (urlPath === `/api/agent/${slug}/events/ack` && req.method === 'POST') {
            const b = await readJsonBody(req)
            const upToId = typeof b.upToId === 'number' ? b.upToId : Number.NaN
            if (!Number.isFinite(upToId) || upToId < 0) {
              sendJson(res, 400, { error: 'ack needs { upToId }' })
              return
            }
            // The ack actor is the authenticated identity, not a client-supplied
            // label, so the audit trail cannot be forged.
            sendJson(res, 200, { success: true, acked: eventLog.ack(Math.trunc(upToId), selfId) })
            return
          }
          sendJson(res, 404, { error: 'unknown agent endpoint' })
          return
        }

        await serveStatic(urlPath, res)
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message })
      }
    })()
  })

  // Attach Hocuspocus to this server's WebSocket upgrade (single port).
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      hocuspocus.handleConnection(ws, request)
    })
  })

  await new Promise<void>((r) => server.listen(opts.port ?? 0, host, r))
  const a = server.address()
  boundPort = typeof a === 'object' && a ? a.port : boundPort

  const linkFor = (role: ShareRole) =>
    `http://${host}:${boundPort}/d/${encodeURIComponent(slug)}?token=${tokens[role]}`
  const links: Record<ShareRole, string> = {
    editor: linkFor('editor'),
    commenter: linkFor('commenter'),
    viewer: linkFor('viewer'),
  }

  return {
    url: links.editor,
    links,
    agentToken,
    agentTokens: opts.agents
      ? Object.fromEntries(agentEntries.map((e) => [e.name, e.token]))
      : undefined,
    host,
    port: boundPort,
    slug,
    async stop() {
      disposeObserve()
      await obsConn.disconnect()
      await agent.stop()
      await hocuspocus.destroy()
      await session.stop()
      wss.close()
      await new Promise<void>((r) => server.close(() => r()))
    },
  }
}
