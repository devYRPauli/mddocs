import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { history, commitFile, isGitRepo, diff } from '../src/git'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-git-'))
  const g = simpleGit(dir)
  await g.init()
  await g.addConfig('user.name', 'Test')
  await g.addConfig('user.email', 't@e.st')
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('git wrappers', () => {
  it('isGitRepo true inside a repo, false outside', async () => {
    expect(await isGitRepo(dir)).toBe(true)
    const out = await mkdtemp(join(tmpdir(), 'plain-'))
    expect(await isGitRepo(out)).toBe(false)
    await rm(out, { recursive: true, force: true })
  })

  it('commitFile then history returns the commits newest-first', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# v1')
    await commitFile(p, 'first')
    await writeFile(p, '# v2')
    await commitFile(p, 'second')
    const log = await history(p)
    expect(log.map((c) => c.message)).toEqual(['second', 'first'])
    expect(log[0].hash).toMatch(/^[0-9a-f]{7,40}$/)
    expect(log[0].author).toBe('Test')
    expect(typeof log[0].date).toBe('string')
  })

  it('diff shows the working-tree change for a file', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# v1\n')
    await commitFile(p, 'first')
    await writeFile(p, '# v2\n')
    const d = await diff(p)
    expect(d).toContain('-# v1')
    expect(d).toContain('+# v2')
  })
})
