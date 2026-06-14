import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { saveDoc } from '../src/doc'
import { proof } from '../src/index'
import { buildMarkIndex, findFileForMark } from '../src/markindex'
import type { Mark, StoredMark } from '../src/proof'

let dir: string
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'mddocs-index-')))
  const g = simpleGit(dir)
  await g.init()
  await g.addConfig('user.name', 'Test')
  await g.addConfig('user.email', 't@e.st')
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function commentDoc(quote: string, text: string): { mark: Mark; marks: Record<string, StoredMark> } {
  const mark = proof.createComment(quote, 'human:test', text)
  return { mark, marks: { [mark.id]: mark as unknown as StoredMark } }
}

describe('mark-to-file index', () => {
  it('maps each mark id to the file that holds it', async () => {
    const a = join(dir, 'a.md')
    const b = join(dir, 'sub', 'b.md')
    await mkdir(join(dir, 'sub'), { recursive: true })
    const da = commentDoc('alpha', 'note a')
    const db = commentDoc('beta', 'note b')
    await saveDoc(a, '# A\n\nalpha\n', da.marks)
    await saveDoc(b, '# B\n\nbeta\n', db.marks)

    const index = await buildMarkIndex(dir)
    expect(index.get(da.mark.id)).toBe(a)
    expect(index.get(db.mark.id)).toBe(b)
  })

  it('findFileForMark resolves a known id and returns undefined for unknown', async () => {
    const a = join(dir, 'a.md')
    const da = commentDoc('alpha', 'note a')
    await saveDoc(a, '# A\n\nalpha\n', da.marks)

    expect(await findFileForMark(da.mark.id, dir)).toBe(a)
    expect(await findFileForMark('does-not-exist', dir)).toBeUndefined()
  })

  it('ignores .md files excluded by .gitignore', async () => {
    await writeFile(join(dir, '.gitignore'), 'ignored/\n')
    const hidden = join(dir, 'ignored', 'h.md')
    await mkdir(join(dir, 'ignored'), { recursive: true })
    const dh = commentDoc('gamma', 'hidden note')
    await saveDoc(hidden, '# H\n\ngamma\n', dh.marks)

    const index = await buildMarkIndex(dir)
    expect(index.has(dh.mark.id)).toBe(false)
  })
})
