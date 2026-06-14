import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { serveShare } from '../src/share'

let dir: string
let dist: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-cmt-'))
  dist = await mkdtemp(join(tmpdir(), 'mddocs-cmt-dist-'))
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
function writeMark(doc: Y.Doc, id: string, text: string): void {
  doc.getMap('marks').set(id, {
    id, kind: 'comment', by: 'human:commenter', at: '2026-06-14T00:00:00Z', quote: 'seeded body',
    data: { text, thread: id, resolved: false, replies: [] },
  } as unknown as Record<string, unknown>)
}

describe('commenter-granularity wire enforcement', () => {
  it('reverts a commenter prose edit but keeps their comment mark', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nseeded body.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })

    const commenter = connect(h.host, h.port, h.slug, tokenOf(h.links.commenter))
    await waitFor(() => commenter.doc.getXmlFragment('prosemirror').toString().includes('seeded body'))

    // A prose edit from a commenter must NOT reach disk.
    appendParagraph(commenter.doc, 'COMMENTER PROSE EDIT')
    await sleep(800)
    expect(await readFile(p, 'utf8')).not.toContain('COMMENTER PROSE EDIT')

    // But a comment mark from the same commenter DOES persist.
    writeMark(commenter.doc, 'cmt-1', 'a fair point')
    await waitFor(async () => (await readFile(p, 'utf8')).includes('cmt-1'))
    const onDisk = await readFile(p, 'utf8')
    expect(onDisk).toContain('a fair point')
    expect(onDisk).not.toContain('COMMENTER PROSE EDIT')

    commenter.close()
    await h.stop()
  }, 25000)

  it('still lets an editor write prose', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Doc\n\nseeded body.\n')
    const h = await serveShare(p, { autocommit: false, distDir: dist, storeDebounceMs: 60 })

    const editor = connect(h.host, h.port, h.slug, tokenOf(h.links.editor))
    await waitFor(() => editor.doc.getXmlFragment('prosemirror').toString().includes('seeded body'))
    appendParagraph(editor.doc, 'EDITOR PROSE EDIT')
    await waitFor(async () => (await readFile(p, 'utf8')).includes('EDITOR PROSE EDIT'))
    expect(await readFile(p, 'utf8')).toContain('EDITOR PROSE EDIT')

    editor.close()
    await h.stop()
  }, 25000)
})
