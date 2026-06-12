import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveShare } from '../src/share'

let dir: string
let dist: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mddocs-share-'))
  dist = await mkdtemp(join(tmpdir(), 'mddocs-dist-'))
  // Minimal editor shell that references a relative asset (as the real one does).
  await writeFile(join(dist, 'index.html'), '<div id="editor"></div><script src="./assets/editor.js"></script>')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await writeFile(join(dist, 'assets', 'editor.js'), '/* editor bundle */ console.log("editor")')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(dist, { recursive: true, force: true })
})

function origin(url: string): string {
  return url.replace(/\/d\/.*/, '')
}

describe('serveShare bootstrap contract', () => {
  it('open-context (under /api) returns a valid CollabSessionInfo + doc', async () => {
    const p = join(dir, 'notes.md')
    await writeFile(p, '# Shared\n\nlive body.')
    const h = await serveShare(p, { autocommit: false, distDir: dist })

    // The editor's getApiBase() prefixes /api — the route must match exactly.
    const r = await fetch(`${origin(h.url)}/api/documents/${h.slug}/open-context`)
    expect(r.status).toBe(200)
    const payload = await r.json()

    expect(payload.doc.markdown).toContain('live body')
    expect(payload.doc.slug).toBe(h.slug)
    expect(payload.capabilities).toEqual({ canRead: true, canComment: true, canEdit: true })

    // session must satisfy share-client isCollabSessionInfo exactly
    const s = payload.session
    expect(typeof s.docId).toBe('string')
    expect(s.slug).toBe(h.slug)
    expect(s.role).toBe('editor')
    expect(s.shareState).toBe('ACTIVE')
    expect(typeof s.accessEpoch).toBe('number')
    expect(s.syncProtocol).toBe('pm-yjs-v1')
    expect(s.collabWsUrl).toMatch(/^ws:\/\/.+:\d+$/)
    expect(typeof s.token).toBe('string')
    expect(s.token.length).toBeGreaterThan(0)
    expect(typeof s.snapshotVersion).toBe('number')

    await h.stop()
  })

  it('serves the editor shell at /d/:slug but assets (under /d/) as real files', async () => {
    const p = join(dir, 'notes.md')
    await writeFile(p, '# Hi')
    const h = await serveShare(p, { autocommit: false, distDir: dist })

    // Bare document route -> the SPA shell.
    const shell = await fetch(h.url)
    expect(shell.status).toBe(200)
    expect(shell.headers.get('content-type')).toContain('text/html')
    expect(await shell.text()).toContain('id="editor"')

    // The shell's relative asset resolves to /d/assets/editor.js — this must
    // serve the JS bundle, NOT the HTML shell (the bug the browser caught).
    const asset = await fetch(`${origin(h.url)}/d/assets/editor.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(await asset.text()).toContain('editor bundle')

    await h.stop()
  })
})
