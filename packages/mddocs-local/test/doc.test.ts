import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDoc, saveDoc } from '../src/doc'
import { createComment } from '../src/proof'
import type { StoredMark } from '../src/proof'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('loadDoc/saveDoc', () => {
  it('loads a plain markdown file as empty marks', async () => {
    const p = join(dir, 'a.md')
    await writeFile(p, '# Hello\n\nBody.')
    const doc = await loadDoc(p)
    expect(doc.content.trim()).toBe('# Hello\n\nBody.')
    expect(Object.keys(doc.marks)).toHaveLength(0)
  })

  it('round-trips content + marks through save then load', async () => {
    const p = join(dir, 'b.md')
    const mark = createComment('Body.', 'human:me', 'a note', undefined, undefined)
    const marks: Record<string, StoredMark> = { [mark.id]: mark as unknown as StoredMark }
    await saveDoc(p, '# Hello\n\nBody.', marks)
    const raw = await readFile(p, 'utf8')
    expect(raw).toContain('PROOF')
    const doc = await loadDoc(p)
    expect(doc.content.trim()).toBe('# Hello\n\nBody.')
    expect(Object.keys(doc.marks)).toEqual([mark.id])
  })

  it('writes atomically (no partial file on concurrent save)', async () => {
    const p = join(dir, 'c.md')
    await Promise.all([
      saveDoc(p, '# One', {}),
      saveDoc(p, '# Two', {}),
    ])
    const doc = await loadDoc(p)
    expect(['# One', '# Two']).toContain(doc.content.trim())
  })

  it('cleans up the temp file when rename fails', async () => {
    const p = join(dir, 'isdir.md')
    await mkdir(p) // target is a directory -> rename(tmp, p) will fail
    await expect(saveDoc(p, '# x', {})).rejects.toThrow()
    const entries = await readdir(dir)
    expect(entries.some((e) => e.includes('.tmp-'))).toBe(false)
  })
})
