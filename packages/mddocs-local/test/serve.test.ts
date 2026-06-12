import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, serve } from '../src/serve'
import { loadDoc } from '../src/doc'
import { createComment, embedMarks } from '../src/proof'
import type { StoredMark } from '../src/proof'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-serve-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function withMark(content: string) {
  const mark = createComment('hi', 'human:me', 'note', undefined, undefined)
  const marks = { [mark.id]: mark as unknown as StoredMark }
  return { id: mark.id, raw: embedMarks(content, marks) }
}

describe('createSession persistence glue', () => {
  it('applyContent extracts marks, reanchors, and writes to disk', async () => {
    const p = join(dir, 'd.md')
    const { id, raw } = withMark('# Edited\n\nhi')
    const session = await createSession(p, { autocommit: false })
    await session.applyContent(raw)
    const doc = await loadDoc(p)
    expect(doc.content.trim()).toBe('# Edited\n\nhi')
    expect(Object.keys(doc.marks)).toEqual([id])
    await session.stop()
  })

  it('readContent returns the raw on-disk string, or empty for a missing file', async () => {
    const p = join(dir, 'd.md')
    const session = await createSession(p)
    expect(await session.readContent()).toBe('')
    await writeFile(p, '# Hello\n')
    expect(await session.readContent()).toBe('# Hello\n')
    await session.stop()
  })
})

describe('serve HTTP contract (headless, no browser)', () => {
  it('GET /api/config reports the file name and new-file flag', async () => {
    const p = join(dir, 'doc.md')
    const handle = await serve(p, { autocommit: false })
    const cfg = await (await fetch(`${handle.url}/api/config`)).json()
    expect(cfg.fileName).toBe('doc.md')
    expect(cfg.readOnly).toBe(false)
    expect(cfg.newFile).toBe(true)
    await handle.stop()
  })

  it('PUT then GET /api/file round-trips content + marks through disk', async () => {
    const p = join(dir, 'doc.md')
    const { id, raw } = withMark('# Served\n\nhi')
    const handle = await serve(p, { autocommit: false })

    const put = await fetch(`${handle.url}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: raw }),
    })
    expect(put.status).toBe(200)

    const got = await (await fetch(`${handle.url}/api/file`)).json()
    expect(got.content).toContain('# Served')
    expect(got.content).toContain('PROOF')

    const doc = await loadDoc(p)
    expect(doc.content.trim()).toBe('# Served\n\nhi')
    expect(Object.keys(doc.marks)).toEqual([id])
    await handle.stop()
  })

  it('serves static files from distDir and 404s the unknown', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'mddocs-dist-'))
    await writeFile(join(distDir, 'index.html'), '<div id="editor"></div>')
    const p = join(dir, 'doc.md')
    const handle = await serve(p, { distDir })

    const index = await fetch(`${handle.url}/`)
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('id="editor"')

    const missing = await fetch(`${handle.url}/nope.js`)
    expect(missing.status).toBe(404)

    await handle.stop()
    await rm(distDir, { recursive: true, force: true })
  })
})
