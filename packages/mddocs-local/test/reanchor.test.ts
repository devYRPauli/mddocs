import { describe, it, expect } from 'vitest'
import { reanchorMarks } from '../src/reanchor'
import { createComment } from '../src/proof'
import type { StoredMark } from '../src/proof'

function marksOf(...m: ReturnType<typeof createComment>[]): Record<string, StoredMark> {
  return Object.fromEntries(m.map((x) => [x.id, x as unknown as StoredMark]))
}

describe('reanchorMarks', () => {
  it('keeps a mark whose quote still exists, not orphaned', () => {
    const c = createComment('the quick brown fox', 'human:me', 'note', undefined, undefined)
    const res = reanchorMarks('Before. the quick brown fox. After.', marksOf(c))
    expect(res.orphaned).toHaveLength(0)
    expect(Object.keys(res.marks)).toEqual([c.id])
  })

  it('flags a mark whose quote is gone as orphaned', () => {
    const c = createComment('a phrase that vanished', 'human:me', 'note', undefined, undefined)
    const res = reanchorMarks('Totally different text now.', marksOf(c))
    expect(res.orphaned.map((m) => m.id)).toContain(c.id)
    // orphaned marks are retained in the map with orphaned=true, never dropped
    expect(res.marks[c.id]).toBeDefined()
  })
})
