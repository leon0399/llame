import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import {
  Message,
  MessageActions,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message";
import {
  Reasoning,
  ReasoningTrigger,
} from "@workspace/ui/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@workspace/ui/components/ai-elements/tool";
import { ModelSwitchBoundary } from "@workspace/ui/components/custom/model-switch-boundary";

import { getToolName, isToolUIPart, type ChatStatus, type UIMessage } from "ai";

import { CompactionBoundary } from "./compaction-boundary";
import { EffectiveContextAction } from "./effective-context-inspector";
import { MessageForkButton } from "./message-fork-button";
import { MessageUsage } from "./message-usage";
import { parseCapNoticePart, ToolCapNoticePart } from "./tool-cap-notice-part";

import type { AvailableModel } from "@/lib/services/models/queries";
import {
  messageSeqFromMetadata,
  modelSwitchPart,
  runIdFromMessageMetadata,
  type Compaction,
} from "@/lib/services/chat/history";

// TODO(#187/#417): these client-only chunks leave EMPTY message bubbles on a
// hard reload until they load — the transcript SSRs as shells (reasoning
// accordions, buttons, no bodies). The principled fix is server-rendered
// markdown per message under 'use cache' (messages are immutable, so the
// render caches perfectly), which belongs to the #417 Cache Components
// adoption; a chunk preload or skeleton placeholder is the acceptable
// stopgap until then. Do NOT paper over it with raw-text fallbacks.
const MessageResponse = dynamic(
  () =>
    import("@workspace/ui/components/ai-elements/message-response").then(
      (module) => module.MessageResponse,
    ),
  { ssr: false },
);
const ReasoningContent = dynamic(
  () =>
    import("@workspace/ui/components/ai-elements/reasoning-content").then(
      (module) => module.ReasoningContent,
    ),
  { ssr: false },
);

/** A tool call/result part — its own component since a tool's header + input
 *  + output block carries real internal structure. */
function ToolPartView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);
  const toolState =
    part.state === "output-error" &&
    part.resultProviderMetadata?.llame?.cancelled === true
      ? "cancelled"
      : (part.state ?? "input-streaming");
  return (
    <Tool>
      <ToolHeader
        type={`tool-${toolName}`}
        state={toolState}
        title={part.type === "dynamic-tool" ? toolName : undefined}
      />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput
          output={part.output}
          errorText={part.errorText}
          state={
            toolState === "cancelled"
              ? "cancelled"
              : part.state === "output-error"
                ? "output-error"
                : undefined
          }
        />
      </ToolContent>
    </Tool>
  );
}

/** Renders one message part — reasoning, text, a tool call/result, a
 *  step-cap notice, or a server-authored context item (never visible). */
function MessagePartView({ part }: { part: UIMessage["parts"][number] }) {
  if (part.type === "reasoning") {
    return (
      <Reasoning isStreaming={part.state === "streaming"} defaultOpen={false}>
        <ReasoningTrigger />
        <ReasoningContent>{part.text}</ReasoningContent>
      </Reasoning>
    );
  }
  if (part.type === "text") {
    return <MessageResponse>{part.text}</MessageResponse>;
  }
  if (isToolUIPart(part)) {
    return <ToolPartView part={part} />;
  }
  if (part.type === "data-cap-notice") {
    // Step-cap notice (D6): persisted alongside the tool call/result parts
    // when a run hits tools.maxStepsPerRun. Same part → same chip, live or
    // reloaded from history.
    const capNotice = parseCapNoticePart(part);
    return capNotice ? <ToolCapNoticePart {...capNotice} /> : null;
  }
  if (part.type === "data-context") {
    // Every server-authored context item, whatever its producer. They are
    // rendered into the MODEL's prompt by the api's context-builder and are
    // never visible chat content; the model-change boundary above this
    // message is the only owner-facing surface today. One branch rather
    // than a list of producers, so a producer this build does not know
    // about cannot fall through to the "unsupported part type" span and
    // print debug text into the owner's transcript on reload.
    return null;
  }
  return <span>unsupported part type: {part.type}</span>;
}

/** The usage/context affordances (assistant turns only) plus the persistent
 *  fork action row beneath a message's content. */
type ChatMessageActionProps = {
  message: UIMessage;
  availableModels: ReadonlyArray<AvailableModel>;
  chatId: string;
  status: ChatStatus;
  onForked: (forkedChatId: string) => void;
  onInspectContext: (runId: string) => void;
};

function ChatMessageFooter({
  message,
  availableModels,
  chatId,
  status,
  onForked,
  onInspectContext,
}: ChatMessageActionProps) {
  const isUserMessage = message.role === "user";
  const contextRunId = isUserMessage
    ? null
    : runIdFromMessageMetadata(message.metadata);

  return (
    <>
      {!isUserMessage && (
        <div className="flex flex-wrap items-center gap-1">
          <MessageUsage metadata={message.metadata} models={availableModels} />
          {contextRunId && (
            <EffectiveContextAction
              onClick={() => onInspectContext(contextRunId)}
            />
          )}
        </div>
      )}
      {(status === "ready" || status === "error") && (
        // Persistent action row (not hover-only) so the fork affordance
        // stays discoverable — reuses the shared MessageActions primitive
        // (the row future per-message actions, e.g. copy, will join). On
        // BOTH roles: the API forks from any message id regardless of role,
        // and this feature is pitched as "fork from any point" —
        // restricting the UI to assistant replies only would silently
        // narrow that to less than what ships.
        <MessageActions className="mt-1">
          <MessageForkButton
            chatId={chatId}
            fromMessageId={message.id}
            onForked={onForked}
          />
        </MessageActions>
      )}
    </>
  );
}

/** One row in the transcript: its compaction/model-switch boundary (if any),
 *  the message bubble with its parts, usage/context affordances, and the
 *  fork action. */
type ChatMessageRowProps = ChatMessageActionProps & {
  renderKey: string;
  boundary: ReactNode;
  modelBoundary: ReactNode;
};

export function ChatMessageRow({
  renderKey,
  boundary,
  modelBoundary,
  ...footerProps
}: ChatMessageRowProps) {
  const { message } = footerProps;
  const messageSeq = messageSeqFromMetadata(message.metadata);

  return (
    <>
      {boundary}
      {modelBoundary}
      {/* data-message-key anchors ChatLoadOlder's scroll compensation when
          older pages prepend. */}
      <Message
        id={messageSeq === null ? undefined : `msg-${messageSeq}`}
        from={message.role}
        data-message-key={renderKey}
      >
        <MessageContent>
          {message.parts.map((part, partIndex) => (
            <MessagePartView
              key={`message-part-${renderKey}-${partIndex}`}
              part={part}
            />
          ))}
        </MessageContent>
        <ChatMessageFooter {...footerProps} />
      </Message>
    </>
  );
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
 *  this index, or null for either when it doesn't apply here. */
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
        <CompactionBoundary
          summary={compaction.summary}
          createdAt={compaction.createdAt}
          stats={compaction.stats}
          models={availableModels}
        />
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
