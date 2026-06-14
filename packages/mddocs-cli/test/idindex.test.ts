import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { buildProgram } from '../src/cli'
import { loadDoc } from 'mddocs-local'

let dir: string
let prevCwd: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-idindex-'))
  const g = simpleGit(dir)
  await g.init()
  await g.addConfig('user.name', 'Test')
  await g.addConfig('user.email', 't@e.st')
  prevCwd = process.cwd()
  process.chdir(dir)
})
afterEach(async () => {
  process.chdir(prevCwd)
  await rm(dir, { recursive: true, force: true })
})
const run = (...a: string[]) => buildProgram().parseAsync(['node', 'mddocs', ...a])

async function onlyMarkId(file: string): Promise<string> {
  const ids = Object.keys((await loadDoc(file)).marks)
  expect(ids).toHaveLength(1)
  return ids[0]
}

describe('id-only commands resolve their file via the mark index', () => {
  it('comment resolve <id> works without --file', async () => {
    const p = join(dir, 'notes.md')
    await writeFile(p, '# Notes\n\nthe API is fast\n')
    await run('comment', 'add', p, '--quote', 'the API is fast', '--text', 'cite a benchmark?')
    const id = await onlyMarkId(p)

    await run('comment', 'resolve', id)

    const mark = (await loadDoc(p)).marks[id] as unknown as { data?: { resolved?: boolean } }
    expect(mark.data?.resolved).toBe(true)
  })

  it('finds a doc in a subdirectory from the repo root', async () => {
    const sub = join(dir, 'docs')
    await mkdir(sub, { recursive: true })
    const p = join(sub, 'spec.md')
    await writeFile(p, '# Spec\n\nteh latency\n')
    await run('suggest', p, '--quote', 'teh', '--replace', 'the')
    const id = await onlyMarkId(p)

    await run('accept', id)

    const doc = await loadDoc(p)
    expect(doc.content).toContain('the latency')
    expect(doc.content).not.toContain('teh latency')
    expect(doc.marks[id]).toBeUndefined()
  })

  it('errors clearly when the id is nowhere to be found', async () => {
    await expect(run('reject', 'no-such-id')).rejects.toThrow(/could not find mark no-such-id/)
  })
})
