import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { dirname, join, normalize, resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { configureCollab, type CollabServerOptions } from './collab'
import { loadDoc } from './doc'

export interface ShareServeOptions extends CollabServerOptions {
  host?: string
  distDir?: string
}

export type ShareRole = 'editor' | 'commenter' | 'viewer'
export interface ShareCapabilities { canRead: boolean; canComment: boolean; canEdit: boolean }

export interface ShareServeHandle {
  /** The edit link — what `mddocs serve` opens for the host. */
  url: string
  /** Tokenized links per role; share the one matching the access you want to grant. */
  links: Record<ShareRole, string>
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

const DEFAULT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../../dist')

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

// Boot a single-port live-collaboration host: static editor bundle, the minimal
// no-auth share bootstrap the editor needs to enter collab mode, and the
// Hocuspocus WebSocket (attached to this server's upgrade). The editor's
// HocuspocusProvider connects back to this same origin. See SPIKE-collab.md.
export async function serveShare(file: string, opts: ShareServeOptions = {}): Promise<ShareServeHandle> {
  const host = opts.host ?? '127.0.0.1'
  const distDir = opts.distDir ?? DEFAULT_DIST
  const { hocuspocus, session, slug } = await configureCollab(file, opts)
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
        // fetchOpenContext: doc + session + capabilities → collabClient.connect).
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
    host,
    port: boundPort,
    slug,
    async stop() {
      await hocuspocus.destroy()
      await session.stop()
      wss.close()
      await new Promise<void>((r) => server.close(() => r()))
    },
  }
}
