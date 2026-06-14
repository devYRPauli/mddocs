import type { Command } from 'commander'
import { loadDoc, saveDoc, proof } from 'mddocs-local'
import type { StoredMark } from 'mddocs-local'
import { actor, fileForId } from '../util/resolve-file'
import { toArray, toRecord } from '../util/marks'

export function registerComment(program: Command): void {
  const cmd = program.command('comment').description('manage comments')

  cmd.command('add <file>')
    .requiredOption('--quote <q>')
    .requiredOption('--text <t>')
    .action(async (file: string, o: { quote: string; text: string }) => {
      const doc = await loadDoc(file)
      const mark = proof.createComment(o.quote, actor(), o.text, undefined, undefined)
      doc.marks[mark.id] = mark as unknown as StoredMark
      await saveDoc(file, doc.content, doc.marks)
      console.log(`added comment ${mark.id}`)
    })

  cmd.command('ls <file>')
    .option('--open', 'only unresolved comments')
    .option('--resolved', 'only resolved comments')
    .option('--orphaned', 'only orphaned comments')
    .action(async (file: string, o: { open?: boolean; resolved?: boolean; orphaned?: boolean }) => {
      const doc = await loadDoc(file)
      for (const m of Object.values(doc.marks) as Array<Record<string, unknown>>) {
        if (m.kind !== 'comment') continue
        const data = (m.data ?? {}) as { resolved?: boolean; text?: string }
        if (o.resolved && !data.resolved) continue
        if (o.open && data.resolved) continue
        if (o.orphaned && !m.orphaned) continue
        const flags = `${data.resolved ? '[resolved]' : '[open]'}${m.orphaned ? ' [orphaned]' : ''}`
        console.log(`${String(m.id)}  ${flags}  ${data.text ?? ''}`)
      }
    })

  cmd.command('reply <id>')
    .requiredOption('--text <t>')
    .option('--file <f>')
    .action(async (id: string, o: { text: string; file?: string }) => {
      const file = await fileForId(id, o)
      const doc = await loadDoc(file)
      const mark = doc.marks[id] as unknown as
        | { kind?: string; data?: { replies?: Array<{ by: string; at: string; text: string }> } }
        | undefined
      if (!mark || mark.kind !== 'comment') throw new Error(`no comment with id ${id} in ${file}`)
      mark.data = mark.data ?? {}
      mark.data.replies = [
        ...(mark.data.replies ?? []),
        { by: actor(), at: new Date().toISOString(), text: o.text },
      ]
      await saveDoc(file, doc.content, doc.marks)
      console.log(`replied to ${id}`)
    })

  cmd.command('resolve <id>')
    .option('--file <f>')
    .action(async (id: string, o: { file?: string }) => {
      const file = await fileForId(id, o)
      const doc = await loadDoc(file)
      const next = proof.resolveComment(toArray(doc.marks), id)
      await saveDoc(file, doc.content, toRecord(next))
      console.log(`resolved ${id}`)
    })
}
