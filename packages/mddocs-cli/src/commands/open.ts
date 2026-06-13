import type { Command } from 'commander'
import { serve, isGitRepo } from 'mddocs-local'
import { dirname } from 'node:path'
import { openBrowser } from '../util/open-browser'

export function registerOpen(program: Command): void {
  program.command('open <file>')
    .description('open the markdown file in the browser editor')
    .option('--port <n>', 'port to listen on', (v) => parseInt(v, 10))
    .option('--no-autocommit', 'do not auto-commit edits to git')
    .action(async (file: string, o: { port?: number; autocommit?: boolean }) => {
      const autocommit = o.autocommit !== false
      if (autocommit && !(await isGitRepo(dirname(file)))) {
        console.warn('mddocs: not a git repo - history/autocommit disabled. Run `mddocs init` + `git init` to enable.')
      }
      const handle = await serve(file, { port: o.port, autocommit })
      // The editor enters CLI mode (loads/saves this file) only when ?apiPort= is set.
      const url = `${handle.url}/?apiPort=${handle.port}`
      console.log(`mddocs: editing ${file} at ${url}  (Ctrl-C to stop)`)
      openBrowser(url)
      process.on('SIGINT', () => { void handle.stop().then(() => process.exit(0)) })
    })
}
