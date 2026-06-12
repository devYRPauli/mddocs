import type { Command } from 'commander'

export function registerInit(program: Command): void {
  program.command('init').action(() => {})
}
