import type { Command } from 'commander'

export function registerSuggest(program: Command): void {
  program.command('suggest <file>')
    .requiredOption('--quote <q>')
    .option('--replace <c>')
    .option('--insert <c>')
    .option('--delete')
    .action(() => {})
}
