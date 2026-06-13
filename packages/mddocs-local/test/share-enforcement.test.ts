import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { serveShare } from '../src/share'

let dir: string
let dist: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-enf-'))
  dist = await mkdtemp(join(tmpdir(), 'mddocs-enf-dist-'))
  await writeFile(join(dist, 'index.html'), '<div id="editor"></div>')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(dist, { recursive: true, force: true })
})

function tokenOf(link: string): string {
  return new URL(link).searchParams.get('token') as string
}
async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 12000): Promise<void> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await pred()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 40))
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function connect(host: string, port: number, slug: string, token: string) {
  const doc = new Y.Doc()
  const socket = new HocuspocusProviderWebsocket({ url: `ws://${host}:${port}`, WebSocketPolyfill: WebSocket as unknown as typeof WebSocket })
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: slug, document: doc, token })
  return { doc, provider, socket, close: () => { provider.destroy(); socket.destroy() } }
}
function appendParagraph(doc: Y.Doc, text: string): void {
  const frag = doc.getXmlFragment('prosemirror')
  const para = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  t.insert(0, text)
  para.insert(0, [t])
  frag.insert(frag.length, [para])
}

describe('server-side write enforcement for viewers', () => {
  it('drops a viewer connection\'s writes but persists an editor\'s', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nseeded body.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })

    // A viewer can READ (gets the seeded content) ...
    const viewer = connect(h.host, h.port, h.slug, tokenOf(h.links.viewer))
    await waitFor(() => viewer.doc.getXmlFragment('prosemirror').toString().includes('seeded body'))

    // ... but its writes must NOT reach disk (readOnly enforced server-side).
    appendParagraph(viewer.doc, 'VIEWER TRIED TO WRITE THIS')
    await sleep(700)
    expect(await readFile(p, 'utf8')).not.toContain('VIEWER TRIED TO WRITE THIS')
    viewer.close()

    // An editor's write IS persisted.
    const editor = connect(h.host, h.port, h.slug, tokenOf(h.links.editor))
    await waitFor(() => editor.doc.getXmlFragment('prosemirror').toString().includes('seeded body'))
    appendParagraph(editor.doc, 'EDITOR WROTE THIS')
    await waitFor(async () => (await readFile(p, 'utf8')).includes('EDITOR WROTE THIS'))
    expect(await readFile(p, 'utf8')).toContain('EDITOR WROTE THIS')
    editor.close()

    await h.stop()
  }, 25000)
})
