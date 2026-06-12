import type { Command } from 'commander'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Keep .md files diffable as text; the PROOF footer rides along in the same file.
const MD_LINE = '*.md diff text'

export function registerInit(program: Command): void {
  program.command('init')
    .description('mark this repo as mddocs-managed (.gitattributes)')
    .action(async () => {
      const attrsPath = join(process.cwd(), '.gitattributes')
      let existing = ''
      try {
        existing = await readFile(attrsPath, 'utf8')
      } catch {
        existing = ''
      }
      const lines = existing.split('\n')
      if (lines.some((l) => l.trim().startsWith('*.md'))) {
        console.log('mddocs: already initialised (.gitattributes has a *.md rule)')
        return
      }
      const prefix = existing === '' || existing.endsWith('\n') ? existing : existing + '\n'
      await writeFile(attrsPath, `${prefix}${MD_LINE}\n`)
      console.log('mddocs: repo initialised (.gitattributes updated)')
    })
}
