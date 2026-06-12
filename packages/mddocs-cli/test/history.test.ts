import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { buildProgram } from '../src/cli'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-hist-'))
  const g = simpleGit(dir)
  await g.init()
  await g.addConfig('user.name', 'Test')
  await g.addConfig('user.email', 't@e.st')
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
const run = (...a: string[]) => buildProgram().parseAsync(['node', 'mddocs', ...a])

async function commit(p: string, body: string, msg: string) {
  await writeFile(p, body)
  const g = simpleGit(dir)
  await g.add(p)
  await g.commit(msg, [p])
}

function capture() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  return {
    text: () => log.mock.calls.map((c) => String(c[0])).join('\n'),
    restore: () => log.mockRestore(),
  }
}

describe('log + diff', () => {
  it('log lists commits newest-first with short hashes', async () => {
    const p = join(dir, 'doc.md')
    await commit(p, '# v1\n', 'first commit')
    await commit(p, '# v2\n', 'second commit')
    const cap = capture()
    await run('log', p)
    const out = cap.text()
    cap.restore()
    const firstIdx = out.indexOf('first commit')
    const secondIdx = out.indexOf('second commit')
    expect(secondIdx).toBeGreaterThanOrEqual(0)
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeLessThan(firstIdx) // newest first
  })

  it('diff shows the working-tree change', async () => {
    const p = join(dir, 'doc.md')
    await commit(p, '# v1\n', 'first')
    await writeFile(p, '# v2\n')
    const cap = capture()
    await run('diff', p)
    const out = cap.text()
    cap.restore()
    expect(out).toContain('-# v1')
    expect(out).toContain('+# v2')
  })

  it('diff reports no changes cleanly when the file is unmodified', async () => {
    const p = join(dir, 'doc.md')
    await commit(p, '# v1\n', 'first')
    const cap = capture()
    await run('diff', p)
    const out = cap.text()
    cap.restore()
    expect(out.toLowerCase()).toContain('no changes')
  })
})
