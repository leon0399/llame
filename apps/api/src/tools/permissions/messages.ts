import { type ToolResult } from '@workspace/runtime-safety';

import { type PermissionRejectionReason } from './types';

/**
 * Code-owned model-visible rejection messages (openspec/changes/tool-call-permissions
 * spec "Safe decision provenance and non-fatal rejection"). Fixed templates:
 * never interpolate rule text, matched fragments, field names, paths, clause
 * references, policy ids, or secret values. These guide the model; they are not
 * a sandbox claim.
 */

const EXPLICIT_REJECT =
  'Tool call rejected before execution by operator permissions. A reject rule matched. Do not retry this call, disguise the same action through different commands or tools, delegate it to another agent, or change permission settings to bypass the rejection. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.';

const NO_ALLOW =
  'Tool call rejected before execution by operator permissions. No allow rule permits this call. Do not retry this call, disguise the same action through different commands or tools, delegate it to another agent, or change permission settings to bypass the rejection. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.';

const INVALID_FIELD =
  'Tool call rejected before execution by operator permissions. The configured permission rule is incompatible with this tool. Do not retry this call or change permission settings yourself. Report the configuration problem to the user and continue with other permitted work. In-run approval is unavailable.';

const INPUT_LIMIT =
  'Tool call rejected before execution by operator permissions. The submitted input exceeds the permission inspection limit. Do not retry unchanged or evade a reject by splitting, encoding, switching tools, or delegating. A smaller request may be submitted only as independently permitted work. In-run approval is unavailable; explain any blocked required step to the user.';

/** The non-fatal `permission_denied` observation for a rejected call. */
export function permissionDeniedResult(
  reason: PermissionRejectionReason,
): ToolResult {
  return {
    status: 'error',
    type: 'permission_denied',
    message: messageFor(reason),
  };
}

function messageFor(reason: PermissionRejectionReason): string {
  switch (reason) {
    case 'explicit_reject':
      return EXPLICIT_REJECT;
    case 'invalid_field':
      return INVALID_FIELD;
    case 'input_limit':
      return INPUT_LIMIT;
    default:
      return NO_ALLOW;
  }
}
