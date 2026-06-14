import type { Command } from 'commander'
import { loadDoc, saveDoc, proof, applySuggestion } from 'mddocs-local'
import type { Mark } from 'mddocs-local'
import { fileForId } from '../util/resolve-file'
import { toArray, toRecord } from '../util/marks'

const SUGGESTION_KINDS = ['insert', 'delete', 'replace']

export function registerAcceptReject(program: Command): void {
  // accept applies the suggested prose change to the body and consumes the
  // suggestion mark (it is now part of the text).
  program.command('accept <id>')
    .option('--file <f>')
    .action(async (id: string, o: { file?: string }) => {
      const file = await fileForId(id, o)
      const doc = await loadDoc(file)
      const stored = doc.marks[id]
      const mark = stored && ({ ...stored, id } as unknown as Mark)
      if (!mark || !SUGGESTION_KINDS.includes(mark.kind)) {
        throw new Error(`no suggestion with id ${id} in ${file}`)
      }
      const content = applySuggestion(doc.content, mark)
      const { [id]: _applied, ...rest } = doc.marks
      await saveDoc(file, content, rest)
      console.log(`accepted ${id} (applied to ${file})`)
    })

  // reject records the decision on the mark; the prose is left unchanged.
  program.command('reject <id>')
    .option('--file <f>')
    .action(async (id: string, o: { file?: string }) => {
      const file = await fileForId(id, o)
      const doc = await loadDoc(file)
      const next = proof.rejectSuggestion(toArray(doc.marks), id)
      await saveDoc(file, doc.content, toRecord(next))
      console.log(`rejected ${id}`)
    })
}
