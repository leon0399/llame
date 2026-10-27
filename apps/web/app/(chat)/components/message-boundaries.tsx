import type { UIMessage } from "ai";

import { ModelSwitchBoundary } from "@workspace/ui/components/custom/model-switch-boundary";

import { CompactionBoundary } from "./compaction-boundary";

import type { AvailableModel } from "@/lib/services/models/queries";
import { modelSwitchPart, type Compaction } from "@/lib/services/chat/history";

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
        onInspectContext={() => onInspectContext(switchPart.data.runId)}
      />
    </div>
  ) : null;
  return { boundary, modelBoundary };
}
