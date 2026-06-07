import { remarkProofMarks } from '../formats/remark-proof-marks.js';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';

const content = `# Test Document

This is a <span data-proof="comment" data-id="m123" data-by="human:test">test paragraph</span> for comments.

Another paragraph here.`;

const processor = unified()
  .use(remarkParse)
  .use(remarkProofMarks)
  .use(remarkStringify);

const tree = processor.parse(content);
console.log('=== Before remarkProofMarks ===');
console.log(JSON.stringify(tree, null, 2));

processor.runSync(tree);
console.log('\n=== After remarkProofMarks ===');
console.log(JSON.stringify(tree, null, 2));
