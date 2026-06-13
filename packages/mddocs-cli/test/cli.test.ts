import { describe, it, expect } from 'vitest'
import { buildProgram } from '../src/cli'

describe('cli program', () => {
  it('registers the M1 + M2 commands', () => {
    const program = buildProgram()
    const names = program.commands.map((c) => c.name()).sort()
    expect(names).toEqual(
      ['accept', 'comment', 'diff', 'init', 'log', 'open', 'reject', 'resolve', 'serve', 'suggest'].sort(),
    )
  })
})
