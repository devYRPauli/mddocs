import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { createCollabServer } from '../src/collab'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-loose-')) })
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

// End-to-end regression for the reported loose-list crash: serving a file whose
// markdown contains "loose" lists (blank lines between items) used to terminate
// the server with `RangeError: Expected value of type boolean for attribute spread
// on type list_item, got string` the moment a client connected (seed -> store).
describe('collab serves a file with loose lists (spread/order attr crash)', () => {
  it('seeds the loose list to the client and persists an edit without crashing', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '### Example Section\n\n1. First item\n\n2. Second item\n\n3. Third item\n')
    const server = await createCollabServer(p, { autocommit: false, storeDebounceMs: 60 })

    const doc = new Y.Doc()
    const socket = new HocuspocusProviderWebsocket({ url: server.wsUrl, WebSocketPolyfill: WebSocket as unknown as typeof WebSocket })
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: server.slug, document: doc })

    // The seeded fragment must reach the client (this is what the editor renders).
    const frag = doc.getXmlFragment('prosemirror')
    await waitFor(() => frag.toString().includes('First item'))
    expect(frag.toString()).toContain('Third item')

    // A client edit forces a store: the server serializes the whole fragment
    // (loose list included) back to markdown. Before the fix this threw and the
    // process died; now it must persist cleanly.
    const para = new Y.XmlElement('paragraph')
    const text = new Y.XmlText()
    text.insert(0, 'Appended by the editor.')
    para.insert(0, [text])
    frag.insert(frag.length, [para])

    await waitFor(async () => (await readFile(p, 'utf8')).includes('Appended by the editor.'))
    const onDisk = await readFile(p, 'utf8')
    expect(onDisk).toContain('First item')
    expect(onDisk).toContain('Third item')
    expect(onDisk).toContain('Appended by the editor.')

    provider.destroy()
    socket.destroy()
    await server.stop()
  }, 25000)
})
