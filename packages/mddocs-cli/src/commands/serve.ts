import type { Command } from 'commander'
import { serveShare, isGitRepo } from 'mddocs-local'
import { dirname } from 'node:path'
import { openBrowser } from '../util/open-browser'

export function registerServe(program: Command): void {
  program.command('serve <file>')
    .description('host a live multiplayer editing session (share the URL on your LAN)')
    .option('--port <n>', 'port to listen on', (v) => parseInt(v, 10))
    .option('--host <h>', 'interface to bind (use 0.0.0.0 to share on your LAN)', '127.0.0.1')
    .option('--no-autocommit', 'do not auto-commit edits to git')
    .action(async (file: string, o: { port?: number; host?: string; autocommit?: boolean }) => {
      const autocommit = o.autocommit !== false
      if (autocommit && !(await isGitRepo(dirname(file)))) {
        console.warn('mddocs: not a git repo — history/autocommit disabled. Run `mddocs init` + `git init` to enable.')
      }
      const handle = await serveShare(file, { port: o.port, host: o.host, autocommit })
      console.log(`mddocs: live session for ${file}`)
      console.log(`  open / share:  ${handle.url}`)
      console.log('  (everyone who opens the URL co-edits this file; Ctrl-C to stop)')
      openBrowser(handle.url)
      process.on('SIGINT', () => { void handle.stop().then(() => process.exit(0)) })
    })
}
