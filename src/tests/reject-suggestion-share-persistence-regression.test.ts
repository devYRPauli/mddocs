import { readFileSync } from 'node:fs';
import path from 'node:path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const editorSource = readFileSync(path.resolve(process.cwd(), 'src/editor/index.ts'), 'utf8');
  const engineSource = readFileSync(path.resolve(process.cwd(), 'server/document-engine.ts'), 'utf8');

  const markRejectStart = editorSource.indexOf('markReject(markId: string): boolean {');
  assert(markRejectStart !== -1, 'Expected editor markReject implementation');

  const markRejectEnd = editorSource.indexOf('\n  /**\n   * Accept all pending suggestions', markRejectStart);
  assert(markRejectEnd !== -1, 'Expected to isolate markReject body');

  const markRejectBlock = editorSource.slice(markRejectStart, markRejectEnd);
  // This fork gates the share-mode persistence on a successful local reject
  // (`if (success && this.isShareMode)`) and refreshes from the authoritative reject
  // response inline via mergePendingServerMarks + setMarkMetadata, rather than
  // upstream's `applyAuthoritativeShareMarks`. The protected behavior is the same:
  // reject locally, snapshot local marks, persist through the dedicated reject
  // mutation, then reconcile - with no broad content/marks writes.
  assert(
    markRejectBlock.includes('if (success && this.isShareMode) {'),
    'Regression guard: rejecting a suggestion in share mode must persist via the dedicated mutation, not local collab-only writes',
  );
  assert(
    markRejectBlock.includes('success = rejectMark(view, markId);')
      && markRejectBlock.includes('const metadata = getMarkMetadataWithQuotes(view.state);')
      && markRejectBlock.includes('this.lastReceivedServerMarks = { ...metadata };')
      && markRejectBlock.includes('const actor = getCurrentActor();')
      && markRejectBlock.includes('void shareClient.rejectSuggestion(markId, actor).then((result) => {')
      && markRejectBlock.includes('mergePendingServerMarks(getMarkMetadataWithQuotes(innerView.state), serverMarks)'),
    'Expected markReject share mode to optimistically tombstone the local suggestion, snapshot local marks, and then refresh from the authoritative reject mutation response',
  );
  assert(
    markRejectBlock.includes("console.error('[markReject] Failed to persist suggestion rejection via share mutation:', error);"),
    'Expected markReject to log share mutation persistence failures for reject actions',
  );
  assert(!markRejectBlock.includes('shareClient.pushUpdate('), 'markReject must not require a content write to persist suggestion rejection');
  assert(!markRejectBlock.includes('shareClient.pushMarks('), 'markReject should not depend on a broad marks PUT when a dedicated reject mutation exists');
  assert(
    engineSource.includes("if (status === 'rejected') {")
      && engineSource.includes('bumpDocumentAccessEpoch(slug);')
      && engineSource.includes('invalidateCollabDocument(slug);')
      && engineSource.includes('return persistMarksAsync(')
      && engineSource.includes("code: 'COLLAB_SYNC_REQUIRED'")
      && engineSource.includes("code: 'COLLAB_SYNC_FAILED'"),
    'Expected server-side suggestion status persistence to stale out collab sessions for rejects and route non-rejected finalizations through the collab-aware persistence path',
  );

  const markRejectAllStart = editorSource.indexOf('markRejectAll(): number {');
  assert(markRejectAllStart !== -1, 'Expected editor markRejectAll implementation');

  const markRejectAllEnd = editorSource.indexOf('\n  /**\n   * Delete a mark by ID', markRejectAllStart);
  assert(markRejectAllEnd !== -1, 'Expected to isolate markRejectAll body');

  const markRejectAllBlock = editorSource.slice(markRejectAllStart, markRejectAllEnd);
  assert(
    markRejectAllBlock.includes('if (count > 0 && this.isShareMode && rejectedIds.length > 0) {'),
    'Expected markRejectAll share mode branch gated on a successful local reject-all',
  );
  assert(
    markRejectAllBlock.includes('rejectedIds = getPendingSuggestions(getMarks(view.state)).map((mark) => mark.id);')
      && markRejectAllBlock.includes('count = rejectAll(view);')
      && markRejectAllBlock.includes('const metadata = getMarkMetadataWithQuotes(view.state);')
      && markRejectAllBlock.includes('this.lastReceivedServerMarks = { ...metadata };')
      && markRejectAllBlock.includes('const actor = getCurrentActor();')
      && markRejectAllBlock.includes('const result = await shareClient.rejectSuggestion(suggestionId, actor);')
      && markRejectAllBlock.includes('mergePendingServerMarks(getMarkMetadataWithQuotes(innerView.state), latestServerMarks!)'),
    'Expected markRejectAll share mode to optimistically reject local suggestions, snapshot local marks, and then refresh from the authoritative reject mutation responses',
  );
  assert(
    !markRejectAllBlock.includes('shareClient.pushUpdate(')
      && !markRejectAllBlock.includes('shareClient.pushMarks('),
    'Expected markRejectAll share mode not to depend on broad content or marks writes for suggestion rejection',
  );

  console.log('✓ rejecting a suggestion persists share marks without content writes');
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
