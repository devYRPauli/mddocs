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
// The prose body (identical on both sides of a footer-only conflict) is taken
// from before the conflict block; the footer is rebuilt from the union.
export function resolveFooterConflictText(raw: string): string {
  const match = raw.match(CONFLICT_RE)
  if (!match) return raw

  const [oursRaw, theirsRaw] = match[0]
    .replace(OURS_MARKER, '')
    .replace(THEIRS_MARKER, '')
    .split(SEPARATOR)

  const ours = (extractMarks(oursRaw ?? '').marks ?? {}) as Record<string, StoredMark>
  const theirs = (extractMarks(theirsRaw ?? '').marks ?? {}) as Record<string, StoredMark>
  const merged = unionMarks(ours, theirs)

  const prose = raw.slice(0, match.index ?? 0).replace(/\s+$/, '')
  return embedMarks(prose, merged)
}
