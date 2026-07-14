import { ConflictException } from '@nestjs/common';

/**
 * Archive guard (chat-project-archive). An archived item rejects every mutating
 * operation except unarchive and delete. Callers that perform an unarchive
 * (`PATCH archived=false`) must skip this check for that one operation.
 *
 * Throws `409 Conflict` so clients can distinguish "archived, can't edit" from
 * a malformed field (`400`) or an inaccessible resource (`404`).
 */
export function assertNotArchived(resource: {
  archivedAt: Date | null | undefined;
}): void {
  if (resource.archivedAt != null) {
    throw new ConflictException(
      'This item is archived; unarchive or delete it first.',
    );
  }
}
