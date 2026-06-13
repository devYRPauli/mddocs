import type { Hocuspocus } from '@hocuspocus/server'
import { fragmentToMarkdown } from './serialize'
import {
  createComment,
  createReplaceSuggestion,
  createInsertSuggestion,
  createDeleteSuggestion,
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

export interface AgentApi {
  getState(): Promise<AgentState>
  addComment(input: CommentInput): Promise<{ id: string }>
  addSuggestion(input: SuggestInput): Promise<{ id: string; kind: string }>
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

    async stop() {
      if (connPromise) {
        const conn = await connPromise
        await conn.disconnect()
        connPromise = undefined
      }
    },
  }
}
