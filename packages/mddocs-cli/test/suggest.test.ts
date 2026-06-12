import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../src/cli'
import { loadDoc } from 'mddocs-local'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-sug-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
const run = (...a: string[]) => buildProgram().parseAsync(['node', 'mddocs', ...a])

describe('suggest + accept/reject', () => {
  it('creates a pending replace suggestion', async () => {
    const p = join(dir, 'd.md')
    await writeFile(p, '# Doc\n\nold phrase here.')
    await run('suggest', p, '--quote', 'old phrase', '--replace', 'new phrase')
    const doc = await loadDoc(p)
    const m = Object.values(doc.marks)[0] as unknown as { kind: string; data?: { status?: string; content?: string } }
    expect(m.kind).toBe('replace')
    expect(m.data?.status).toBe('pending')
    expect(m.data?.content).toBe('new phrase')
  })

  it('creates a delete suggestion via createDeleteSuggestion (no content field)', async () => {
    const p = join(dir, 'd.md')
    await writeFile(p, '# Doc\n\nremove me please.')
    await run('suggest', p, '--quote', 'remove me', '--delete')
    const doc = await loadDoc(p)
    const m = Object.values(doc.marks)[0] as unknown as { kind: string; data?: { status?: string } }
    expect(m.kind).toBe('delete')
    expect(m.data?.status).toBe('pending')
  })

  it('accept sets the suggestion status to accepted', async () => {
    const p = join(dir, 'd.md')
    await writeFile(p, '# Doc\n\nold phrase here.')
    await run('suggest', p, '--quote', 'old phrase', '--replace', 'new phrase')
    const id = Object.keys((await loadDoc(p)).marks)[0]
    await run('accept', id, '--file', p)
    const doc = await loadDoc(p)
    const m = doc.marks[id] as unknown as { data?: { status?: string } }
    expect(m.data?.status).toBe('accepted')
  })

  it('reject sets the suggestion status to rejected', async () => {
    const p = join(dir, 'd.md')
    await writeFile(p, '# Doc\n\nold phrase here.')
    await run('suggest', p, '--quote', 'old phrase', '--replace', 'new phrase')
    const id = Object.keys((await loadDoc(p)).marks)[0]
    await run('reject', id, '--file', p)
    const doc = await loadDoc(p)
    const m = doc.marks[id] as unknown as { data?: { status?: string } } | undefined
    expect(m === undefined || m.data?.status === 'rejected').toBe(true)
  })
})
