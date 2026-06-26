import { Command } from 'commander'
import { registerComment } from './commands/comment'
import { registerSuggest } from './commands/suggest'
import { registerAcceptReject } from './commands/accept-reject'
import { registerHistory } from './commands/history'
import { registerOpen } from './commands/open'
import { registerServe } from './commands/serve'
import { registerResolve } from './commands/resolve'
import { registerInit } from './commands/init'

export function buildProgram(): Command {
  const program = new Command()
  program
    .name('mddocs')
    .description('Local-first git-native markdown collaboration')
    .version(process.env.MDDOCS_VERSION ?? '0.0.0-dev', '-v, --version')
  registerOpen(program)
  registerServe(program)
  registerComment(program)
  registerSuggest(program)
  registerAcceptReject(program)
  registerHistory(program)
  registerResolve(program)
  registerInit(program)
  return program
}
