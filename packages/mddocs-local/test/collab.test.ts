import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import simpleGit from 'simple-git'
import { createCollabServer } from '../src/collab'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-collab-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await pred()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

interface Client { doc: Y.Doc; provider: HocuspocusProvider; socket: HocuspocusProviderWebsocket }

function connect(wsUrl: string, name: string): Client {
  const doc = new Y.Doc()
  const socket = new HocuspocusProviderWebsocket({ url: wsUrl, WebSocketPolyfill: WebSocket as unknown as typeof WebSocket })
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc })
  return { doc, provider, socket }
}

function close(c: Client): void {
  c.provider.destroy()
  c.socket.destroy()
}

// Append a paragraph to a client's `prosemirror` fragment - the same structure
// the real editor edits (content lives in the fragment, not getText('markdown')).
function appendParagraph(c: Client, text: string): void {
  const frag = c.doc.getXmlFragment('prosemirror')
  const para = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  t.insert(0, text)
  para.insert(0, [t])
  frag.insert(frag.length, [para])
}

describe('createCollabServer (file-backed relay)', () => {
  it('converges two clients and persists the merged doc to the file', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Seed\n\nstarting body.')
    const server = await createCollabServer(p, { autocommit: false, storeDebounceMs: 60 })

    const a = connect(server.wsUrl, server.slug)
    const b = connect(server.wsUrl, server.slug)

    // Both clients receive the file-seeded content in the prosemirror fragment.
    await waitFor(() => a.doc.getXmlFragment('prosemirror').toString().includes('starting body'))
    await waitFor(() => b.doc.getXmlFragment('prosemirror').toString().includes('starting body'))

    // Client A edits the fragment; client B must converge (realtime merge).
    appendParagraph(a, 'Edited live by A.')
    await waitFor(() => b.doc.getXmlFragment('prosemirror').toString().includes('Edited live by A.'))

    // And the edit must land on disk as markdown (the file stays canonical).
    await waitFor(async () => (await readFile(p, 'utf8')).includes('Edited live by A.'))
    const onDisk = await readFile(p, 'utf8')
    expect(onDisk).toContain('Edited live by A.')
    expect(onDisk).toContain('starting body')

    close(a)
    close(b)
    await server.stop()
  }, 20000)

  it('autocommits persisted edits when in a git repo', async () => {
    const g = simpleGit(dir)
    await g.init()
    await g.addConfig('user.name', 'Test')
    await g.addConfig('user.email', 't@e.st')
    const p = join(dir, 'doc.md')
    await writeFile(p, '# v1\n')
    await g.add(p)
    await g.commit('init', [p])

    const server = await createCollabServer(p, { autocommit: true, storeDebounceMs: 60, debounceMs: 60 })
    const a = connect(server.wsUrl, server.slug)
    await waitFor(() => a.doc.getXmlFragment('prosemirror').toString().includes('v1'))

    appendParagraph(a, 'live paragraph from collab.')
    await waitFor(async () => (await readFile(p, 'utf8')).includes('live paragraph from collab.'))

    // The session's debounced autocommit should produce a new commit.
    await waitFor(async () => {
      const log = await g.log({ file: p })
      return log.all.some((c) => c.message.startsWith('mddocs: edit'))
    })
    const log = await g.log({ file: p })
    expect(log.all.some((c) => c.message.startsWith('mddocs: edit'))).toBe(true)

    close(a)
    await server.stop()
  }, 20000)
})
