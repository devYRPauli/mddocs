import type { Mark, StoredMark } from 'mddocs-local'

// @proof/core mark operations work on Mark[]; our doc model keys marks by id.
// These bridge the two without losing the id (the map key is authoritative).
export function toArray(marks: Record<string, StoredMark>): Mark[] {
  return Object.entries(marks).map(([id, m]) => ({ ...(m as unknown as Mark), id }))
}

export function toRecord(marks: Mark[]): Record<string, StoredMark> {
  return Object.fromEntries(marks.map((m) => [m.id, m as unknown as StoredMark]))
}
