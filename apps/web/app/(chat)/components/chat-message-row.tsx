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
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolHeaderState,
} from "@workspace/ui/components/ai-elements/tool";
import { ModelSwitchBoundary } from "@workspace/ui/components/custom/model-switch-boundary";
import { ReadTool } from "@workspace/ui/components/custom/read";
import { WebSearchTool } from "@workspace/ui/components/custom/web-search";
import {
  getToolName,
  isToolUIPart,
  type ChatStatus,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";

import { CompactionBoundary } from "./compaction-boundary";
import { EffectiveContextAction } from "./effective-context-inspector";
import {
  groupAssistantParts,
  type GroupedAssistantPart,
  type NonReasoningPart,
} from "./group-assistant-parts";
import { InstructionsPart } from "./instructions-part";
import { MessageForkButton } from "./message-fork-button";
import { MessageUsage } from "./message-usage";
import { parseCapNoticePart, ToolCapNoticePart } from "./tool-cap-notice-part";
import {
  useChatMarkdownRenderers,
  type ChatMarkdownRenderers,
} from "./use-chat-markdown-ready";

import type { AvailableModel } from "@/lib/services/models/queries";
import {
  isInstructionsPart,
  messageSeqFromMetadata,
  modelSwitchPart,
  runIdFromMessageMetadata,
  type Compaction,
} from "@/lib/services/chat/history";

// Markdown/reasoning bodies come from `ChatMarkdownProvider` — never
// next/dynamic here. Dynamic still mounts an empty shell on first paint even
// after a bare import() preload; the page gates the transcript on these
// handles so bodies land in one paint. TODO(#417): server-rendered markdown
// per message under 'use cache' removes the client wait.

function toolHeaderState(
  part: ToolUIPart | DynamicToolUIPart,
): ToolHeaderState {
  return part.state === "output-error" &&
    part.resultProviderMetadata?.llame?.cancelled === true
    ? "cancelled"
    : (part.state ?? "input-streaming");
}

/** A tool call/result part — its own component since a tool's header + output
 *  block carries real internal structure. */
function ToolPartView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);
  const toolState = toolHeaderState(part);
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

/** One Thinking panel for a run of consecutive reasoning parts: the run is a
 *  single visual thought until a tool or visible text part interrupts it.
 *  `ReasoningContent` repairs glued summary headings at display; the parts
 *  themselves keep the provider's exact text. */
function ReasoningPanel({
  text,
  isStreaming,
  renderers,
}: {
  text: string;
  isStreaming: boolean;
  renderers: ChatMarkdownRenderers;
}) {
  const ReasoningContent = renderers.ReasoningContent;
  return (
    <Reasoning isStreaming={isStreaming} defaultOpen={false}>
      <ReasoningTrigger />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}

/** Renders one non-reasoning message part — text, a tool call/result, a
 *  step-cap notice, the instructions chip, or a server-authored context item
 *  this build does not render (the walk withholds those before they reach
 *  here). */
function MessagePartView({
  part,
  renderers,
}: {
  part: NonReasoningPart;
  renderers: ChatMarkdownRenderers;
}) {
  if (part.type === "text") {
    const MessageResponse = renderers.MessageResponse;
    return <MessageResponse>{part.text}</MessageResponse>;
  }
  if (isToolUIPart(part)) {
    const toolName = getToolName(part);
    if (toolName === "web_search" || toolName === "read") {
      const DedicatedTool = toolName === "read" ? ReadTool : WebSearchTool;
      return (
        <DedicatedTool
          input={part.input}
          output={part.output}
          errorText={part.errorText}
          state={toolHeaderState(part)}
          Markdown={renderers.MessageResponse}
        />
      );
    }
    return <ToolPartView part={part} />;
  }
  if (part.type === "data-cap-notice") {
    // Step-cap notice (D6): persisted alongside the tool call/result parts
    // when a run hits tools.maxStepsPerRun. Same part → same chip, live or
    // reloaded from history.
    const capNotice = parseCapNoticePart(part);
    return capNotice ? <ToolCapNoticePart {...capNotice} /> : null;
  }
  if (isInstructionsPart(part)) {
    return <InstructionsPart {...part.data.payload} />;
  }
  return <span>unsupported part type: {part.type}</span>;
}

/** Whether a grouped segment paints anything — the single rule `MessageSegments`
 *  walks with and `hasVisibleContent` asks ahead of the walk.
 *
 *  A provider that withholds the thinking text still returns the block,
 *  signed, and it must persist and replay unchanged — but a run of parts that
 *  carries no text (at all, or only whitespace) has nothing to show, so it
 *  renders no panel rather than an empty one.
 *
 *  `data-context` covers every server-authored context item, whatever its
 *  producer. They are rendered into the MODEL's prompt by the api's
 *  context-builder and are never visible chat content, except the
 *  `instructions` producer: its chip is the owner's disclosure of the files
 *  a trigger loaded, truncated, or had denied (design D9). The model-change
 *  boundary above the message remains the only owner-facing surface for the
 *  other producers. One branch rather than a list of producers, so a
 *  producer this build does not know about cannot fall through to the
 *  "unsupported part type" span and print debug text into the owner's
 *  transcript on reload. */
function isVisibleSegment(segment: GroupedAssistantPart): boolean {
  if (segment.kind === "reasoning") return segment.text.trim() !== "";
  if (segment.part.type === "data-context") {
    return isInstructionsPart(segment.part);
  }
  return true;
}

/**
 * Whether a message's stored parts paint anything at all. An assistant turn
 * with none is either the placeholder of a Run that has produced no output
 * yet or the empty turn a Run cancelled during its model request persists —
 * `messageRowMode` tells those apart.
 */
export function hasVisibleContent(parts: UIMessage["parts"]): boolean {
  return groupAssistantParts(parts).some(isVisibleSegment);
}

/** What one transcript row paints: its stored parts, the pending indicator in
 *  their place, or nothing at all. */
export type MessageRowMode = "content" | "pending" | "hidden";

/**
 * The row's render decision for an assistant turn with no visible content.
 *
 * While the chat is in flight the last row is the turn being produced, so it
 * carries the pending indicator — including after a Stop the server has not
 * settled yet (M3's S4), which is a state of the composer, not of the turn.
 * Any other such turn is either a live placeholder whose Run was stopped
 * before its model request, which persists no assistant message and which
 * history adoption keeps in the live list wherever later turns move it — that
 * row paints nothing, fork action included, because its id is a Run id — or a
 * persisted empty turn (it carries a `seq`), which renders as today so its
 * "stopped" usage stays readable.
 */
export function messageRowMode({
  message,
  isLast,
  status,
}: {
  message: UIMessage;
  isLast: boolean;
  status: ChatStatus;
}): MessageRowMode {
  if (message.role !== "assistant") return "content";
  if (hasVisibleContent(message.parts)) return "content";
  if (isLast && (status === "submitted" || status === "streaming")) {
    return "pending";
  }
  return messageSeqFromMetadata(message.metadata) === null
    ? "hidden"
    : "content";
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
  /** Whether this row is the transcript's last one, which is the turn a chat
   *  in flight is producing. */
  isLast: boolean;
};

/** Walks the stored parts as grouped segments, so consecutive reasoning parts
 *  share one Thinking panel and everything else renders in stored order. */
function MessageSegments({
  parts,
  renderKey,
  renderers,
}: {
  parts: UIMessage["parts"];
  renderKey: string;
  renderers: ChatMarkdownRenderers;
}) {
  return groupAssistantParts(parts).map((segment) => {
    if (!isVisibleSegment(segment)) return null;
    if (segment.kind !== "reasoning") {
      return (
        <MessagePartView
          key={`message-part-${renderKey}-${segment.index}`}
          part={segment.part}
          renderers={renderers}
        />
      );
    }
    return (
      <ReasoningPanel
        key={`message-part-${renderKey}-${segment.startIndex}`}
        text={segment.text}
        isStreaming={segment.isStreaming}
        renderers={renderers}
      />
    );
  });
}

export function ChatMessageRow({
  renderKey,
  boundary,
  modelBoundary,
  isLast,
  ...footerProps
}: ChatMessageRowProps) {
  const { message, status } = footerProps;
  const messageSeq = messageSeqFromMetadata(message.metadata);
  const renderers = useChatMarkdownRenderers();
  // Parent gates the transcript on renderers !== null; fail closed if a row
  // somehow mounts earlier rather than painting empty Streamdown shells.
  if (renderers === null) return null;

  const mode = messageRowMode({ message, isLast, status });
  // Live-only empty placeholders omit the bubble, but the compaction /
  // model-switch marker is about the transcript position — keep it.
  return (
    <>
      {boundary}
      {modelBoundary}
      {mode === "hidden" ? null : (
        // data-message-key anchors ChatLoadOlder's scroll compensation when
        // older pages prepend.
        <Message
          id={messageSeq === null ? undefined : `msg-${messageSeq}`}
          from={message.role}
          data-message-key={renderKey}
        >
          <MessageContent>
            {mode === "pending" ? (
              <Shimmer as="span">Thinking…</Shimmer>
            ) : (
              <MessageSegments
                parts={message.parts}
                renderKey={renderKey}
                renderers={renderers}
              />
            )}
          </MessageContent>
          <ChatMessageFooter {...footerProps} />
        </Message>
      )}
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
