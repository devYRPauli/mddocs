import { Hocuspocus } from '@hocuspocus/server'
import { basename } from 'node:path'
import { loadDoc } from './doc'
import { createSession, type Session, type SessionOptions } from './serve'
import { embedMarks } from './proof'
import { fragmentToMarkdown, seedFragmentFromMarkdown } from './serialize'
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

export interface ConfiguredCollab {
  /** Configured but NOT listening — attach via `hocuspocus.handleConnection`. */
  hocuspocus: Hocuspocus
  session: Session
  slug: string
}

// Build our own Hocuspocus instance (NOT upstream server/collab.ts, which is
// hard-wired to SQLite) with file-backed persistence hooks. The file + git stay
// canonical: the live Y.Doc is seeded from the file, and every settled change is
// persisted back through the M1 session path (saveDoc atomic + reanchor +
// debounced git autocommit). See SPIKE-collab.md. Returned un-listened so it can
// either listen standalone (createCollabServer) or attach to a shared HTTP
// server's upgrade (serveShare).
export async function configureCollab(
  file: string,
  opts: CollabServerOptions = {},
): Promise<ConfiguredCollab> {
  const slug = opts.slug ?? basename(file)
  const session = await createSession(file, opts)

  const hocuspocus = new Hocuspocus().configure({
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
      // The editor renders content from the `prosemirror` fragment and does not
      // seed it from our bootstrap, so seed it here from the file's markdown.
      const frag = data.document.getXmlFragment('prosemirror')
      if (frag.length === 0) await seedFragmentFromMarkdown(content, frag)
      const ymarks = data.document.getMap('marks')
      for (const [id, mark] of Object.entries(marks)) {
        if (!ymarks.has(id)) ymarks.set(id, mark as unknown as Record<string, unknown>)
      }
      return data.document
    },

    // Persist the settled doc back to the file (+ optional autocommit). The
    // editor's canonical content is the `prosemirror` Y.XmlFragment, so we
    // serialize that to markdown; `getText('markdown')` is only the one-way seed
    // and is used as a fallback before the editor populates the fragment. Marks
    // come from the marks map. Reuses the M1 session (saveDoc + reanchor + commit).
    async onStoreDocument(data) {
      if (data.documentName !== slug) return
      const fromFragment = await fragmentToMarkdown(data.document.getXmlFragment('prosemirror'))
      const markdown = fromFragment ?? data.document.getText('markdown').toString()
      // Never clobber the file with an empty doc (e.g. a client connected before
      // the fragment was seeded).
      if (markdown.trim() === '') return
      const marks = data.document.getMap('marks').toJSON() as Record<string, StoredMark>
      await session.applyContent(embedMarks(markdown, marks))
    },
  })

  return { hocuspocus, session, slug }
}

// Standalone collab server on its own port (used by the headless test).
export async function createCollabServer(
  file: string,
  opts: CollabServerOptions = {},
): Promise<CollabServerHandle> {
  const { hocuspocus, session, slug } = await configureCollab(file, opts)
  await hocuspocus.listen()
  const port = hocuspocus.address.port

  return {
    wsUrl: `ws://127.0.0.1:${port}`,
    port,
    slug,
    async stop() {
      await hocuspocus.destroy()
      await session.stop()
    },
  }
}
