// M1: id-only commands (resolve/reply/accept/reject) require an explicit --file.
// A global mark->file index can come in a later milestone.
export function fileForId(opts: { file?: string }): string {
  if (!opts.file) {
    throw new Error('This command needs --file <path> in M1 (id->file index is a later milestone).')
  }
  return opts.file
}

// Identity of the local author, used as the `by` field on new marks/replies.
export function actor(): string {
  return `human:${process.env.USER ?? 'unknown'}`
}
