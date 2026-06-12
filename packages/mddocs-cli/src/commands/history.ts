import type { Command } from 'commander'
import { history, diff } from 'mddocs-local'

export function registerHistory(program: Command): void {
  program.command('log <file>')
    .description('show git history for a document')
    .action(async (file: string) => {
      const commits = await history(file)
      if (commits.length === 0) {
        console.log('no history (file not committed yet)')
        return
      }
      for (const c of commits) {
        console.log(`${c.hash.slice(0, 7)}  ${c.date}  ${c.author}  ${c.message}`)
      }
    })

  program.command('diff <file> [rev]')
    .description('show changes to a document (vs working tree, or a given revision)')
    .action(async (file: string, rev?: string) => {
      const out = await diff(file, rev)
      console.log(out.trim() === '' ? 'no changes' : out)
    })
}
