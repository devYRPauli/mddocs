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

describe('createCollabServer (file-backed relay)', () => {
  it('converges two clients and persists the merged doc to the file', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Seed\n\nstarting body.')
    const server = await createCollabServer(p, { autocommit: false, storeDebounceMs: 60 })

    const a = connect(server.wsUrl, server.slug)
    const b = connect(server.wsUrl, server.slug)

    // Both clients should receive the file-seeded content.
    await waitFor(() => a.doc.getText('markdown').toString().includes('starting body'))
    await waitFor(() => b.doc.getText('markdown').toString().includes('starting body'))

    // Client A edits; client B must converge (realtime merge).
    a.doc.getText('markdown').insert(0, '# Edited live\n\n')
    await waitFor(() => b.doc.getText('markdown').toString().includes('# Edited live'))

    // And the edit must land on disk (the file stays canonical).
    await waitFor(async () => (await readFile(p, 'utf8')).includes('# Edited live'))
    const onDisk = await readFile(p, 'utf8')
    expect(onDisk).toContain('# Edited live')
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
    await waitFor(() => a.doc.getText('markdown').toString().includes('# v1'))

    a.doc.getText('markdown').insert(a.doc.getText('markdown').length, '\nlive paragraph\n')
    await waitFor(async () => (await readFile(p, 'utf8')).includes('live paragraph'))

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
