import { describe, it, expect } from 'vitest'
import { applySuggestion } from '../src/apply'
import { proof } from '../src/index'

const C = '# Doc\n\nteh quick brown fox jumps\n'

describe('applySuggestion', () => {
  it('replace swaps the quoted span for the new content', () => {
    const m = proof.createReplaceSuggestion('teh', 'ai:test', 'the')
    expect(applySuggestion(C, m)).toBe('# Doc\n\nthe quick brown fox jumps\n')
  })

  it('delete removes the quoted span', () => {
    const m = proof.createDeleteSuggestion('quick', 'ai:test')
    expect(applySuggestion(C, m)).toBe('# Doc\n\nteh  brown fox jumps\n')
  })

  it('insert adds content immediately after the quoted span', () => {
    const m = proof.createInsertSuggestion('fox', 'ai:test', ' (red)')
    expect(applySuggestion(C, m)).toBe('# Doc\n\nteh quick brown fox (red) jumps\n')
  })

  it('throws when the quoted text is not found', () => {
    const m = proof.createReplaceSuggestion('zzz not here zzz', 'ai:test', 'x')
    expect(() => applySuggestion(C, m)).toThrow(/not found/)
  })

  it('throws when the mark is not a suggestion', () => {
    const m = proof.createComment('fox', 'ai:test', 'a note')
    expect(() => applySuggestion(C, m)).toThrow(/not a suggestion/)
  })
})
