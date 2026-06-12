import { Hocuspocus } from '@hocuspocus/server'
import { basename } from 'node:path'
import { loadDoc } from './doc'
import { createSession, type SessionOptions } from './serve'
import { embedMarks } from './proof'
import type { StoredMark } from './proof'

export interface CollabServerOptions extends SessionOptions {
  port?: number
  /** Document identity the editor joins (defaults to the file's basename). */
  slug?: string
  /** How long Hocuspocus waits after edits settle before persisting (ms). */
  storeDebounceMs?: number
}

export interface CollabServerHandle {
  /** WebSocket URL the editor's HocuspocusProvider connects to. */
  wsUrl: string
  port: number
  slug: string
  stop(): Promise<void>
}

// Our own Hocuspocus server (NOT upstream server/collab.ts, which is hard-wired
// to SQLite). The file + git stay canonical: the live Y.Doc is seeded from the
// file and every settled change is persisted back through the M1 session path
// (saveDoc atomic + reanchor + debounced git autocommit). See SPIKE-collab.md.
export async function createCollabServer(
  file: string,
  opts: CollabServerOptions = {},
): Promise<CollabServerHandle> {
  const slug = opts.slug ?? basename(file)
  const session = await createSession(file, opts)

  const server = new Hocuspocus().configure({
    port: opts.port ?? 0,
    debounce: opts.storeDebounceMs ?? 150,
    quiet: true,

    // Seed the shared doc from disk on first join. Content + marks both ride
    // inside the Y.Doc (getText('markdown') / getMap('marks')) — the exact
    // fields the editor's collab client reads/writes.
    async onLoadDocument(data) {
      if (data.documentName !== slug) return data.document
      const { content, marks } = await loadDoc(file)
      const ytext = data.document.getText('markdown')
      if (ytext.length === 0 && content.length > 0) ytext.insert(0, content)
      const ymarks = data.document.getMap('marks')
      for (const [id, mark] of Object.entries(marks)) {
        if (!ymarks.has(id)) ymarks.set(id, mark as unknown as Record<string, unknown>)
      }
      return data.document
    },

    // Persist the settled doc back to the file (+ optional autocommit). Reuses
    // the M1 session: embed marks into the markdown string, then applyContent.
    async onStoreDocument(data) {
      if (data.documentName !== slug) return
      const markdown = data.document.getText('markdown').toString()
      const marks = data.document.getMap('marks').toJSON() as Record<string, StoredMark>
      await session.applyContent(embedMarks(markdown, marks))
    },
  })

  await server.listen()
  const port = server.address.port

  return {
    wsUrl: `ws://127.0.0.1:${port}`,
    port,
    slug,
    async stop() {
      await server.destroy()
      await session.stop()
    },
  }
}
