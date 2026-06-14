import { findFileForMark } from 'mddocs-local'

// Resolve the file an id-only command (resolve/reply/accept/reject) acts on.
// An explicit --file wins; otherwise scan the managed .md files and find the one
// holding the mark. Throws a clear hint when the id is nowhere to be found.
export async function fileForId(id: string, opts: { file?: string }): Promise<string> {
  if (opts.file) return opts.file
  const found = await findFileForMark(id, process.cwd())
  if (!found) {
    throw new Error(
      `could not find mark ${id} in any managed .md file under ${process.cwd()} ` +
        `(pass --file <path> to point at it directly)`,
    )
  }
  return found
}

// Identity of the local author, used as the `by` field on new marks/replies.
export function actor(): string {
  return `human:${process.env.USER ?? 'unknown'}`
}
