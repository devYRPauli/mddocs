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

  it('flags a mark whose quote is gone as orphaned but keeps it', () => {
    const c = createComment('a phrase that vanished', 'human:me', 'note', undefined, undefined)
    const res = reanchorMarks('Totally different text now.', marksOf(c))
    expect(res.orphaned.map((m) => m.id)).toContain(c.id)
    expect(res.marks[c.id]).toBeDefined()
    expect((res.marks[c.id] as unknown as { orphaned?: boolean }).orphaned).toBe(true)
  })

  it('re-anchors a mark whose stored range is now stale (range points at wrong text)', () => {
    // content: the quote actually lives near the END, but the mark's range points at the START.
    const content = 'AAAAAAA padding padding. the quick brown fox jumped.'
    const c = createComment('the quick brown fox', 'human:me', 'note', undefined, undefined)
    // give it a STALE range pointing at the 'AAAAAAA' region (chars 0..7)
    const stale = { ...c, range: { from: 0, to: 7 } } as unknown as StoredMark
    const res = reanchorMarks(content, { [c.id]: stale })
    expect(res.orphaned).toHaveLength(0)
    const got = res.marks[c.id] as unknown as { range: { from: number; to: number } }
    // the corrected range must point at the actual quote location, not 0..7
    expect(content.slice(got.range.from, got.range.to)).toBe('the quick brown fox')
  })

  it('preserves a range that still correctly matches the quote', () => {
    const content = 'intro. the quick brown fox. outro.'
    const from = content.indexOf('the quick brown fox')
    const to = from + 'the quick brown fox'.length
    const c = createComment('the quick brown fox', 'human:me', 'note', undefined, undefined)
    const good = { ...c, range: { from, to } } as unknown as StoredMark
    const res = reanchorMarks(content, { [c.id]: good })
    expect(res.orphaned).toHaveLength(0)
    const got = res.marks[c.id] as unknown as { range: { from: number; to: number } }
    expect(got.range).toEqual({ from, to })
  })

  it('orphaned entries carry the id from the map key even when the stored value lacks id', () => {
    // simulate a StoredMark parsed from JSON: id is the map key, NOT a field on the value
    const stored = { kind: 'comment', by: 'human:me', at: '2026-06-07T00:00:00Z', quote: 'gone gone gone phrase', data: { text: 'x', resolved: false } } as unknown as StoredMark
    const res = reanchorMarks('completely unrelated content', { 'mark-123': stored })
    expect(res.marks['mark-123']).toBeDefined()
    expect(res.orphaned).toHaveLength(1)
    expect(res.orphaned[0].id).toBe('mark-123')
  })

  it('falls back to resolveMark for a mark with no quote (uses range)', () => {
    const stored = { kind: 'comment', by: 'human:me', at: '2026-06-07T00:00:00Z', quote: '', range: { from: 0, to: 4 }, data: { text: 'x', resolved: false } } as unknown as StoredMark
    const res = reanchorMarks('hello world', { 'm1': stored })
    // resolveMark: no quote, but range { from:0, to:4 } is valid in-bounds (0..4 within length 11) -> keeps it, not orphaned
    expect(res.orphaned).toHaveLength(0)
    expect(res.marks['m1']).toBeDefined()
  })
})
