import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { buildProgram } from '../src/cli'
import { loadDoc } from 'mddocs-local'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-resolve-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
const run = (...a: string[]) => buildProgram().parseAsync(['node', 'mddocs', ...a])

function comment(id: string, text: string, at: string) {
  return { id, kind: 'comment', by: 'human:x', at, quote: 'Shared body.', data: { text, thread: id, resolved: false, replies: [] } }
}
function docWith(marks: Record<string, unknown>): string {
  return `# Doc\n\nShared body.\n\n<!-- PROOF\n${JSON.stringify({ version: 2, marks })}\n-->\n`
}

describe('mddocs resolve (live <-> async footer merge)', () => {
  it('resolves a real git footer conflict by unioning both branches\' marks', async () => {
    const g = simpleGit(dir)
    await g.init()
    await g.addConfig('user.name', 'Test')
    await g.addConfig('user.email', 't@e.st')
    const p = join(dir, 'doc.md')

    // Base: one shared comment "a".
    await writeFile(p, docWith({ a: comment('a', 'base', '2026-06-12T00:00:00Z') }))
    await g.add(p); await g.commit('base')
    const main = (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()

    // Offline branch adds comment "c".
    await g.checkoutLocalBranch('offline')
    await writeFile(p, docWith({ a: comment('a', 'base', '2026-06-12T00:00:00Z'), c: comment('c', 'offline', '2026-06-12T01:00:00Z') }))
    await g.add(p); await g.commit('offline edit')

    // Meanwhile a live session adds comment "b" on the main branch.
    await g.checkout(main)
    await writeFile(p, docWith({ a: comment('a', 'base', '2026-06-12T00:00:00Z'), b: comment('b', 'live', '2026-06-12T02:00:00Z') }))
    await g.add(p); await g.commit('live edit')

    // Merge -> footer conflict.
    let conflicted = false
    try {
      await g.merge(['offline'])
    } catch {
      conflicted = true
    }
    const raw = await readFile(p, 'utf8')
    expect(conflicted || raw.includes('<<<<<<<')).toBe(true)
    expect(raw).toContain('<<<<<<<')

    // Resolve via the CLI.
    await run('resolve', p)

    const resolved = await readFile(p, 'utf8')
    expect(resolved).not.toContain('<<<<<<<')
    expect(resolved).not.toContain('=======')
    expect(resolved).not.toContain('>>>>>>>')

    // All three marks survive, and the doc still parses cleanly.
    const doc = await loadDoc(p)
    expect(Object.keys(doc.marks).sort()).toEqual(['a', 'b', 'c'])
    expect(doc.content).toContain('Shared body.')
  })

  it('is a no-op on a clean file', async () => {
    const p = join(dir, 'clean.md')
    await writeFile(p, '# Clean\n\nNo conflict.\n')
    await run('resolve', p)
    expect(await readFile(p, 'utf8')).toBe('# Clean\n\nNo conflict.\n')
  })
})
