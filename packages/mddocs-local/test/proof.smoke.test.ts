import { describe, it, expect } from 'vitest'
import * as proof from '../src/proof'

describe('@proof/core boundary', () => {
  it('exposes the functions we depend on', () => {
    for (const name of [
      'extractMarks', 'embedMarks', 'hasMarks', 'resolveMark',
      'updateMarkRangesAfterEdit', 'createComment',
      'createInsertSuggestion', 'createReplaceSuggestion',
      'acceptSuggestion', 'rejectSuggestion', 'resolveComment',
    ]) {
      expect(typeof (proof as Record<string, unknown>)[name]).toBe('function')
    }
  })

  it('round-trips marks through embed/extract', () => {
    const md = '# Title\n\nHello world.'
    const mark = proof.createComment('Hello world.', 'human:tester', 'nice', undefined, undefined)
    const marks = { [mark.id]: mark as unknown as proof.StoredMark }
    const embedded = proof.embedMarks(md, marks)
    expect(embedded).toContain('PROOF')
    const { content, marks: out } = proof.extractMarks(embedded)
    expect(content.trim()).toBe(md.trim())
    expect(Object.keys(out)).toHaveLength(1)
  })
})
