import { isRecord } from '@workspace/runtime-safety';

/**
 * A turn is complete iff its assistant message carries completed usage —
 * malformed/legacy usage counts as complete (never retryable by accident).
 * The structural parameter keeps this pure helper usable by both database
 * messages and ContextBuilder's StoredMessage.
 */
export function isCompletedAssistantTurn(message: {
  usage?: unknown;
}): boolean {
  const usage = message.usage;
  // Not `isRecord`'s own array exclusion changing anything here: an array
  // `usage` has no `status` property either way, so both branches already
  // agreed on "complete" before this swap.
  if (!isRecord(usage) || !('status' in usage)) {
    return true;
  }

  return usage['status'] === 'completed';
}
