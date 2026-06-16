import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { seedFragmentFromMarkdown, fragmentToMarkdown } from '../src/serialize'

// Regression for the loose-list crash: Milkdown's parser emits the `spread`
// (boolean) and `order` (number) list attributes as strings, and the y-prosemirror
// round-trip keeps them as strings. fragmentToMarkdown then calls
// schema.nodeFromJSON, which strictly validates attribute types and threw
// "Expected value of type boolean for attribute spread on type list_item, got string".
describe('fragmentToMarkdown with loose lists (spread/order attr coercion)', () => {
  it('round-trips a loose ordered list without an attribute-type RangeError', async () => {
    const md = ['1. First item', '', '2. Second item', '', '3. Third item'].join('\n')
    const doc = new Y.Doc()
    const frag = doc.getXmlFragment('prosemirror')
    await seedFragmentFromMarkdown(md, frag)

    const out = await fragmentToMarkdown(frag)

    expect(out).not.toBeNull()
    expect(out).toContain('First item')
    expect(out).toContain('Second item')
    expect(out).toContain('Third item')
  })

  it('round-trips a loose bullet list without an attribute-type RangeError', async () => {
    const md = ['- alpha', '', '- beta', '', '- gamma'].join('\n')
    const doc = new Y.Doc()
    const frag = doc.getXmlFragment('prosemirror')
    await seedFragmentFromMarkdown(md, frag)

    const out = await fragmentToMarkdown(frag)

    expect(out).not.toBeNull()
    expect(out).toContain('alpha')
    expect(out).toContain('beta')
    expect(out).toContain('gamma')
  })
})
