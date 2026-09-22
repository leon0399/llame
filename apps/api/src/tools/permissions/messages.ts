import { isString, type ToolResult } from '@workspace/runtime-safety';

import { type PermissionRejectionReason } from './types';

/**
 * Code-owned model-visible rejection messages (openspec/changes/tool-call-permissions
 * spec "Safe decision provenance and non-fatal rejection", plus the web-read
 * change's hop rejection). Fixed templates: never interpolate rule text,
 * matched fragments, field names, paths, clause references, policy ids, or
 * secret values. These guide the model; they are not a sandbox claim.
 */

const EXPLICIT_REJECT =
  'Tool call rejected before execution by operator permissions. A reject rule matched. Do not retry this call, disguise the same action through different commands or tools, delegate it to another agent, or change permission settings to bypass the rejection. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.';

const NO_ALLOW =
  'Tool call rejected before execution by operator permissions. No allow rule permits this call. Do not retry this call, disguise the same action through different commands or tools, delegate it to another agent, or change permission settings to bypass the rejection. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.';

const INVALID_FIELD =
  'Tool call rejected before execution by operator permissions. The configured permission rule is incompatible with this tool. Do not retry this call or change permission settings yourself. Report the configuration problem to the user and continue with other permitted work. In-run approval is unavailable.';

const INPUT_LIMIT =
  'Tool call rejected before execution by operator permissions. The submitted input exceeds the permission inspection limit. Do not retry unchanged or evade a reject by splitting, encoding, switching tools, or delegating. A smaller request may be submitted only as independently permitted work. In-run approval is unavailable; explain any blocked required step to the user.';

/** The fixed hop-rejection template: never interpolated, so it is exported
 *  as-is for the client-side failure the web read builds. */
export const REJECTED_HOP_MESSAGE =
  'Tool call stopped by operator permissions. A redirect target was refused before its content was read; the refused target is in rejectedUrl. Do not retry this call, disguise the same target through another tool, or delegate it to another agent. In-run approval is unavailable. Continue with other permitted work; if this content is required, explain the blocked target to the user.';

/** The bound {@link rejectedHopUrl} applies to a refused hop locator before it
 *  is stored, and the bound every reader of a stored one re-checks. */
export const REJECTED_URL_BOUND = 2048;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const QUERY_OR_FRAGMENT = /[?#][\s\S]*$/u;

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

/** The refused locator shown to the model with {@link REJECTED_HOP_MESSAGE}:
 *  a server-chosen redirect target, so it travels as its origin and path only
 *  (query and fragment removed), bounded to 2,048 characters with control
 *  characters stripped. */
export function rejectedHopUrl(locator: string): string {
  // Strip first: the bound then counts the characters the model will read.
  const cleaned = locator.replace(CONTROL_CHARACTERS, '');
  return originAndPath(cleaned).slice(0, REJECTED_URL_BOUND);
}

/** Whether `value` is a locator {@link rejectedHopUrl} could have written: an
 *  absolute `http(s)` URL already in WHATWG serialization, with no userinfo,
 *  query, fragment, or control characters, within the bound. Every reader of a
 *  stored `rejectedUrl` renders the value only when this holds and drops
 *  anything else: a record that fails it was not produced here, so it is not
 *  echoed to the model. */
export function isRejectedHopUrl(value: unknown): value is string {
  if (
    !isString(value) ||
    value.length === 0 ||
    value.length > REJECTED_URL_BOUND ||
    value !== value.replace(CONTROL_CHARACTERS, '')
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.href === value
    );
  } catch {
    return false;
  }
}

function originAndPath(locator: string): string {
  try {
    const url = new URL(locator);
    return `${url.origin}${url.pathname}`;
  } catch {
    // A hop locator is always a serialized WHATWG href; anything else still
    // loses its query and fragment text rather than being echoed whole.
    return locator.replace(QUERY_OR_FRAGMENT, '');
  }
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
