import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { createCollabServer } from '../src/collab'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-content-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await pred()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 40))
  }
}

describe('collab persists live editor CONTENT (prosemirror fragment → markdown)', () => {
  it('serializes the prosemirror fragment a client edits and writes markdown to disk', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Seed\n\nseeded body.\n')
    const server = await createCollabServer(p, { autocommit: false, storeDebounceMs: 60 })

    const doc = new Y.Doc()
    const socket = new HocuspocusProviderWebsocket({ url: server.wsUrl, WebSocketPolyfill: WebSocket as unknown as typeof WebSocket })
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: server.slug, document: doc })

    // Wait until joined (the seed reaches the markdown text type).
    await waitFor(() => doc.getText('markdown').toString().includes('seeded body'))

    // Mimic the real editor: content lives in the `prosemirror` Y.XmlFragment as
    // ProseMirror nodes, not in getText('markdown').
    const frag = doc.getXmlFragment('prosemirror')
    const para = new Y.XmlElement('paragraph')
    const text = new Y.XmlText()
    text.insert(0, 'Real editor content typed into the fragment.')
    para.insert(0, [text])
    frag.insert(0, [para])

    // The server should serialize the fragment and persist that markdown.
    await waitFor(async () => (await readFile(p, 'utf8')).includes('Real editor content typed into the fragment.'))
    const onDisk = await readFile(p, 'utf8')
    expect(onDisk).toContain('Real editor content typed into the fragment.')

    provider.destroy()
    socket.destroy()
    await server.stop()
  }, 25000)
})
