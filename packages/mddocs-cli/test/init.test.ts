import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { buildProgram } from '../src/cli'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-init-'))
  await simpleGit(dir).init()
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function inDir<T>(fn: () => Promise<T>): Promise<T> {
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    return await fn()
  } finally {
    process.chdir(cwd)
  }
}

describe('init', () => {
  it('writes a .gitattributes marking .md as diffable text', async () => {
    await inDir(() => buildProgram().parseAsync(['node', 'mddocs', 'init']))
    const attrs = await readFile(join(dir, '.gitattributes'), 'utf8')
    expect(attrs).toContain('*.md')
  })

  it('is idempotent - does not duplicate the .md line on a second run', async () => {
    await inDir(async () => {
      await buildProgram().parseAsync(['node', 'mddocs', 'init'])
      await buildProgram().parseAsync(['node', 'mddocs', 'init'])
    })
    const attrs = await readFile(join(dir, '.gitattributes'), 'utf8')
    expect(attrs.match(/\*\.md/g)).toHaveLength(1)
  })

  it('preserves pre-existing .gitattributes content', async () => {
    await writeFile(join(dir, '.gitattributes'), '*.png binary\n')
    await inDir(() => buildProgram().parseAsync(['node', 'mddocs', 'init']))
    const attrs = await readFile(join(dir, '.gitattributes'), 'utf8')
    expect(attrs).toContain('*.png binary')
    expect(attrs).toContain('*.md')
  })
})
