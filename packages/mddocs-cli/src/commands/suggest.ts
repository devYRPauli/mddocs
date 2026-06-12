import type { Command } from 'commander'
import { loadDoc, saveDoc, proof } from 'mddocs-local'
import type { StoredMark } from 'mddocs-local'
import { actor } from '../util/resolve-file'

export function registerSuggest(program: Command): void {
  program.command('suggest <file>')
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
        throw new Error('suggest needs one of --replace, --insert, or --delete')
      }
      doc.marks[mark.id] = mark as unknown as StoredMark
      await saveDoc(file, doc.content, doc.marks)
      console.log(`added ${mark.kind} suggestion ${mark.id}`)
    })
}
