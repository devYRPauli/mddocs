import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { buildProgram } from '../src/cli'
import { loadDoc, history } from 'mddocs-local'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-ac-'))
  execSync('git init -q && git config user.email t@t.t && git config user.name t', { cwd: dir })
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
const run = (...a: string[]) => buildProgram().parseAsync(['node', 'mddocs', ...a])

async function seed(): Promise<string> {
  const p = join(dir, 'd.md')
  await writeFile(p, '# Doc\n\nteh claim is bold.')
  execSync('git add -A && git commit -qm init', { cwd: dir })
  return p
}

describe('CLI auto-commit of mark mutations', () => {
  it('comment add commits with an actor-attributed message', async () => {
    const p = await seed()
    await run('comment', 'add', p, '--quote', 'claim', '--text', 'source?')
    const commits = await history(p)
    expect(commits[0].message).toMatch(/comment by human:/)
  })

  it('--no-commit leaves the change in the working tree', async () => {
    const p = await seed()
    const before = (await history(p)).length
    await run('comment', 'add', p, '--quote', 'claim', '--text', 'source?', '--no-commit')
    expect((await history(p)).length).toBe(before)
  })

  it('accept commits attributing the original proposer', async () => {
    const p = await seed()
    await run('suggest', 'add', p, '--quote', 'teh', '--replace', 'the', '--no-commit')
    const id = Object.keys((await loadDoc(p)).marks)[0]
    await run('accept', id, '--file', p)
    const commits = await history(p)
    expect(commits[0].message).toMatch(/accept suggestion \(proposed by human:/)
  })

  it('does nothing outside a git repo', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'mddocs-nogit-'))
    try {
      const p = join(plain, 'd.md')
      await writeFile(p, '# Doc\n\nclaim here.')
      // should not throw even though there is no repo to commit to
      await run('comment', 'add', p, '--quote', 'claim', '--text', 'source?')
      const doc = await loadDoc(p)
      expect(Object.keys(doc.marks).length).toBe(1)
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })
})
