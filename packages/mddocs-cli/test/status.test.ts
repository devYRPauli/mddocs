import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../src/cli'
import { loadDoc } from 'mddocs-local'

let dir: string
let cwd: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-status-'))
  cwd = process.cwd()
  process.chdir(dir)
})
afterEach(async () => {
  process.chdir(cwd)
  await rm(dir, { recursive: true, force: true })
})

async function run(...argv: string[]) {
  await buildProgram().parseAsync(['node', 'mddocs', ...argv])
}

async function capture(...argv: string[]): Promise<string> {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.join(' '))
  })
  try {
    await run(...argv)
  } finally {
    spy.mockRestore()
  }
  return lines.join('\n')
}

describe('mddocs status', () => {
  it('lists open comments and pending suggestions grouped by file, omitting docs with nothing open', async () => {
    // File A: one open comment + one pending replace suggestion.
    await writeFile('a.md', '# A\n\nThe target sentence. old phrase here.')
    await run('comment', 'add', 'a.md', '--quote', 'The target sentence.', '--text', 'when exactly?')
    await run('suggest', 'add', 'a.md', '--quote', 'old phrase', '--replace', 'new phrase')
    // File B: a single comment that we then resolve, so nothing is open.
    await writeFile('b.md', '# B\n\nKeep this please.')
    await run('comment', 'add', 'b.md', '--quote', 'Keep this please.', '--text', 'noted')
    const bId = Object.keys((await loadDoc('b.md')).marks)[0]
    await run('comment', 'resolve', bId, '--file', 'b.md')

    const out = await capture('status')
    expect(out).toContain('a.md')
    expect(out).toContain('when exactly?')
    expect(out).toContain('replace "old phrase" -> "new phrase"')
    expect(out).toContain('[open]')
    expect(out).toContain('[pending]')
    // b.md has only a resolved comment - it must be omitted from the default view.
    expect(out).not.toContain('b.md')
    // Footer counts reflect the actionable view.
    expect(out).toContain('1 doc - 1 open comment, 1 pending suggestion')
  })

  it('--all includes resolved comments and the docs that hold them', async () => {
    await writeFile('b.md', '# B\n\nKeep this please.')
    await run('comment', 'add', 'b.md', '--quote', 'Keep this please.', '--text', 'noted')
    const bId = Object.keys((await loadDoc('b.md')).marks)[0]
    await run('comment', 'resolve', bId, '--file', 'b.md')

    const out = await capture('status', '--all')
    expect(out).toContain('b.md')
    expect(out).toContain('[resolved]')
    expect(out).toContain('noted')
  })

  it('prints a friendly message when nothing is open', async () => {
    await writeFile('c.md', '# C\n\nNothing to see.')
    const out = await capture('status')
    expect(out).toContain('Nothing open')
  })
})
