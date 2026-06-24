import type { Command } from 'commander'
import { basename } from 'node:path'
import { loadDoc, saveDoc, proof, applySuggestion } from 'mddocs-local'
import type { Mark } from 'mddocs-local'
import { fileForId } from '../util/resolve-file'
import { toArray, toRecord } from '../util/marks'
import { autoCommit } from '../util/commit'

const SUGGESTION_KINDS = ['insert', 'delete', 'replace']

export function registerAcceptReject(program: Command): void {
  // accept applies the suggested prose change to the body and keeps the mark as
  // an accepted record (status: accepted), preserving the original proposer's
  // `by` so the file retains who proposed the now-applied edit - symmetric with
  // reject, which keeps the mark as a rejected record.
  program.command('accept <id>')
    .option('--file <f>')
    .option('--no-commit', 'do not auto-commit the change to git')
    .action(async (id: string, o: { file?: string; commit?: boolean }) => {
      const file = await fileForId(id, o)
      const doc = await loadDoc(file)
      const stored = doc.marks[id]
      const mark = stored && ({ ...stored, id } as unknown as Mark)
      if (!mark || !SUGGESTION_KINDS.includes(mark.kind)) {
        throw new Error(`no suggestion with id ${id} in ${file}`)
      }
      const content = applySuggestion(doc.content, mark)
      const next = proof.acceptSuggestion(toArray(doc.marks), id)
      await saveDoc(file, content, toRecord(next))
      await autoCommit(file, `mddocs: accept suggestion (proposed by ${mark.by}) in ${basename(file)}`, o)
      console.log(`accepted ${id} (applied to ${file})`)
    })

  // reject records the decision on the mark; the prose is left unchanged.
  program.command('reject <id>')
    .option('--file <f>')
    .option('--no-commit', 'do not auto-commit the change to git')
    .action(async (id: string, o: { file?: string; commit?: boolean }) => {
      const file = await fileForId(id, o)
      const doc = await loadDoc(file)
      const proposer = (doc.marks[id] as unknown as { by?: string } | undefined)?.by ?? 'unknown'
      const next = proof.rejectSuggestion(toArray(doc.marks), id)
      await saveDoc(file, doc.content, toRecord(next))
      await autoCommit(file, `mddocs: reject suggestion (proposed by ${proposer}) in ${basename(file)}`, o)
      console.log(`rejected ${id}`)
    })
}
