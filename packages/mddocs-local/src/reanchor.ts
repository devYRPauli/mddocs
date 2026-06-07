import { resolveMark } from './proof'
import type { Mark, StoredMark } from './proof'
import type { ReanchorResult } from './types'

export function reanchorMarks(
  content: string,
  marks: Record<string, StoredMark>,
): ReanchorResult {
  const out: Record<string, StoredMark> = {}
  const orphaned: Mark[] = []
  for (const [id, stored] of Object.entries(marks)) {
    const mark = stored as unknown as Mark
    const resolved = resolveMark(content, mark)
    if (!resolved || resolved.orphaned) {
      const flagged = { ...mark, orphaned: true }
      out[id] = flagged as unknown as StoredMark
      orphaned.push(flagged)
    } else {
      out[id] = { ...mark, range: { from: resolved.from, to: resolved.to }, orphaned: false } as unknown as StoredMark
    }
  }
  return { marks: out, orphaned }
}
