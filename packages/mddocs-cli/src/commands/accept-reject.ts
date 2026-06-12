import type { Command } from 'commander'

export function registerAcceptReject(program: Command): void {
  program.command('accept <id>').option('--file <f>').action(() => {})
  program.command('reject <id>').option('--file <f>').action(() => {})
}
