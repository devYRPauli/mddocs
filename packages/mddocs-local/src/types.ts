import type { Mark, StoredMark } from './proof'

export interface LoadedDoc {
  content: string
  marks: Record<string, StoredMark>
}

export interface Commit {
  hash: string
  date: string
  author: string
  message: string
}

export interface ReanchorResult {
  marks: Record<string, StoredMark>
  orphaned: Mark[]
}
