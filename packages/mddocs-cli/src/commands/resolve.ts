import type { Command } from 'commander'
import { readFile, writeFile } from 'node:fs/promises'
import { hasFooterConflict, resolveFooterConflictText } from 'mddocs-local'

export function registerResolve(program: Command): void {
  program.command('resolve <file>')
    .description("resolve a git-conflicted PROOF footer by unioning both sides' marks")
    .action(async (file: string) => {
      const raw = await readFile(file, 'utf8')
      if (!hasFooterConflict(raw)) {
        console.log('no PROOF footer conflict to resolve')
        return
      }
      const merged = resolveFooterConflictText(raw)
      await writeFile(file, merged, 'utf8')
      console.log(`resolved conflicted PROOF footer in ${file} (unioned both sides' marks)`)
    })
}
