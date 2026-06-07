import { describe, it, expectTypeOf } from 'vitest'
import type { LoadedDoc, Commit, ReanchorResult } from '../src/types'
import type { Mark, StoredMark } from '../src/proof'

describe('engine types', () => {
  it('LoadedDoc has content + marks', () => {
    expectTypeOf<LoadedDoc>().toHaveProperty('content').toEqualTypeOf<string>()
    expectTypeOf<LoadedDoc>().toHaveProperty('marks').toEqualTypeOf<Record<string, StoredMark>>()
  })
  it('Commit and ReanchorResult are shaped correctly', () => {
    expectTypeOf<Commit>().toHaveProperty('hash').toEqualTypeOf<string>()
    expectTypeOf<ReanchorResult>().toHaveProperty('orphaned').toEqualTypeOf<Mark[]>()
  })
})
