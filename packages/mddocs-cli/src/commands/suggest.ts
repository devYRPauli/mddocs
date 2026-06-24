import type { Command } from 'commander'
import { loadDoc, saveDoc, proof } from 'mddocs-local'
import type { StoredMark } from 'mddocs-local'
import { actor } from '../util/resolve-file'

const SUGGESTION_KINDS = ['insert', 'delete', 'replace']

export function registerSuggest(program: Command): void {
  const cmd = program.command('suggest').description('manage suggestions')

  cmd.command('add <file>')
    .requiredOption('--quote <q>')
    .option('--replace <c>', 'replace the quote with this text')
    .option('--insert <c>', 'insert this text at the quote')
    .option('--delete', 'suggest deleting the quote')
    .action(async (file: string, o: { quote: string; replace?: string; insert?: string; delete?: boolean }) => {
      const doc = await loadDoc(file)
      let mark
      if (o.replace !== undefined) {
        mark = proof.createReplaceSuggestion(o.quote, actor(), o.replace, undefined, undefined)
      } else if (o.insert !== undefined) {
        mark = proof.createInsertSuggestion(o.quote, actor(), o.insert, undefined, undefined)
      } else if (o.delete) {
        mark = proof.createDeleteSuggestion(o.quote, actor(), undefined, undefined)
      } else {
        throw new Error('suggest add needs one of --replace, --insert, or --delete')
      }
      doc.marks[mark.id] = mark as unknown as StoredMark
      await saveDoc(file, doc.content, doc.marks)
      console.log(`added ${mark.kind} suggestion ${mark.id}`)
    })

  // List suggestions and their status, so you can find the id to accept/reject
  // without leaving the terminal. Mirrors `comment ls`.
  cmd.command('ls <file>')
    .option('--pending', 'only pending suggestions')
    .option('--accepted', 'only accepted suggestions')
    .option('--rejected', 'only rejected suggestions')
    .option('--orphaned', 'only orphaned suggestions')
    .action(async (file: string, o: { pending?: boolean; accepted?: boolean; rejected?: boolean; orphaned?: boolean }) => {
      const doc = await loadDoc(file)
      for (const m of Object.values(doc.marks) as Array<Record<string, unknown>>) {
        if (!SUGGESTION_KINDS.includes(m.kind as string)) continue
        const data = (m.data ?? {}) as { status?: string; content?: string }
        const status = data.status ?? 'pending'
        if (o.pending && status !== 'pending') continue
        if (o.accepted && status !== 'accepted') continue
        if (o.rejected && status !== 'rejected') continue
        if (o.orphaned && !m.orphaned) continue
        const quote = String(m.quote ?? '')
        const content = data.content ?? ''
        const change =
          m.kind === 'replace' ? `replace "${quote}" -> "${content}"`
            : m.kind === 'insert' ? `insert "${content}" at "${quote}"`
              : `delete "${quote}"`
        const flags = `[${status}]${m.orphaned ? ' [orphaned]' : ''}`
        console.log(`${String(m.id)}  ${flags}  ${change}  (by ${String(m.by ?? '')})`)
      }
    })
}
