import { dirname } from 'node:path'
import { commitFile, isGitRepo } from 'mddocs-local'

// Auto-commit a single managed file after a CLI mutation, with an action- and
// actor-specific message, so `mddocs log` reflects terminal edits the same way a
// live `serve` session auto-commits. No-op when the user passed --no-commit
// (commander sets opts.commit === false), when the file is not in a git repo, or
// when there is nothing to commit (the change stays in the working tree).
export async function autoCommit(
  file: string,
  message: string,
  opts: { commit?: boolean },
): Promise<void> {
  if (opts.commit === false) return
  if (!(await isGitRepo(dirname(file)))) return
  try {
    await commitFile(file, message)
  } catch {
    // nothing to commit, or git identity not configured: leave the edit staged
    // in the working tree rather than failing the command.
  }
}
