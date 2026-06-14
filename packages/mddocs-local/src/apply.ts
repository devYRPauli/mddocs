import { resolveQuote } from './proof'
import type { Mark } from './proof'

// Apply an accepted suggestion's prose change to the markdown body, anchored by
// the suggestion's quote. Returns the rewritten content. Throws if the mark is
// not a suggestion or its quoted text can no longer be found.
export function applySuggestion(content: string, mark: Mark): string {
  const kind = mark.kind
  if (kind !== 'insert' && kind !== 'delete' && kind !== 'replace') {
    throw new Error(`mark ${mark.id} is a ${kind}, not a suggestion`)
  }
  const span = resolveQuote(content, mark.quote)
  if (!span) {
    throw new Error(`cannot apply suggestion ${mark.id}: quoted text not found`)
  }
  const { from, to } = span
  const replacement = (mark.data as { content?: string } | undefined)?.content ?? ''
  switch (kind) {
    case 'replace':
      return content.slice(0, from) + replacement + content.slice(to)
    case 'delete':
      return content.slice(0, from) + content.slice(to)
    case 'insert':
      return content.slice(0, to) + replacement + content.slice(to)
  }
}
