/**
 * The `effective-context-change` payload this app renders: a planned model
 * change (cause `model`) or a failover switch inside a Run (cause `failover`,
 * carrying the closed failure class the transcript boundary labels). Split out
 * of `history.ts` when that notice module outgrew its line budget — this guard
 * is about the payload, not the wire envelope.
 */
import { isNonNullObject, isString, keysMatch } from "./context-item-envelope";

/**
 * The closed provider-failure vocabulary a `failover` switch records. Mirrors
 * the api's `FAILURE_CLASSES`; a class this build does not know keeps the item
 * untrusted instead of rendering an unlabelled boundary.
 */
export const FAILURE_CLASSES = [
  "quota_exhausted",
  "billing",
  "rate_limited",
  "overloaded",
  "server_error",
  "unreachable",
  "first_token_timeout",
  "stream_broken",
  "model_not_found",
  "auth",
  "context_overflow",
  "invalid_request",
  "content_policy",
  "unknown",
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

const FAILURE_CLASS_SET: ReadonlySet<string> = new Set(FAILURE_CLASSES);

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
      FAILURE_CLASS_SET.has(candidate.failureClass)
    );
  }

  return (
    candidate.cause === "model" &&
    keysMatch(Object.keys(value), ["cause", "fromModelId", "toModelId"]) &&
    holdsModelSwitchIds(candidate)
  );
}
