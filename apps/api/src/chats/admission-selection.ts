/**
 * The selection one chat-send admission resolves: the selector the request
 * named, the Chat's stored one, or `defaults.selector`; its model; the effort
 * in the spec's order; and the selection the Chat stores afterwards. Split out
 * of `chat-loop.service.ts` so the admission step and its result type stay
 * testable on their own.
 */

import {
  resolveSendSettings,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type ChatModelSelection } from '../models/model-selection';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type PermissionMode } from '../tools/permissions/permission-mode';

/** One owner admission's resolved selection, with the values its Run records. */
export type ResolvedOwnerSelection = {
  selector: string;
  modelId: string;
  effort: string | undefined;
  permissionMode: PermissionMode;
  /** The revision the Run records: the one this admission wrote, else the stored one. */
  selectionRevision: number | null;
  nextSelection: ChatModelSelection | undefined;
};

/**
 * Resolve the owner's selection for one admission against the selection the
 * Chat row stores. Throws the 422/503 the resolver reports, which rolls the
 * caller's transaction back.
 */
export function resolveOwnerSelection(input: {
  models: ModelSelectionValidator;
  instanceConfig: InstanceConfigReader;
  stored: ChatModelSelection | null;
  request: {
    selector: string | undefined;
    effort: string | undefined;
    permissionMode: PermissionMode;
  };
}): ResolvedOwnerSelection {
  const { request, stored } = input;

  const resolved = resolveSendSettings(
    input.models,
    input.instanceConfig.config.tools.permissionModes,
    {
      stored,
      request: { selector: request.selector, effort: request.effort },
      writer: 'owner',
      permissionMode: request.permissionMode,
    },
  );

  return {
    selector: resolved.selector,
    modelId: resolved.modelId,
    effort: resolved.effort,
    permissionMode: resolved.permissionMode,
    selectionRevision:
      resolved.nextSelection?.revision ?? stored?.revision ?? null,
    nextSelection: resolved.nextSelection,
  };
}
