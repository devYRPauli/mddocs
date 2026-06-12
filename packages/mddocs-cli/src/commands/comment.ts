import type { Command } from 'commander'

export function registerComment(program: Command): void {
  const cmd = program.command('comment').description('manage comments')
  cmd.command('add <file>').requiredOption('--quote <q>').requiredOption('--text <t>').action(() => {})
  cmd.command('ls <file>').option('--open').option('--resolved').option('--orphaned').action(() => {})
  cmd.command('reply <id>').requiredOption('--text <t>').option('--file <f>').action(() => {})
  cmd.command('resolve <id>').option('--file <f>').action(() => {})
}
