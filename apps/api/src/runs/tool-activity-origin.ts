/**
 * Who initiated a tool call (system-provided-skills D5).
 *
 * Tool activity has always been model-origin: the model asked for a call, and
 * the resulting observation belongs to the assistant turn as a tool part. Skill
 * activation is the first SYSTEM-origin caller — llame itself reads a package
 * because the user wrote `$name` — and its reads must not masquerade as
 * assistant tool calls. A tool part for one would tell the model it had
 * requested a read it never requested, and would put a fabricated call into the
 * durable transcript the UI replays.
 *
 * The discriminators below are read off the durable event payload, so recovery
 * on another worker reaches the same conclusion as the live path without any
 * extra state.
 */

import { isRecord } from '@workspace/runtime-safety';

/** The trusted origin of one tool call. Absent means model-origin. */
export type ToolActivityOrigin = 'skill-activation';

/**
 * Whether a durable event payload records a system-origin call.
 *
 * Deliberately permissive about everything else: the event payloads are read
 * field-by-field across four independent translation paths, so this only ever
 * answers the origin question and never narrows the payload's shape.
 */
export function isSystemOriginPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  return payload['origin'] === ORIGIN_SKILL_ACTIVATION;
}

/** The one system-origin discriminator shipped in this revision. */
export const ORIGIN_SKILL_ACTIVATION: ToolActivityOrigin = 'skill-activation';
