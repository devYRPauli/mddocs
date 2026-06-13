import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror'
import type { XmlFragment } from 'yjs'

// Boundary to upstream's headless Milkdown (server/milkdown-headless.ts). It
// builds the SAME ProseMirror schema + markdown serializer the browser editor
// uses, and runs in plain Node. We load it via a runtime (variable) specifier so
// our strict typecheck stays decoupled from @milkdown's types — this is the one
// place that touches it.
interface HeadlessParser {
  schema: { nodeFromJSON(json: unknown): unknown }
}
interface HeadlessModule {
  getHeadlessMilkdownParser(): Promise<HeadlessParser>
  serializeMarkdown(node: unknown): Promise<string>
}

const HEADLESS_SPECIFIER = '../../../server/milkdown-headless.js'
let modPromise: Promise<HeadlessModule> | undefined
let parserPromise: Promise<HeadlessParser> | undefined

async function getModule(): Promise<HeadlessModule> {
  if (!modPromise) modPromise = import(HEADLESS_SPECIFIER) as Promise<HeadlessModule>
  return modPromise
}
async function getParser(): Promise<HeadlessParser> {
  if (!parserPromise) parserPromise = getModule().then((m) => m.getHeadlessMilkdownParser())
  return parserPromise
}

// Remove proof* marks from ProseMirror JSON so document content serializes
// cleanly. Marks (comments/suggestions/provenance) are persisted separately via
// the Y.Doc marks map → the PROOF footer, so keeping them here would double-encode.
function stripProofMarks(json: unknown): unknown {
  if (Array.isArray(json)) return json.map(stripProofMarks)
  if (!json || typeof json !== 'object') return json
  const node = json as Record<string, unknown>
  const out: Record<string, unknown> = { ...node }
  if (Array.isArray(out.marks)) {
    const kept = (out.marks as Array<{ type?: string }>).filter(
      (m) => !(typeof m?.type === 'string' && m.type.startsWith('proof')),
    )
    if (kept.length > 0) out.marks = kept
    else delete out.marks
  }
  if (Array.isArray(out.content)) out.content = out.content.map(stripProofMarks)
  return out
}

// Serialize the live editor's `prosemirror` Y.XmlFragment to markdown. Returns
// null for an empty/contentless fragment so the caller never clobbers the file
// before the editor has populated it.
export async function fragmentToMarkdown(fragment: XmlFragment): Promise<string | null> {
  if (fragment.length === 0) return null
  const json = yXmlFragmentToProsemirrorJSON(fragment) as { content?: unknown[] }
  if (!json || !Array.isArray(json.content) || json.content.length === 0) return null
  const parser = await getParser()
  const node = parser.schema.nodeFromJSON(stripProofMarks(json))
  const mod = await getModule()
  return mod.serializeMarkdown(node)
}
