import type { Command } from 'commander'

export function registerOpen(program: Command): void {
  program.command('open <file>').option('--port <n>').option('--no-autocommit').action(() => {})
}
