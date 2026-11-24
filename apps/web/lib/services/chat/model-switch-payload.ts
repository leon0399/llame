/**
 * The `effective-context-change` payload this app renders: a planned model
 * change (cause `model`) or a failover switch inside a Run (cause `failover`,
 * carrying the closed failure class the transcript boundary labels). Split out
 * of `history.ts` when that notice module outgrew its line budget — this guard
 * is about the payload, not the wire envelope.
 */
import { isNonNullObject, isString, keysMatch } from "./context-item-envelope";

/**
 * The closed provider-failure vocabulary a `failover` switch records, with the
 * short owner-facing label the transcript boundary shows. Its keys mirror the
 * api's `FAILURE_CLASSES`; a class this build does not know keeps the item
 * untrusted instead of rendering an unlabelled boundary.
 */
export const FAILURE_LABELS = {
  quota_exhausted: "usage limit",
  billing: "billing limit",
  rate_limited: "rate limit",
  overloaded: "provider overload",
  server_error: "provider error",
  unreachable: "connection failure",
  first_token_timeout: "first-token timeout",
  stream_broken: "broken stream",
  model_not_found: "missing model",
  auth: "authentication failure",
  context_overflow: "context overflow",
  invalid_request: "invalid request",
  content_policy: "content policy refusal",
  unknown: "unknown failure",
} as const;

export type FailureClass = keyof typeof FAILURE_LABELS;

/** The `data.payload` shape of a model-switch context item. */
export type ModelSwitchPayload =
  | { cause: "model"; fromModelId: string; toModelId: string }
  | {
      cause: "failover";
      fromModelId: string;
      toModelId: string;
      failureClass: FailureClass;
    };

/** Whether the payload's two model ids are non-blank and actually differ. */
function holdsModelSwitchIds(value: {
  fromModelId?: unknown;
  toModelId?: unknown;
}): boolean {
  return (
    isString(value.fromModelId) &&
    value.fromModelId.trim().length > 0 &&
    isString(value.toModelId) &&
    value.toModelId.trim().length > 0 &&
    value.fromModelId !== value.toModelId
  );
}

/** The `data.payload` shape of a model-switch context item, validated on its
 *  own — a real sub-boundary of `isModelSwitchPart`, not an arbitrary split.
 *  Each cause has its own exact key set, so a `model` payload carrying a
 *  failure class (or a `failover` one missing it) is not trusted. */
export function isModelSwitchPayload(
  value: unknown,
): value is ModelSwitchPayload {
  if (!isNonNullObject(value)) return false;

  // SAFETY: the cause is read only to select the expected key set; every
  // field is validated before this function returns true.
  const candidate = value as {
    cause?: unknown;
    fromModelId?: unknown;
    toModelId?: unknown;
    failureClass?: unknown;
  };

  if (candidate.cause === "failover") {
    return (
      keysMatch(Object.keys(value), [
        "cause",
        "fromModelId",
        "toModelId",
        "failureClass",
      ]) &&
      holdsModelSwitchIds(candidate) &&
      isString(candidate.failureClass) &&
      Object.hasOwn(FAILURE_LABELS, candidate.failureClass)
    );
  }

  return (
    candidate.cause === "model" &&
    keysMatch(Object.keys(value), ["cause", "fromModelId", "toModelId"]) &&
    holdsModelSwitchIds(candidate)
  );
}
