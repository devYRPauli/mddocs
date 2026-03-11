import { readFileSync } from 'node:fs';
import path from 'node:path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const editorSource = readFileSync(path.resolve(process.cwd(), 'src/editor/index.ts'), 'utf8');
  const filterSource = readFileSync(path.resolve(process.cwd(), 'src/editor/plugins/share-content-filter.ts'), 'utf8');
  const libraryGuardSource = readFileSync(path.resolve(process.cwd(), 'src/editor/plugins/library-content-guard.ts'), 'utf8');
  const collabClientSource = readFileSync(path.resolve(process.cwd(), 'src/bridge/collab-client.ts'), 'utf8');

  assert(
    editorSource.includes("import { collab, collabServiceCtx } from '@milkdown/plugin-collab';"),
    'Expected editor to import Milkdown collab plugin + service ctx',
  );
  assert(
    editorSource.includes('.use(collab)'),
    'Expected editor builder to register Milkdown collab plugin',
  );
  assert(
    editorSource.includes("import { history } from '@milkdown/plugin-history';")
      && editorSource.includes('.use(history)'),
    'Expected editor to keep history plugin for non-collab undo/redo',
  );
  assert(
    editorSource.includes('const collabService = ctx.get(collabServiceCtx);')
      && editorSource.includes('collabService.bindDoc(ydoc);')
      && editorSource.includes('collabService.connect();'),
    'Expected editor to bind runtime Y.Doc through collabServiceCtx',
  );
  assert(
    editorSource.includes('collabClient.setProjectionMarkdown')
      && editorSource.includes('collabClient.setMarksMetadata'),
    'Expected editor to publish projection markdown and marks metadata channels',
  );
  assert(
    editorSource.includes('private shouldPublishProjectionMarkdown(')
      && editorSource.includes("this.publishProjectionMarkdown(view, markdown, 'content-sync')")
      && editorSource.includes("if (this.isShareMode) return false;")
      && editorSource.includes("if (source === 'content-sync' && this.lastContentChangeSource !== 'local') return false;")
      && editorSource.includes('const metadata = getMarkMetadataWithQuotes(view.state);')
      && editorSource.includes('collabClient.setMarksMetadata(metadata);')
      && editorSource.includes('&& this.collabUnsyncedChanges === 0;'),
    'Expected debounced content sync to keep marks metadata in sync while blocking client-authored markdown projection publishes in live share collab unless local-edit checks and saved-state gates are satisfied outside share mode',
  );
  assert(
    editorSource.includes('this.recordContentChangeSource(\'local\');')
      && editorSource.includes("this.lastContentChangeSource = source;")
      && editorSource.includes("if (source === 'remote') {")
      && editorSource.includes('this.pendingProjectionPublish = false;')
      && editorSource.includes("this.shouldPublishProjectionMarkdown('direct-content')")
      && editorSource.includes("source === 'marks-change' || source === 'marks-flush'"),
    'Expected explicit local content updates to publish projection markdown while remote content changes clear stale pending publishes and marks-only paths remain markdown-read-only',
  );
  assert(
    editorSource.includes('this.resetProjectionPublishState();')
      && editorSource.includes('this.markInitialCollabHydrationComplete();')
      && editorSource.includes('this.kickCollabHydration();')
      && editorSource.includes('this.scheduleContentSync();')
      && editorSource.includes('private shouldAllowCollabTemplateSeed(session: { snapshotVersion: number } | null | undefined): boolean')
      && editorSource.includes('session.snapshotVersion === 0')
      && editorSource.includes('if (!this.collabCanEdit) {')
      && editorSource.includes('this.resetPendingCollabTemplateState(true);'),
    'Expected passive live-viewer join to reset publish state, avoid read-only template seeding, gate template seeding to brand-new snapshots only, and only allow projection publishes after hydration completes',
  );
  assert(
    editorSource.includes('refreshCollabSessionAndReconnect(preserveLocalState: boolean)')
      && editorSource.includes("collabClient.lastAuthenticationFailureReason")
      && editorSource.includes("this.scheduleCollabRecovery('auth-failure'")
      && editorSource.includes("this.scheduleCollabRecovery('expiring-session'")
      && editorSource.includes("this.scheduleCollabRecovery('stalled-collab'")
      && editorSource.includes('maybeRecoverStalledCollab()')
      && editorSource.includes('if (this.collabUnhealthySinceMs === null) return;')
      && editorSource.includes('this.collabRecoveryDelayMs')
      && editorSource.includes('this.collabRecoveryDebounceMs')
      && editorSource.includes('this.collabTypingQuietWindowMs')
      && editorSource.includes('private isTypingSessionProtected(): boolean {')
      && editorSource.includes('private scheduleCollabRecovery(')
      && editorSource.includes('private async runScheduledCollabRecovery(): Promise<void> {')
      && editorSource.includes('private shouldPreservePendingLocalCollabState(): boolean {')
      && editorSource.includes('private shouldDeferExpiringCollabRefresh(now: number): boolean {')
      && editorSource.includes('this.collabPendingLocalUpdates = status.pendingLocalUpdates;')
      && editorSource.includes("if (this.collabConnectionStatus === 'connected' && this.collabIsSynced) return;")
      && editorSource.includes('if (this.shouldDeferExpiringCollabRefresh(now)) return;')
      && editorSource.includes('this.pendingCollabTemplateMarkdown = this.shouldAllowCollabTemplateSeed(refreshed.session)')
      && editorSource.includes('const requiresHardReconnect = collabClient.requiresHardReconnect(refreshed.session);')
      && editorSource.includes('const softRefreshed = collabClient.softRefreshSession(refreshed.session);'),
    'Expected collab recovery to queue reconnects behind a typing-protection gate and prefer soft session refresh before hard reconnect',
  );
  assert(
    editorSource.includes('const incomingMarks = (marks && typeof marks === \'object\' && !Array.isArray(marks))')
      && editorSource.includes('!this.collabIsSynced')
      && editorSource.includes('Object.keys(incomingMarks).length === 0')
      && editorSource.includes('Object.keys(this.lastReceivedServerMarks).length > 0')
      && editorSource.includes('this.applyLatestCollabMarksToEditor();')
      && editorSource.includes('private applyLatestCollabMarksToEditor(): void')
      && editorSource.includes('if (this.isEditorDocStructurallyEmpty()) return;')
      && editorSource.includes('setTimeout(() => this.applyLatestCollabMarksToEditor(), 150);'),
    'Expected collab marks hydration guard + post-sync replay for comment visibility after refresh',
  );
  assert(
    editorSource.includes('private teardownCollabRuntimeAfterTerminalRefreshFailure(): void')
      && editorSource.includes('this.disconnectCollabService();')
      && editorSource.includes('collabClient.disconnect();')
      && editorSource.includes('clearInterval(this.collabRefreshTimer);')
      && editorSource.includes('this.teardownCollabRuntimeAfterTerminalRefreshFailure();')
      && editorSource.includes('refreshed.error.status === 401 || refreshed.error.status === 403 || refreshed.error.status === 404 || refreshed.error.status === 410'),
    'Expected terminal collab refresh auth failures to tear down collab runtime state before UI downgrade',
  );
  assert(
    editorSource.includes('private ensureShareWebSocketConnection(): void')
      && editorSource.includes('this.shareWsUnsubscribe = shareClient.onMessage((message) => {')
      && editorSource.includes('this.handleShareWebSocketMessage(message);')
      && editorSource.includes('shareClient.connectWebSocket();')
      && editorSource.includes('scheduleShareDocumentUpdatedRefresh()')
      && editorSource.includes("if (this.collabUnsyncedChanges > 0) return;")
      && editorSource.includes("if (this.collabConnectionStatus === 'connected' && this.collabIsSynced) return;"),
    'Expected document.updated refresh wiring to skip healthy or unsynced live collab sessions',
  );
  assert(
    collabClientSource.includes("provider.on('stateless'")
      && collabClientSource.includes('const raw = container?.payload ?? container?.data ?? payload;')
      && collabClientSource.includes('const parsed = JSON.parse(raw);')
      && collabClientSource.includes("if (type === 'document.updated') {")
      && collabClientSource.includes('const canPreserveLocalState = preserveLocalState')
      && collabClientSource.includes('&& this.canPersistDurableUpdates(session.role)')
      && collabClientSource.includes('&& this.hasPendingLocalStateForReconnect();')
      && collabClientSource.includes('requiresHardReconnect(session: CollabSessionInfo): boolean {')
      && collabClientSource.includes('softRefreshSession(session: CollabSessionInfo): boolean {'),
    'Expected collab client stateless handler to parse payload wrappers and the runtime to distinguish soft session refreshes from hard reconnects',
  );

  assert(
    !editorSource.includes("if (!reconnectTemplate && this.lastMarkdown.trim().length > 0) {"),
    'Did not expect reconnect path to fall back to stale local markdown when local state preservation is disabled',
  );
  assert(
    editorSource.includes('private isYjsChangeOriginTransaction(transaction: any): boolean')
      && editorSource.includes('const ySyncMeta = transaction?.getMeta?.(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;')
      && editorSource.includes('private noteLocalContentMutation(): void {')
      && editorSource.includes('this.noteLocalContentMutation();')
      && editorSource.includes('if (this.isYjsChangeOriginTransaction(tr)) {'),
    'Expected suggestions interceptor to skip Yjs-origin transactions while local transaction interception still records local mutation activity',
  );
  assert(
    editorSource.includes('const hasWritableSession = this.collabEnabled && this.collabCanEdit;')
      && editorSource.includes('this.hasCompletedInitialCollabHydration')
      && editorSource.includes('const allowLocalEdits = hasWritableSession')
      && !editorSource.includes('const baseAllowLocalEdits = this.collabEnabled\n      && this.collabCanEdit\n      && this.collabConnectionStatus === \'connected\''),
    'Expected writable hydrated sessions to stay editable during transient reconnects instead of keying editability directly off connection health',
  );
  assert(
    filterSource.includes("key.startsWith('y-sync')")
      && filterSource.includes('const ySyncMeta = tr.getMeta(ySyncPluginKey);')
      && filterSource.includes('if (ySyncMeta !== undefined) return true;'),
    'Expected share content filter to allow Yjs-origin transactions (including initial hydration)',
  );
  assert(
    editorSource.includes('.use(libraryContentGuardPlugin)')
      && editorSource.includes('this.setLibraryContentGuardEnabled(isLibraryDocument && allowLocalEdits);')
      && editorSource.includes('private createShareBannerAuthCluster(): HTMLElement | null')
      && editorSource.includes('includeLibraryLink = false')
      && editorSource.includes("btn.setAttribute('aria-label', compactIcon ? 'More options' : 'Account menu');")
      && editorSource.includes("makeMenuButton('Log out'")
      && editorSource.includes("fetch('/api/auth/dashboard/logout'"),
    'Expected editor to register library guard and show account/logout controls in the share banner',
  );
  assert(
    libraryGuardSource.includes("const NOTES_SECTION_LABELS = new Set(['notes & pins', 'notes and pins'])")
      && libraryGuardSource.includes('function findNotesSectionRange(doc: ProseMirrorNode): { from: number; to: number } | null')
      && libraryGuardSource.includes('function selectionWithinAllowedRange(view: EditorView): boolean')
      && libraryGuardSource.includes('handleTextInput(view) {')
      && libraryGuardSource.includes('handlePaste(view, event) {')
      && libraryGuardSource.includes('beforeinput(view, event) {')
      && libraryGuardSource.includes("if (key.startsWith('y-sync')) return true;")
      && libraryGuardSource.includes('const ySyncMeta = tr.getMeta(ySyncPluginKey);')
      && libraryGuardSource.includes('if (stepFrom < allowedRange.from || stepTo > allowedRange.to) {'),
    'Expected library content guard to restrict local edits to Notes & Pins while allowing Yjs sync updates',
  );

  const removedHelpers = [
    'applyRemoteSnapshotIncremental(',
    'matchesCurrentCollabSnapshot(',
    'detectAccidentalSelfConcatenation(',
    'scheduleCollabResync(',
    'skipCollabPublishUntil',
    'showCollabConflictModal(',
  ];
  for (const symbol of removedHelpers) {
    assert(
      !editorSource.includes(symbol),
      `Did not expect legacy snapshot-era helper to remain: ${symbol}`,
    );
  }

  console.log('✓ milkdown collab wiring cutover checks');
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
