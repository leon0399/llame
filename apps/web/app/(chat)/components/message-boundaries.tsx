import type { UIMessage } from "ai";

import { ModelSwitchBoundary } from "@workspace/ui/components/custom/model-switch-boundary";

import { CompactionBoundary } from "./compaction-boundary";

import type { AvailableModel } from "@/lib/services/models/queries";
import { modelSwitchPart, type Compaction } from "@/lib/services/chat/history";
import type {
  FailureClass,
  ModelSwitchPayload,
} from "@/lib/services/chat/model-switch-payload";

/**
 * Short owner-facing labels for the closed failure classes a failover
 * boundary can name. Kept local to the web: the boundary component receives
 * only the label string, and the api's prompt prose keeps its own wording.
 */
const FAILURE_LABELS: Record<FailureClass, string> = {
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
};

/** Why a switch happened, when the item names a failover reason. */
function switchReason(payload: ModelSwitchPayload): string | undefined {
  return payload.cause === "failover"
    ? FAILURE_LABELS[payload.failureClass]
    : undefined;
}

type MessageBoundariesParams = {
  message: UIMessage;
  index: number;
  compaction: Compaction | null;
  compactionIndex: number;
  availableModels: ReadonlyArray<AvailableModel>;
  onInspectContext: (runId: string) => void;
};

/** The compaction and/or model-switch boundary that sits above a message at
 *  this index, or null for either when it doesn't apply here. Split out of
 *  `chat-message-row.tsx` when that module outgrew its line budget. */
export function messageBoundaries(params: MessageBoundariesParams) {
  const {
    message,
    index,
    compaction,
    compactionIndex,
    availableModels,
    onInspectContext,
  } = params;

  const switchPart = message.role === "user" ? modelSwitchPart(message) : null;

  const boundary =
    compaction && index === compactionIndex ? (
      <div
        key="compaction-boundary"
        className="mx-auto w-full max-w-3xl md:px-6"
      >
        <CompactionBoundary compaction={compaction} models={availableModels} />
      </div>
    ) : null;

  const modelBoundary = switchPart ? (
    <div className="mx-auto w-full max-w-3xl md:px-6">
      <ModelSwitchBoundary
        fromModelId={switchPart.data.payload.fromModelId}
        toModelId={switchPart.data.payload.toModelId}
        reason={switchReason(switchPart.data.payload)}
        onInspectContext={() => onInspectContext(switchPart.data.runId)}
      />
    </div>
  ) : null;

  return { boundary, modelBoundary };
}
