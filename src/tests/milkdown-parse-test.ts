/**
 * Test Milkdown parsing of proofMark nodes
 */
import { Editor, rootCtx, defaultValueCtx, parserCtx, remarkPluginsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { remarkProofMarks, proofMarkHandler } from '../formats/remark-proof-marks.js';
import { 
  proofCommentAttr,
  proofCommentSchema,
} from '../editor/schema/proof-marks.js';

async function main() {
  const content = `# Test Document

This is a <span data-proof="comment" data-id="m123" data-by="human:test">test paragraph</span> for comments.`;

  const container = {
    // Mock container for milkdown
    ownerDocument: { defaultView: null },
    getRootNode: () => ({}),
    appendChild: () => {},
    removeChild: () => {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  } as any;

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, content);
    })
    .use(commonmark)
    .use(proofCommentAttr)
    .use(proofCommentSchema)
    .config((ctx) => {
      ctx.update(remarkPluginsCtx, (prev) => [...prev, remarkProofMarks]);
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        handlers: {
          ...(prev.handlers ?? {}),
          proofMark: proofMarkHandler,
        },
      }));
    })
    .create();

  const ctx = editor.ctx;
  const parser = ctx.get(parserCtx);
  const doc = parser(content);
  
  console.log('=== Parsed ProseMirror Document ===');
  console.log(JSON.stringify(doc.toJSON(), null, 2));
  
  // Check for marks
  const marks: any[] = [];
  doc.descendants((node: any) => {
    if (node.marks && node.marks.length > 0) {
      marks.push({
        text: node.text,
        marks: node.marks.map((m: any) => ({ type: m.type.name, attrs: m.attrs })),
      });
    }
  });
  
  console.log('\n=== Marks found ===');
  console.log(JSON.stringify(marks, null, 2));
}

main().catch(console.error);
