import type { Command } from 'commander'
import { loadDoc, saveDoc, proof } from 'mddocs-local'
import type { Mark } from 'mddocs-local'
import { fileForId } from '../util/resolve-file'
import { toArray, toRecord } from '../util/marks'

// accept/reject share the same shape: resolve --file, apply a @proof/core
// status transition (accepted|rejected) to the suggestion, persist.
// M1 records the decision; applying the edit to prose is the editor's job.
function decide(
  apply: (marks: Mark[], id: string) => Mark[],
  verb: string,
) {
  return async (id: string, o: { file?: string }) => {
    const file = await fileForId(id, o)
    const doc = await loadDoc(file)
    const next = apply(toArray(doc.marks), id)
    await saveDoc(file, doc.content, toRecord(next))
    console.log(`${verb} ${id}`)
  }
}

export function registerAcceptReject(program: Command): void {
  program.command('accept <id>').option('--file <f>').action(decide(proof.acceptSuggestion, 'accepted'))
  program.command('reject <id>').option('--file <f>').action(decide(proof.rejectSuggestion, 'rejected'))
}
