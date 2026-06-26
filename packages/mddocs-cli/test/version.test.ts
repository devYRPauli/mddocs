import { describe, it, expect, afterEach } from 'vitest'
import { buildProgram } from '../src/cli'

describe('mddocs --version', () => {
  const orig = process.env.MDDOCS_VERSION
  afterEach(() => {
    if (orig === undefined) delete process.env.MDDOCS_VERSION
    else process.env.MDDOCS_VERSION = orig
  })

  it('reports MDDOCS_VERSION when set', () => {
    process.env.MDDOCS_VERSION = '9.9.9'
    expect(buildProgram().version()).toBe('9.9.9')
  })

  it('falls back to 0.0.0-dev when MDDOCS_VERSION is unset', () => {
    delete process.env.MDDOCS_VERSION
    expect(buildProgram().version()).toBe('0.0.0-dev')
  })
})
