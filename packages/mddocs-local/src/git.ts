import { dirname } from 'node:path'
import simpleGit, { type SimpleGit } from 'simple-git'
import type { Commit } from './types'

function gitFor(path: string): SimpleGit {
  return simpleGit(dirname(path))
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    return await simpleGit(dir).checkIsRepo()
  } catch {
    return false
  }
}

export async function commitFile(path: string, message: string): Promise<void> {
  const g = gitFor(path)
  await g.add(path)
  await g.commit(message, [path])
}

export async function history(path: string): Promise<Commit[]> {
  const g = gitFor(path)
  const log = await g.log({ file: path })
  return log.all.map((c) => ({
    hash: c.hash,
    date: c.date,
    author: c.author_name,
    message: c.message,
  }))
}

// Diff a file against the working tree, or against a given revision when `rev`
// is supplied. Returns the raw unified diff (empty string when unchanged).
export async function diff(path: string, rev?: string): Promise<string> {
  const g = gitFor(path)
  const args = rev ? [rev, '--', path] : ['--', path]
  return g.diff(args)
}
