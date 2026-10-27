/**
 * The request of a follow-up Run on an existing turn (turn-actions D1, D2).
 *
 * This layer admits Continue only; Regenerate joins with its own admission
 * layer, so the action vocabulary here is the subset that has a behaviour
 * behind it. The HTTP body is validated by the route's DTO; this module owns
 * the rules a body must satisfy whatever its transport.
 */

import { BadRequestException } from '@nestjs/common';

import { PermissionModeNotAvailableError } from '../models/models.service';
import { type PermissionMode } from '../tools/permissions/permission-mode';

/** The follow-up actions this layer can admit. */
export const ADMITTED_FOLLOW_UP_ACTIONS = ['continue'] as const;

export type AdmittedFollowUpAction =
  (typeof ADMITTED_FOLLOW_UP_ACTIONS)[number];

/** A follow-up request as the caller sent it, before its checks. */
export type FollowUpRequestInput = {
  action?: string;
  /** Continue takes its model from the Run it continues, so it names none. */
  modelId?: string;
  /** Continue takes its effort from the Run it continues, so it names none. */
  effort?: string;
  /** Absent means `default`, as on a chat send. */
  permissionMode?: PermissionMode;
};

export type ValidatedFollowUpRequest = {
  action: AdmittedFollowUpAction;
  permissionMode: PermissionMode;
};

/**
 * The checks that need no stored state: the action, the fields Continue
 * refuses, and the permission mode an operator has enabled. Every rejected
 * request is refused before the caller opens a transaction.
 */
export function validateFollowUpRequest(
  input: FollowUpRequestInput,
  permissionModes: ReadonlyArray<PermissionMode>,
): ValidatedFollowUpRequest {
  if (input.action !== 'continue') {
    throw new BadRequestException(
      `action must be one of ${ADMITTED_FOLLOW_UP_ACTIONS.join(', ')}`,
    );
  }
  // Continue keeps the model and the effort of the Run it continues: a
  // caller-supplied choice would be silently ignored otherwise.
  if (input.modelId !== undefined) {
    throw new BadRequestException('A continue request does not name a model');
  }
  if (input.effort !== undefined) {
    throw new BadRequestException('A continue request does not name an effort');
  }
  const permissionMode: PermissionMode = input.permissionMode ?? 'default';
  if (!permissionModes.includes(permissionMode)) {
    throw new PermissionModeNotAvailableError(permissionMode);
  }
  return { action: input.action, permissionMode };
}
