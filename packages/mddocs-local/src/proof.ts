// The single boundary to @proof/core. If upstream renames anything,
// fix it here and nowhere else.
export {
  extractMarks,
  embedMarks,
  hasMarks,
  resolveMark,
  resolveQuote,
  normalizeQuote,
  updateMarkRangesAfterEdit,
  createComment,
  createInsertSuggestion,
  createReplaceSuggestion,
  acceptSuggestion,
  rejectSuggestion,
  resolveComment,
  unresolveComment,
  getThread,
  createAuthored,
} from '@proof/core'

export type { Mark, MarkKind, MarkRange, StoredMark } from '@proof/core'
