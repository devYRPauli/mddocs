import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../src/cli'
import { loadDoc, resolveFooterConflictText, hasFooterConflict } from 'mddocs-local'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-e2e-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
const run = (...a: string[]) => buildProgram().parseAsync(['node', 'mddocs', ...a])

describe('async multiplayer footer merge', () => {
  it('union-resolves a footer that two people edited', async () => {
    // A file as `git merge` would leave it: agreed prose + a conflicted footer.
    const p = join(dir, 'doc.md')
    const conflicted = [
      '# Shared', '', 'Agreed body.', '',
      '<<<<<<< HEAD',
      '<!-- PROOF',
      '{"version":2,"marks":{"a":{"id":"a","kind":"comment","by":"human:me","at":"2026-06-07T00:00:00Z","quote":"Agreed body.","data":{"text":"mine","resolved":false}}}}',
      '-->',
      '=======',
      '<!-- PROOF',
      '{"version":2,"marks":{"b":{"id":"b","kind":"comment","by":"human:you","at":"2026-06-07T00:01:00Z","quote":"Agreed body.","data":{"text":"yours","resolved":false}}}}',
      '-->',
      '>>>>>>> theirs', '',
    ].join('\n')
    await writeFile(p, conflicted)

    const raw = await readFile(p, 'utf8')
    expect(hasFooterConflict(raw)).toBe(true)

    const merged = resolveFooterConflictText(raw)
    await writeFile(p, merged)

    const after = await readFile(p, 'utf8')
    expect(hasFooterConflict(after)).toBe(false)

    // Both authors' comments survive and the doc is parseable end-to-end.
    const doc = await loadDoc(p)
    expect(doc.content.trim()).toBe('# Shared\n\nAgreed body.')
    expect(Object.keys(doc.marks).sort()).toEqual(['a', 'b'])
  })

  it('full lifecycle: comment + suggest coexist, list, resolve through the CLI', async () => {
    const p = join(dir, 'doc.md')
    await writeFile(p, '# Spec\n\nThe API is great. The cli works.')

    // Two collaborators act on the same file (async, no server).
    await run('comment', 'add', p, '--quote', 'The API is great.', '--text', 'cite a benchmark')
    await run('suggest', p, '--quote', 'cli', '--replace', 'CLI')

    let doc = await loadDoc(p)
    const kinds = Object.values(doc.marks).map((m) => (m as unknown as { kind: string }).kind).sort()
    expect(kinds).toEqual(['comment', 'replace'])

    // Resolve the comment; the suggestion is untouched.
    const commentId = Object.entries(doc.marks).find(
      ([, m]) => (m as unknown as { kind: string }).kind === 'comment',
    )![0]
    await run('comment', 'resolve', commentId, '--file', p)

    doc = await loadDoc(p)
    const comment = doc.marks[commentId] as unknown as { data?: { resolved?: boolean } }
    expect(comment.data?.resolved).toBe(true)
    const stillPending = Object.values(doc.marks).find(
      (m) => (m as unknown as { kind: string }).kind === 'replace',
    ) as unknown as { data?: { status?: string } }
    expect(stillPending.data?.status).toBe('pending')
  })
})
