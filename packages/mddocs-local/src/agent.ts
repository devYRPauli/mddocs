import type { Hocuspocus } from '@hocuspocus/server'
import { fragmentToMarkdown, parseMarkdownNode, setFragmentFromNode } from './serialize'
import {
  createComment,
  createReplaceSuggestion,
  createInsertSuggestion,
  createDeleteSuggestion,
  createAuthored,
  resolveQuote,
  normalizeQuote,
} from './proof'
import type { Mark, StoredMark } from './proof'

export interface AgentState {
  content: string
  marks: Record<string, StoredMark>
}

export interface CommentInput {
  quote: string
  text: string
  model?: string
}

export interface SuggestInput {
  quote: string
  replace?: string
  insert?: string
  delete?: boolean
  model?: string
}

export interface RewriteInput {
  /** Quoted span to replace. Omit (or empty) to replace the whole document body. */
  quote?: string
  /** New markdown for the span (or the whole body). */
  markdown: string
  model?: string
}

export interface AgentApi {
  getState(): Promise<AgentState>
  addComment(input: CommentInput): Promise<{ id: string }>
  addSuggestion(input: SuggestInput): Promise<{ id: string; kind: string }>
  rewrite(input: RewriteInput): Promise<{ chars: number; by: string; markId?: string }>
  stop(): Promise<void>
}

// Programmatic agent operations over the LIVE collab doc. Mutations go through a
// reused Hocuspocus DirectConnection so they sync to every connected editor and
// persist to the file (+ git) via the session's onStoreDocument. Reuses the same
// @proof/core mark factories as the human CLI, with `ai:<model>` provenance.
export function createAgentApi(hocuspocus: Hocuspocus, slug: string, opts: { model?: string } = {}): AgentApi {
  type DirectConnection = Awaited<ReturnType<Hocuspocus['openDirectConnection']>>
  let connPromise: Promise<DirectConnection> | undefined
  const connect = (): Promise<DirectConnection> => (connPromise ??= hocuspocus.openDirectConnection(slug))

  const actor = (model?: string) => `ai:${model ?? opts.model ?? 'agent'}`

  async function inject(mark: Mark): Promise<void> {
    const conn = await connect()
    await conn.transact((doc) => {
      doc.getMap('marks').set(mark.id, mark as unknown as Record<string, unknown>)
    })
  }

  return {
    async getState() {
      const conn = await connect()
      const doc = conn.document
      if (!doc) return { content: '', marks: {} }
      const content =
        (await fragmentToMarkdown(doc.getXmlFragment('prosemirror'))) ??
        doc.getText('markdown').toString()
      const marks = doc.getMap('marks').toJSON() as Record<string, StoredMark>
      return { content, marks }
    },

    async addComment({ quote, text, model }) {
      const mark = createComment(quote, actor(model), text, undefined, undefined)
      await inject(mark)
      return { id: mark.id }
    },

    async addSuggestion({ quote, replace, insert, delete: del, model }) {
      let mark: Mark
      if (replace !== undefined) mark = createReplaceSuggestion(quote, actor(model), replace, undefined, undefined)
      else if (insert !== undefined) mark = createInsertSuggestion(quote, actor(model), insert, undefined, undefined)
      else if (del) mark = createDeleteSuggestion(quote, actor(model), undefined, undefined)
      else throw new Error('suggest needs one of replace, insert, or delete')
      await inject(mark)
      return { id: mark.id, kind: mark.kind }
    },

    // Edit the prose directly (not a proposal): replace a quoted span, or the
    // whole body when no quote is given. The new markdown is applied to the live
    // `prosemirror` fragment so it syncs to every editor and persists to the file
    // (+ git) via onStoreDocument. Authorship is recorded as an `ai:<model>`
    // authored mark over the new text.
    async rewrite({ quote, markdown, model }) {
      const conn = await connect()
      const doc = conn.document
      if (!doc) throw new Error('no live document to rewrite')
      const current = (await fragmentToMarkdown(doc.getXmlFragment('prosemirror'))) ?? ''
      let next: string
      if (quote && quote.length > 0) {
        const span = resolveQuote(current, quote)
        if (!span) throw new Error('quoted text not found in the live document')
        next = current.slice(0, span.from) + markdown + current.slice(span.to)
      } else {
        next = markdown
      }
      const node = await parseMarkdownNode(next)
      await conn.transact((d) => {
        setFragmentFromNode(d.getXmlFragment('prosemirror'), node)
      })

      const by = actor(model)
      // Provenance: an authored mark over the new text. The range is recomputed
      // from the (length-capped) quote when the doc is persisted and reanchored.
      const snippet = normalizeQuote(markdown).slice(0, 200)
      let markId: string | undefined
      if (snippet.length > 0) {
        const mark = createAuthored(by, { from: 0, to: 0 }, snippet)
        await inject(mark)
        markId = mark.id
      }
      return { chars: next.length, by, markId }
    },

    async stop() {
      if (connPromise) {
        const conn = await connPromise
        await conn.disconnect()
        connPromise = undefined
      }
    },
  }
}
