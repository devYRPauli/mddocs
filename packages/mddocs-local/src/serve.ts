import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, normalize, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { saveDoc } from './doc'
import { extractMarks } from './proof'
import { reanchorMarks } from './reanchor'
import { commitFile, isGitRepo } from './git'
import type { StoredMark } from './proof'

export interface SessionOptions {
  autocommit?: boolean
  debounceMs?: number
}

export interface Session {
  // Handle a raw PUT /api/file body. The editor sends one markdown string with
  // marks already embedded (via @proof/core embedMarks); we extract, reanchor,
  // and persist atomically, then optionally debounce-commit.
  applyContent(raw: string): Promise<void>
  // Current on-disk content for GET /api/file (raw, marks embedded). '' if absent.
  readContent(): Promise<string>
  stop(): Promise<void>
}

async function readRaw(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

export async function createSession(path: string, opts: SessionOptions = {}): Promise<Session> {
  const debounceMs = opts.debounceMs ?? 400
  const canCommit = opts.autocommit ? await isGitRepo(dirname(path)) : false
  let commitTimer: NodeJS.Timeout | undefined

  async function applyContent(raw: string): Promise<void> {
    const { content, marks } = extractMarks(raw)
    const { marks: reanchored } = reanchorMarks(
      content,
      (marks ?? {}) as Record<string, StoredMark>,
    )
    await saveDoc(path, content, reanchored)
    if (canCommit) {
      if (commitTimer) clearTimeout(commitTimer)
      commitTimer = setTimeout(() => {
        void commitFile(path, `mddocs: edit ${basename(path)}`).catch(() => undefined)
      }, debounceMs)
    }
  }

  return {
    applyContent,
    readContent: () => readRaw(path),
    async stop() {
      if (commitTimer) clearTimeout(commitTimer)
    },
  }
}

export interface ServeOptions extends SessionOptions {
  port?: number
  distDir?: string
}

export interface ServeHandle {
  url: string
  port: number
  stop(): Promise<void>
  server: Server
}

// Repo-root dist/ holds the pre-built @proof/editor IIFE (see SPIKE-editor.md).
const DEFAULT_DIST = process.env.MDDOCS_DIST ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../dist')

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolveBody(data))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

// Boot the local editor host: static dist + the three /api routes the editor's
// CLI mode (?apiPort=) drives. No browser is opened here - callers do that.
export async function serve(path: string, opts: ServeOptions = {}): Promise<ServeHandle> {
  const session = await createSession(path, opts)
  const distDir = opts.distDir ?? DEFAULT_DIST
  const absPath = resolve(path)

  async function serveStatic(urlPath: string, res: ServerResponse): Promise<void> {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
    const target = normalize(join(distDir, rel))
    // Path-traversal guard: never serve outside distDir.
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

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = (req.url ?? '/').split('?')[0]
        if (url === '/api/config' && req.method === 'GET') {
          sendJson(res, 200, {
            file: absPath,
            fileName: basename(absPath),
            readOnly: false,
            newFile: !existsSync(absPath),
          })
          return
        }
        if (url === '/api/file' && req.method === 'GET') {
          sendJson(res, 200, { content: await session.readContent() })
          return
        }
        if (url === '/api/file' && req.method === 'PUT') {
          const body = await readBody(req)
          const { content } = JSON.parse(body || '{}') as { content?: string }
          await session.applyContent(content ?? '')
          sendJson(res, 200, { ok: true })
          return
        }
        await serveStatic(url, res)
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message })
      }
    })()
  })

  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0)
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    async stop() {
      await session.stop()
      await new Promise<void>((r) => server.close(() => r()))
    },
    server,
  }
}
