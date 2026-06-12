import { Command } from 'commander'
import { registerComment } from './commands/comment'
import { registerSuggest } from './commands/suggest'
import { registerAcceptReject } from './commands/accept-reject'
import { registerHistory } from './commands/history'
import { registerOpen } from './commands/open'
import { registerServe } from './commands/serve'
import { registerInit } from './commands/init'

export function buildProgram(): Command {
  const program = new Command()
  program.name('mddocs').description('Local-first git-native markdown collaboration')
  registerOpen(program)
  registerServe(program)
  registerComment(program)
  registerSuggest(program)
  registerAcceptReject(program)
  registerHistory(program)
  registerInit(program)
  return program
}
