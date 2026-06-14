import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import simpleGit from 'simple-git'
import { loadDoc } from './doc'
import { isGitRepo } from './git'

// Mark id -> absolute path of the managed .md file that holds it.
export type MarkIndex = Map<string, string>

// All managed markdown files under cwd. Inside a git repo this is every tracked
// or untracked-but-not-ignored .md (so freshly created docs are found, ignored
// ones are not). Outside a repo it falls back to a plain directory walk.
export async function listManagedDocs(cwd: string): Promise<string[]> {
  if (await isGitRepo(cwd)) {
    const root = (await simpleGit(cwd).revparse(['--show-toplevel'])).trim()
    const out = await simpleGit(root).raw([
      'ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md',
    ])
    return out.split('\n').filter(Boolean).map((p) => resolve(root, p))
  }
  return walkMd(cwd)
}

async function walkMd(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walkMd(full)))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

// Scan every managed doc and map each mark id to its file. On the (UUID-rare)
// id collision the first file wins.
export async function buildMarkIndex(cwd: string): Promise<MarkIndex> {
  const index: MarkIndex = new Map()
  for (const file of await listManagedDocs(cwd)) {
    let marks: Record<string, unknown>
    try {
      marks = (await loadDoc(file)).marks
    } catch {
      continue
    }
    for (const id of Object.keys(marks)) {
      if (!index.has(id)) index.set(id, file)
    }
  }
  return index
}

export async function findFileForMark(id: string, cwd: string): Promise<string | undefined> {
  return (await buildMarkIndex(cwd)).get(id)
}
