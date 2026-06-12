import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveShare } from '../src/share'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mddocs-share-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('serveShare bootstrap contract', () => {
  it('open-context returns a valid CollabSessionInfo + doc the editor accepts', async () => {
    const p = join(dir, 'notes.md')
    await writeFile(p, '# Shared\n\nlive body.')
    const h = await serveShare(p, { autocommit: false })

    const r = await fetch(`${h.url.replace(/\/d\/.*/, '')}/documents/${h.slug}/open-context`)
    expect(r.status).toBe(200)
    const payload = await r.json()

    // doc + capabilities (fetchOpenContext requires both)
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

  it('serves the editor shell at /d/:slug', async () => {
    const p = join(dir, 'notes.md')
    await writeFile(p, '# Hi')
    const h = await serveShare(p, { autocommit: false })
    const r = await fetch(h.url)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/html')
    expect(await r.text()).toContain('id="editor"')
    await h.stop()
  })
})
