import { resolveQuote, resolveMark, normalizeQuote } from './proof'
import type { Mark, StoredMark } from './proof'
import type { ReanchorResult } from './types'

function rangeMatchesQuote(content: string, range: { from: number; to: number } | undefined, quote: string): boolean {
  if (!range) return false
  if (range.from < 0 || range.to > content.length || range.from >= range.to) return false
  return normalizeQuote(content.slice(range.from, range.to)) === normalizeQuote(quote)
}

export function reanchorMarks(
  content: string,
  marks: Record<string, StoredMark>,
): ReanchorResult {
  const out: Record<string, StoredMark> = {}
  const orphaned: Mark[] = []
  for (const [id, stored] of Object.entries(marks)) {
    const mark = stored as unknown as Mark
    const quote = (mark as { quote?: string }).quote

    if (quote && quote.length > 0) {
      if (rangeMatchesQuote(content, mark.range, quote)) {
        out[id] = { ...mark, orphaned: false } as unknown as StoredMark
        continue
      }
      const found = resolveQuote(content, quote)
      if (found) {
        out[id] = { ...mark, range: { from: found.from, to: found.to }, orphaned: false } as unknown as StoredMark
      } else {
        const flagged = { ...mark, orphaned: true }
        out[id] = flagged as unknown as StoredMark
        orphaned.push(flagged)
      }
      continue
    }

    // No quote: fall back to resolveMark (range-or-null).
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
