import type { Command } from 'commander'

export function registerHistory(program: Command): void {
  program.command('log <file>').action(() => {})
  program.command('diff <file> [rev]').action(() => {})
}
