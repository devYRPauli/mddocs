import { Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
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
  /**
   * Optional per-connection authentication. Maps the WebSocket token to its
   * access; `readOnly: true` makes Hocuspocus drop all document writes from that
   * connection (server-side enforcement). `role` is recorded on the connection so
   * finer-grained enforcement (e.g. commenters cannot edit prose) can key off it.
   * Return null to reject the connection. When omitted, connections are
   * unauthenticated and read-write.
   */
  authenticate?: (token: string) => { readOnly: boolean; role?: string } | null
}

export interface CollabServerHandle {
  /** WebSocket URL the editor's HocuspocusProvider connects to. */
  wsUrl: string
  port: number
  slug: string
  stop(): Promise<void>
}

export interface ConfiguredCollab {
  /** Configured but NOT listening - attach via `hocuspocus.handleConnection`. */
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

  // Commenter-granularity wire enforcement. Viewers are blocked wholesale via
  // readOnly; commenters may write marks (a comment is a write to the marks map)
  // but must not edit prose (the `prosemirror` fragment). We attach a Y.UndoManager
  // scoped to that fragment whose trackedOrigins only matches connections whose
  // role is `commenter` (the role rides on the Yjs transaction origin, which is the
  // Hocuspocus connection, via its context). Any prose change from a commenter is
  // captured and immediately undone, so it never persists or reaches other clients.
  // Editor changes (different role) are never captured; mark writes never touch the
  // fragment, so they are untouched.
  const enforced = new WeakSet<object>()
  function enforceCommenterProse(doc: Y.Doc): void {
    if (enforced.has(doc)) return
    enforced.add(doc)
    const trackedOrigins = {
      has: (o: unknown): boolean =>
        !!o && typeof o === 'object' && (o as { context?: { role?: string } }).context?.role === 'commenter',
      add: () => undefined,
      delete: () => undefined,
    }
    const undo = new Y.UndoManager(doc.getXmlFragment('prosemirror'), {
      trackedOrigins: trackedOrigins as unknown as Set<unknown>,
      captureTimeout: 0,
    })
    undo.on('stack-item-added', () => {
      // Defer past the current Yjs transaction; undo() starts its own.
      queueMicrotask(() => {
        if (undo.undoStack.length > 0) undo.undo()
      })
    })
  }

  const hocuspocus = new Hocuspocus().configure({
    port: opts.port ?? 0,
    debounce: opts.storeDebounceMs ?? 150,
    quiet: true,

    // Seed the shared doc from disk on first join. Content + marks both ride
    // inside the Y.Doc (getText('markdown') / getMap('marks')) - the exact
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
      // Wire prose enforcement once the doc exists (only meaningful with roles).
      if (opts.authenticate) enforceCommenterProse(data.document)
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

    // Per-connection auth. Setting onAuthenticate makes Hocuspocus require a
    // token; mapping it to readOnly drops that connection's writes server-side.
    ...(opts.authenticate
      ? {
          async onAuthenticate(data) {
            const verdict = opts.authenticate!(data.token)
            if (!verdict) throw new Error('Unauthorized')
            data.connection.readOnly = verdict.readOnly
            // The returned object is merged into the connection's context, so the
            // role travels with every transaction this connection originates.
            return { readOnly: verdict.readOnly, role: verdict.role }
          },
        }
      : {}),
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
