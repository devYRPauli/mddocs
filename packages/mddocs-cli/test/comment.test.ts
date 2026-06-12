import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../src/cli'
import { loadDoc } from 'mddocs-local'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-cli-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function run(...argv: string[]) {
  await buildProgram().parseAsync(['node', 'mddocs', ...argv])
}

describe('comment add/ls/resolve/reply', () => {
  it('adds a comment that lands in the file footer', async () => {
    const p = join(dir, 'd.md')
    await writeFile(p, '# Doc\n\nThe target sentence.')
    await run('comment', 'add', p, '--quote', 'The target sentence.', '--text', 'fix this')
    const doc = await loadDoc(p)
    const marks = Object.values(doc.marks) as Array<{ kind: string; data?: { text?: string } }>
    expect(marks).toHaveLength(1)
    expect(marks[0].kind).toBe('comment')
    expect(marks[0].data?.text).toBe('fix this')
  })

  it('resolve marks the comment resolved', async () => {
    const p = join(dir, 'd.md')
    await writeFile(p, '# Doc\n\nThe target sentence.')
    await run('comment', 'add', p, '--quote', 'The target sentence.', '--text', 'fix this')
    const id = Object.keys((await loadDoc(p)).marks)[0]
    await run('comment', 'resolve', id, '--file', p)
    const doc = await loadDoc(p)
    const mark = doc.marks[id] as unknown as { data?: { resolved?: boolean } }
    expect(mark.data?.resolved).toBe(true)
  })

  it('reply appends to the comment thread', async () => {
    const p = join(dir, 'd.md')
    await writeFile(p, '# Doc\n\nThe target sentence.')
    await run('comment', 'add', p, '--quote', 'The target sentence.', '--text', 'first')
    const id = Object.keys((await loadDoc(p)).marks)[0]
    await run('comment', 'reply', id, '--text', 'a reply', '--file', p)
    const doc = await loadDoc(p)
    const mark = doc.marks[id] as unknown as { data?: { replies?: Array<{ text?: string; by?: string }> } }
    expect(mark.data?.replies).toHaveLength(1)
    expect(mark.data?.replies?.[0].text).toBe('a reply')
  })

  it('ls --open lists only unresolved comments', async () => {
    const p = join(dir, 'd.md')
    await writeFile(p, '# Doc\n\nOne. Two.')
    await run('comment', 'add', p, '--quote', 'One.', '--text', 'about one')
    await run('comment', 'add', p, '--quote', 'Two.', '--text', 'about two')
    const firstId = Object.keys((await loadDoc(p)).marks)[0]
    await run('comment', 'resolve', firstId, '--file', p)

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run('comment', 'ls', p, '--open')
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n')
    log.mockRestore()
    expect(printed).toContain('about two')
    expect(printed).not.toContain('about one')
  })
})
