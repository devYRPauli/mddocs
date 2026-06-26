import type { Command } from 'commander'
import { relative } from 'node:path'
import { listManagedDocs, loadDoc } from 'mddocs-local'

const SUGGESTION_KINDS = ['insert', 'delete', 'replace']

type AnyMark = Record<string, unknown>

// Render one mark as a `status` line, mirroring the `comment ls` / `suggest ls`
// formats so the two views read the same.
function renderMark(m: AnyMark): string {
  const data = (m.data ?? {}) as { resolved?: boolean; status?: string; text?: string; content?: string }
  if (m.kind === 'comment') {
    const status = data.resolved ? 'resolved' : 'open'
    const flags = `[${status}]${m.orphaned ? ' [orphaned]' : ''}`
    return `  comment  ${String(m.id)}  ${flags}  ${data.text ?? ''}  by ${String(m.by ?? '')}`
  }
  const status = data.status ?? 'pending'
  const quote = String(m.quote ?? '')
  const content = data.content ?? ''
  const change =
    m.kind === 'replace' ? `replace "${quote}" -> "${content}"`
      : m.kind === 'insert' ? `insert "${content}" at "${quote}"`
        : `delete "${quote}"`
  const flags = `[${status}]${m.orphaned ? ' [orphaned]' : ''}`
  return `  ${String(m.kind)}  ${String(m.id)}  ${flags}  ${change}  by ${String(m.by ?? '')}`
}

// Decide whether a mark is included under the active filter.
function included(m: AnyMark, all: boolean): boolean {
  if (m.kind === 'comment') {
    const data = (m.data ?? {}) as { resolved?: boolean }
    return all || !data.resolved
  }
  if (SUGGESTION_KINDS.includes(m.kind as string)) {
    const data = (m.data ?? {}) as { status?: string }
    return all || (data.status ?? 'pending') === 'pending'
  }
  return false
}

export function registerStatus(program: Command): void {
  program.command('status')
    .description('show open comments and pending suggestions across all managed docs')
    .option('--all', 'include resolved comments and accepted/rejected suggestions')
    .action(async (o: { all?: boolean }) => {
      const cwd = process.cwd()
      const files = await listManagedDocs(cwd)
      let docCount = 0
      let openComments = 0
      let pendingSuggestions = 0

      for (const file of files.sort()) {
        let marks: Record<string, unknown>
        try {
          marks = (await loadDoc(file)).marks
        } catch {
          continue // skip unreadable docs, consistent with buildMarkIndex
        }
        const shown = (Object.values(marks) as AnyMark[]).filter((m) => included(m, !!o.all))
        if (shown.length === 0) continue
        docCount++
        console.log(relative(cwd, file))
        for (const m of shown) {
          console.log(renderMark(m))
          if (m.kind === 'comment') {
            const data = (m.data ?? {}) as { resolved?: boolean }
            if (!data.resolved) openComments++
          } else if (SUGGESTION_KINDS.includes(m.kind as string)) {
            const data = (m.data ?? {}) as { status?: string }
            if ((data.status ?? 'pending') === 'pending') pendingSuggestions++
          }
        }
      }

      if (docCount === 0) {
        console.log('Nothing open. All caught up.')
        return
      }
      const docWord = docCount === 1 ? 'doc' : 'docs'
      const cWord = openComments === 1 ? 'open comment' : 'open comments'
      const sWord = pendingSuggestions === 1 ? 'pending suggestion' : 'pending suggestions'
      console.log('')
      console.log(`${docCount} ${docWord} - ${openComments} ${cWord}, ${pendingSuggestions} ${sWord}`)
    })
}
