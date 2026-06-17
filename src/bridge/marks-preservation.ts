export function shouldPreserveMissingLocalMark(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'authored') return false;
  // Suggestions should not be force-preserved locally when missing from server marks;
  // accept/reject removes them and stale preservation causes reappearance loops.
  if (kind === 'insert' || kind === 'delete' || kind === 'replace') return false;
  const status = (value as { status?: unknown }).status;
  if (status === 'accepted' || status === 'rejected') return false;
  return true;
}

function countKeys(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  return Object.keys(value as Record<string, unknown>).length;
}

/**
 * Decide whether an empty incoming server-marks payload should be ignored rather
 * than applied (which would clear cached marks). The incoming path can briefly
 * deliver an empty marks map during sync/reconnect; applying it before the local
 * side has hydrated cached comments would drop those comments. This is the
 * incoming-side counterpart to {@link shouldPreserveMissingLocalMark}.
 *
 * Ignore (return true) only when there is genuinely cached state worth protecting
 * that the local side has not caught up to:
 * - non-empty incoming metadata is always authoritative (never ignored);
 * - with nothing cached, an empty payload is a legitimate clear;
 * - before the initial sync completes, an empty payload is not authoritative;
 * - once every preservable cached mark is present in local metadata, an empty
 *   server payload is a legitimate clear.
 */
export function shouldIgnoreIncomingEmptyServerMarks(args: {
  incomingMarks: Record<string, unknown>;
  cachedServerMarks: Record<string, unknown>;
  localMetadata: Record<string, unknown>;
  isSynced: boolean;
  unsyncedChanges: number;
}): boolean {
  const { incomingMarks, cachedServerMarks, localMetadata, isSynced } = args;
  if (countKeys(incomingMarks) > 0) return false;

  const cached = (cachedServerMarks && typeof cachedServerMarks === 'object' && !Array.isArray(cachedServerMarks))
    ? cachedServerMarks
    : {};
  const cachedKeys = Object.keys(cached);
  if (cachedKeys.length === 0) return false;

  if (!isSynced) return true;

  const local = (localMetadata && typeof localMetadata === 'object' && !Array.isArray(localMetadata))
    ? localMetadata
    : {};
  for (const key of cachedKeys) {
    if (!shouldPreserveMissingLocalMark(cached[key])) continue;
    if (!(key in local)) return true;
  }
  return false;
}
