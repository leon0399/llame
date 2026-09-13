/**
 * Fork-specific conflict codes (#154 owner-chat-forks spec). Stable
 * discriminants for OpenAPI and client-side branching; the human-readable
 * message may change.
 */

import { ConflictException } from '@nestjs/common';

export const FORK_CONFLICT_CODES = {
  boundaryUnsettled: 'fork_boundary_unsettled',
  contextUnavailable: 'fork_context_unavailable',
} as const;

export type ForkConflictCode =
  (typeof FORK_CONFLICT_CODES)[keyof typeof FORK_CONFLICT_CODES];

function forkConflictBody(code: ForkConflictCode, message: string) {
  return { statusCode: 409, error: 'Conflict', message, code };
}

/** The anchor message belongs to an unfinished or retryable partial turn. */
export function throwBoundaryUnsettled(detail: string): never {
  throw new ConflictException(
    forkConflictBody(FORK_CONFLICT_CODES.boundaryUnsettled, detail),
  );
}

/** Required historical continuation state is unavailable. */
export function throwContextUnavailable(detail: string): never {
  throw new ConflictException(
    forkConflictBody(FORK_CONFLICT_CODES.contextUnavailable, detail),
  );
}
