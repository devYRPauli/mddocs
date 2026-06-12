import { describe, it, expect } from 'vitest'
import { hasFooterConflict, resolveFooterConflictText } from '../src/footer'
import { extractMarks } from '../src/proof'

const CONFLICT = `# Doc

Body text everyone agrees on.

<<<<<<< HEAD
<!-- PROOF
{"version":2,"marks":{"a":{"id":"a","kind":"comment","by":"human:me","at":"2026-06-07T00:00:00Z","quote":"Body","data":{"text":"mine","resolved":false}}}}
-->
=======
<!-- PROOF
{"version":2,"marks":{"b":{"id":"b","kind":"comment","by":"human:you","at":"2026-06-07T00:01:00Z","quote":"Body","data":{"text":"yours","resolved":false}}}}
-->
>>>>>>> branch
`

// Same id on both sides; the side with the later `at` must win the union.
const CONFLICT_SAME_ID = `# Doc

Shared body.

<<<<<<< HEAD
<!-- PROOF
{"version":2,"marks":{"x":{"id":"x","kind":"comment","by":"human:me","at":"2026-06-07T00:00:00Z","quote":"Shared","data":{"text":"older","resolved":false}}}}
-->
=======
<!-- PROOF
{"version":2,"marks":{"x":{"id":"x","kind":"comment","by":"human:you","at":"2026-06-07T09:00:00Z","quote":"Shared","data":{"text":"newer","resolved":true}}}}
-->
>>>>>>> branch
`

describe('footer conflict', () => {
  it('detects a conflicted footer', () => {
    expect(hasFooterConflict(CONFLICT)).toBe(true)
    expect(hasFooterConflict('# clean\n\nno conflict')).toBe(false)
  })

  it('unions marks by id from both sides, keeping prose once', () => {
    const merged = resolveFooterConflictText(CONFLICT)
    expect(merged).not.toContain('<<<<<<<')
    expect(merged).not.toContain('=======')
    expect(merged).not.toContain('>>>>>>>')
    expect(merged).toContain('Body text everyone agrees on.')

    // Verify via the real parser, not substring spelunking.
    const { content, marks } = extractMarks(merged)
    expect(content.trim()).toBe('# Doc\n\nBody text everyone agrees on.')
    expect(Object.keys(marks ?? {}).sort()).toEqual(['a', 'b'])
  })

  it('on id collision keeps the side with the later `at`', () => {
    const merged = resolveFooterConflictText(CONFLICT_SAME_ID)
    const { marks } = extractMarks(merged)
    const x = (marks ?? {})['x'] as unknown as { at: string; data: { text: string; resolved: boolean } }
    expect(x.at).toBe('2026-06-07T09:00:00Z')
    expect(x.data.text).toBe('newer')
    expect(x.data.resolved).toBe(true)
  })

  it('returns clean input unchanged', () => {
    const clean = '# Title\n\nNo conflict here.\n'
    expect(resolveFooterConflictText(clean)).toBe(clean)
  })
})
