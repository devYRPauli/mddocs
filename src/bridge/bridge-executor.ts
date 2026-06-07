import { findBridgeRoute, type BridgeExecutorProof } from './bridge-routes';

type BridgeFailure = {
  success: false;
  error: string;
  code?: string;
  [key: string]: unknown;
};

export type BridgeExecutionResult = BridgeFailure | Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFailure(error: string, code?: string, extra: Record<string, unknown> = {}): BridgeFailure {
  return { success: false, error, code, ...extra };
}

function requireMethod<T extends (...args: never[]) => unknown>(
  target: Record<string, unknown>,
  method: string
): T {
  const candidate = target[method];
  if (typeof candidate !== 'function') {
    throw new Error(`window.proof.${method} is not available`);
  }
  return candidate.bind(target) as T;
}

function optionalMethod<T extends (...args: never[]) => unknown>(
  target: Record<string, unknown>,
  method: string
): T | undefined {
  const candidate = target[method];
  if (typeof candidate !== 'function') {
    return undefined;
  }
  return candidate.bind(target) as T;
}

function normalizeMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta || !isRecord(meta)) return undefined;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function mergeMetadata(
  base: Record<string, unknown> | undefined,
  extra: Record<string, unknown>
): Record<string, unknown> {
  return { ...(base ?? {}), ...extra };
}

function createProofAdapter(rawProof: Record<string, unknown>): BridgeExecutorProof {
  const getFullState = requireMethod<() => unknown>(rawProof, 'getFullState');
  const getAllMarks = requireMethod<() => unknown[]>(rawProof, 'getAllMarks');
  const markComment = requireMethod<(
    quote: string,
    by: string,
    text: string,
    meta?: Record<string, unknown>
  ) => unknown | null>(rawProof, 'markComment');
  const markCommentSelector = optionalMethod<(
    selector: Record<string, unknown>,
    by: string,
    text: string,
    meta?: Record<string, unknown>
  ) => unknown | null>(rawProof, 'markCommentSelector');
  const markSuggestReplace = requireMethod<(
    quote: string,
    by: string,
    content: string,
    range?: { from: number; to: number },
    meta?: Record<string, unknown>
  ) => unknown | null>(rawProof, 'markSuggestReplace');
  const markSuggestInsert = requireMethod<(
    quote: string,
    by: string,
    content: string,
    range?: { from: number; to: number },
    meta?: Record<string, unknown>
  ) => unknown | null>(rawProof, 'markSuggestInsert');
  const markSuggestDelete = requireMethod<(
    quote: string,
    by: string,
    range?: { from: number; to: number },
    meta?: Record<string, unknown>
  ) => unknown | null>(rawProof, 'markSuggestDelete');
  const markAccept = requireMethod<(markId: string) => boolean>(rawProof, 'markAccept');
  const markReject = requireMethod<(markId: string) => boolean>(rawProof, 'markReject');
  const markReply = requireMethod<(markId: string, by: string, text: string) => unknown | null>(rawProof, 'markReply');
  const markResolve = requireMethod<(markId: string) => boolean>(rawProof, 'markResolve');
  const rewriteDocument = requireMethod<(
    content: string,
    by: string,
    options?: { allowShareContentMutation?: boolean }
  ) => unknown>(rawProof, 'rewriteDocument');
  const getMarkdownSnapshot = optionalMethod<() => unknown>(rawProof, 'getMarkdownSnapshot');
  const looksLikeMarkdown = optionalMethod<(content: string) => boolean>(rawProof, 'looksLikeMarkdown');
  const setPresence = optionalMethod<(payload: Record<string, unknown>) => unknown>(rawProof, 'setPresence')
    ?? ((_payload: Record<string, unknown>) => ({ success: true }));

  return {
    getState: () => getFullState(),
    getMarks: () => getAllMarks(),
    markComment: (quote, by, text, meta) => markComment(quote, by, text, normalizeMetadata(meta)),
    markCommentSelector,
    markSuggestReplace: (quote, by, content, range, meta) => markSuggestReplace(
      quote,
      by,
      content,
      range,
      normalizeMetadata(meta)
    ),
    markSuggestInsert: (quote, by, content, range, meta) => markSuggestInsert(
      quote,
      by,
      content,
      range,
      mergeMetadata(normalizeMetadata(meta), { allowShareContentMutation: true })
    ),
    markSuggestDelete: (quote, by, range, meta) => markSuggestDelete(
      quote,
      by,
      range,
      normalizeMetadata(meta)
    ),
    markAccept: (markId) => markAccept(markId),
    markReject: (markId) => markReject(markId),
    markReply: (markId, by, text) => markReply(markId, by, text),
    markResolve: (markId) => markResolve(markId),
    rewrite: (params) => {
      const hasDirectContent = typeof params.content === 'string';
      const hasChanges = Array.isArray(params.changes);
      if (!hasDirectContent && !hasChanges) {
        return {
          success: false,
          code: 'validation_error',
          error: 'Missing content parameter',
          hint: 'Provide content or changes to /rewrite.',
          nextSteps: [
            'Fetch /state content first.',
            'Send {"content":"..."} for full rewrite or {"changes":[{"find":"...","replace":"..."}]} for targeted edits.',
            'Retry POST /rewrite.',
          ],
          marks: [],
        };
      }
      if (hasDirectContent && hasChanges) {
        return {
          success: false,
          code: 'validation_error',
          error: 'Provide either content or changes, not both',
          hint: 'Use exactly one rewrite mode per request.',
          nextSteps: [
            'Keep "content" for full document replacement.',
            'Use "changes" for find/replace operations.',
            'Retry POST /rewrite.',
          ],
          marks: [],
        };
      }

      const by = typeof params.by === 'string' && params.by.trim().length > 0
        ? params.by
        : 'ai:unknown';
      const allowPlainTextLoss = params.allowPlainTextLoss === true;
      const snapshot = getMarkdownSnapshot?.();
      const existingMarkdown = isRecord(snapshot) && typeof snapshot.content === 'string'
        ? snapshot.content
        : '';

      let incomingContent: string | null = null;
      if (hasDirectContent) {
        incomingContent = params.content as string;
      } else if (hasChanges) {
        let working = existingMarkdown;
        const changes = params.changes as unknown[];
        const invalidIndexes: number[] = [];
        const missingIndexes: number[] = [];
        for (let i = 0; i < changes.length; i += 1) {
          const change = changes[i];
          const changeObj = isRecord(change) ? change : {};
          const find = typeof changeObj.find === 'string' ? changeObj.find : null;
          const replace = typeof changeObj.replace === 'string' ? changeObj.replace : null;
          if (!find || replace === null) {
            invalidIndexes.push(i);
            continue;
          }
          if (!working.includes(find)) {
            missingIndexes.push(i);
            continue;
          }
          working = working.split(find).join(replace);
        }

        if (invalidIndexes.length > 0) {
          return {
            success: false,
            code: 'invalid_changes_payload',
            error: 'Each /rewrite change requires non-empty string fields "find" and "replace".',
            hint: 'At least one change entry is malformed.',
            nextSteps: [
              'Ensure each change object includes non-empty "find" and string "replace".',
              'Remove invalid change items listed in invalidIndexes.',
              'Retry POST /rewrite.',
            ],
            invalidIndexes,
            marks: [],
          };
        }

        if (missingIndexes.length > 0) {
          return {
            success: false,
            code: 'rewrite_changes_not_found',
            error: 'One or more /rewrite changes were not found in the current markdown.',
            hint: 'The document changed and find strings no longer match.',
            nextSteps: [
              'Fetch GET /state to get the latest markdown.',
              'Regenerate changes against current content.',
              'Retry POST /rewrite.',
            ],
            missingIndexes,
            marks: [],
          };
        }

        incomingContent = working;
      }

      if (typeof incomingContent !== 'string') {
        return {
          success: false,
          code: 'validation_error',
          error: 'Missing content parameter',
          hint: 'Rewrite requires content or changes payload.',
          marks: [],
        };
      }

      const detector = looksLikeMarkdown ?? (() => false);
      const incomingLooksMarkdown = detector(incomingContent) === true;
      const existingLooksMarkdown = detector(existingMarkdown) === true;
      if (!allowPlainTextLoss && !incomingLooksMarkdown && existingLooksMarkdown) {
        return {
          success: false,
          code: 'lossy_rewrite_blocked',
          error: 'Refusing potentially lossy rewrite: incoming content looks like plain text while the current document contains markdown formatting.',
          hints: [
            'Use /state.content as the rewrite source.',
            'If stripping formatting is intentional, call /rewrite with {"allowPlainTextLoss": true}.',
          ],
          marks: [],
        };
      }

      return rewriteDocument(incomingContent, by, { allowShareContentMutation: true });
    },
    setPresence: (payload) => setPresence(payload),
  };
}

export async function executeBridgeCall(
  method: string,
  path: string,
  body: Record<string, unknown>
): Promise<BridgeExecutionResult> {
  const route = findBridgeRoute(method, path);
  if (!route) {
    return toFailure(`Unknown route: ${method.toUpperCase()} ${path}`, 'UNKNOWN_ROUTE', {
      hint: 'Use one of the supported bridge routes.',
    });
  }

  const params = isRecord(body) ? body : {};
  for (const field of route.required ?? []) {
    if (params[field] === undefined) {
      return toFailure(`Missing required field: ${field}`, 'VALIDATION_ERROR', {
        hint: `Route ${route.method} ${route.path} requires "${field}".`,
      });
    }
  }

  const rawProof = (window as unknown as { proof?: unknown }).proof;
  if (!isRecord(rawProof)) {
    return toFailure('Editor not ready', 'EDITOR_NOT_READY', {
      hint: 'Wait for the document to finish loading in the browser tab, then retry.',
      retryable: true,
    });
  }

  try {
    const proof = createProofAdapter(rawProof);
    const result = await Promise.resolve(route.exec(proof, params));
    if (isRecord(result)) return result;
    if (result === undefined) return { success: true };
    return { success: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toFailure(message || 'Bridge execution failed', 'EXECUTION_ERROR');
  }
}
