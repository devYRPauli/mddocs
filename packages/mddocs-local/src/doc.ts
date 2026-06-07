import { readFile, writeFile, rename } from 'node:fs/promises'
import { extractMarks, embedMarks } from './proof'
import type { LoadedDoc } from './types'
import type { StoredMark } from './proof'

let _saveCounter = 0

export async function loadDoc(path: string): Promise<LoadedDoc> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: '', marks: {} }
    }
    throw err
  }
  const { content, marks } = extractMarks(raw)
  return { content, marks: (marks ?? {}) as Record<string, StoredMark> }
}

export async function saveDoc(
  path: string,
  content: string,
  marks: Record<string, StoredMark>,
): Promise<void> {
  const out = Object.keys(marks).length > 0 ? embedMarks(content, marks) : content
  const tmp = `${path}.tmp-${process.pid}-${Math.trunc(performance.now())}-${++_saveCounter}`
  await writeFile(tmp, out, 'utf8')
  await rename(tmp, path)
}
