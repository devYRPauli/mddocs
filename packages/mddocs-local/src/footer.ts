import { extractMarks, embedMarks } from './proof'
import type { StoredMark } from './proof'

// A git conflict block: a `<<<<<<<` line, anything, then a `>>>>>>>` line.
const CONFLICT_RE = /^<{7} .*$[\s\S]*?^>{7} .*$/m
const OURS_MARKER = /^<{7} .*$\n?/m
const THEIRS_MARKER = /^>{7} .*$\n?/m
const SEPARATOR = /^={7}.*$/m

export function hasFooterConflict(raw: string): boolean {
  return CONFLICT_RE.test(raw)
}

// Union marks by id. On an id collision, keep whichever side has the later
// `at` timestamp (last-writer-wins); ties keep the incoming (theirs) side.
function unionMarks(
  ours: Record<string, StoredMark>,
  theirs: Record<string, StoredMark>,
): Record<string, StoredMark> {
  const out: Record<string, StoredMark> = { ...ours }
  for (const [id, mark] of Object.entries(theirs)) {
    const existing = out[id] as unknown as { at?: string } | undefined
    const incoming = mark as unknown as { at?: string }
    if (!existing || (incoming.at ?? '') >= (existing.at ?? '')) out[id] = mark
  }
  return out
}

// Resolve a git-conflicted PROOF footer by unioning the marks from both sides.
// Reconstructs each side as a full document (text before the conflict + that
// side + text after) and runs extractMarks on each. This handles both shapes a
// merge produces: the whole `<!-- PROOF ... -->` block inside the conflict, OR
// (the common real-git case) only the differing JSON line conflicting while the
// `<!-- PROOF` / `-->` lines stay outside it. The prose is identical on both
// sides; the footer is rebuilt from the union.
export function resolveFooterConflictText(raw: string): string {
  const match = raw.match(CONFLICT_RE)
  if (!match || match.index === undefined) return raw

  const before = raw.slice(0, match.index)
  const after = raw.slice(match.index + match[0].length)

  const [oursSide, theirsSide] = match[0]
    .replace(OURS_MARKER, '')
    .replace(THEIRS_MARKER, '')
    .split(SEPARATOR)

  const oursDoc = extractMarks(before + (oursSide ?? '') + after)
  const theirsDoc = extractMarks(before + (theirsSide ?? '') + after)
  const merged = unionMarks(
    (oursDoc.marks ?? {}) as Record<string, StoredMark>,
    (theirsDoc.marks ?? {}) as Record<string, StoredMark>,
  )

  return embedMarks(oursDoc.content, merged)
}
