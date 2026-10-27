import type { ReactNode } from "react";

import {
  Message,
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
import { BashTool } from "@workspace/ui/components/custom/bash";
import { ConversationReadTool } from "@workspace/ui/components/custom/conversation-read";
import { EditTool } from "@workspace/ui/components/custom/edit";
import { GrepTool } from "@workspace/ui/components/custom/grep";
import { KnowledgeSearchTool } from "@workspace/ui/components/custom/knowledge-search";
import { McpTool } from "@workspace/ui/components/custom/mcp-tool";
import { ReadTool } from "@workspace/ui/components/custom/read";
import { SearchConversationsTool } from "@workspace/ui/components/custom/search-conversations";
import type { ToolPartProps } from "@workspace/ui/components/custom/tool-row";
import { WebSearchTool } from "@workspace/ui/components/custom/web-search";
import { WorkspaceTool } from "@workspace/ui/components/custom/workspace";
import { WriteTool } from "@workspace/ui/components/custom/write";
import {
  getToolName,
  isToolUIPart,
  type ChatStatus,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { PencilIcon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import { ComingSoonMessageAction } from "./coming-soon-message-action";
import { EffectiveContextAction } from "./effective-context-inspector";
import {
  groupAssistantParts,
  type NonReasoningPart,
} from "./group-assistant-parts";
import { hasVisibleContent, isVisibleSegment } from "./message-visibility";
import { InstructionsPart } from "./instructions-part";
import { MessageAttachments } from "./message-attachments";
import { MessageCopyButton } from "./message-copy-button";
import { MessageForkButton } from "./message-fork-button";
import { MessageUsage } from "./message-usage";
import { PromptImportsPart } from "./prompt-imports-part";
import { RegenerateNoticePart } from "./regenerate-notice-part";
import { parseCapNoticePart, ToolCapNoticePart } from "./tool-cap-notice-part";
import { TurnActions } from "./turn-actions";
import {
  useChatMarkdownRenderers,
  type ChatMarkdownRenderers,
} from "./use-chat-markdown-ready";

import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import type { FollowUpRunRequest } from "@/lib/services/chat/transport";
import type { AvailableModel } from "@/lib/services/models/queries";
import {
  isInstructionsPart,
  isPromptImportsPart,
  messageSeqFromMetadata,
  regenerateNoticePart,
  runIdFromMessageMetadata,
} from "@/lib/services/chat/history";
import { storedImageSources } from "@/lib/services/media/urls";

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

/** The dedicated row for a tool, or `null` when it has none. A stored
 *  `read` image result's thumbnail loads the `/model` route and its lightbox
 *  the `/original` route. */
function dedicatedToolRow(
  toolName: string,
  props: ToolPartProps,
  renderers: ChatMarkdownRenderers,
): ReactNode {
  switch (toolName) {
    case "read":
      return (
        <ReadTool
          {...props}
          Markdown={renderers.MessageResponse}
          mediaSources={storedImageSources}
        />
      );
    case "web_search":
      return <WebSearchTool {...props} Markdown={renderers.MessageResponse} />;
    case "bash":
      return <BashTool {...props} />;
    case "edit":
      return <EditTool {...props} />;
    case "write":
      return <WriteTool {...props} />;
    case "grep":
      return <GrepTool {...props} />;
    case "search_conversations":
      return <SearchConversationsTool {...props} />;
    case "conversation_read":
      return <ConversationReadTool {...props} />;
    case "knowledge_search":
      return <KnowledgeSearchTool {...props} />;
    case "enter_workspace":
    case "exit_workspace":
      return <WorkspaceTool {...props} name={toolName} />;
    default:
      return toolName.startsWith("mcp__") ? (
        <McpTool {...props} name={toolName} />
      ) : null;
  }
}

/** A tool call/result: its dedicated row, else the generic tool block. */
function ToolUIPartView({
  part,
  renderers,
}: {
  part: ToolUIPart | DynamicToolUIPart;
  renderers: ChatMarkdownRenderers;
}) {
  const row = dedicatedToolRow(
    getToolName(part),
    {
      input: part.input,
      output: part.output,
      errorText: part.errorText,
      state: toolHeaderState(part),
    },
    renderers,
  );
  return row ?? <ToolPartView part={part} />;
}

/** Renders one non-reasoning message part — text, a tool call/result, a
 *  step-cap notice, the instructions or prompt-imports chip, or a
 *  server-authored context item this build does not render (the walk
 *  withholds those before they reach here). */
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
    return <ToolUIPartView part={part} renderers={renderers} />;
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
  if (isPromptImportsPart(part)) {
    return <PromptImportsPart {...part.data.payload} />;
  }
  return <span>unsupported part type: {part.type}</span>;
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

/** The single action row beneath a message's content: the per-message
 *  actions, then (assistant turns only) the context and usage affordances.
 *  Fork shows on BOTH roles, since the API forks from any message id, and is
 *  disabled rather than removed while a turn streams so the row keeps its
 *  shape. */
type ChatMessageActionProps = {
  message: UIMessage;
  availableModels: ReadonlyArray<AvailableModel>;
  chatId: string;
  status: ChatStatus;
  onForked: (forkedChatId: string) => void;
  onInspectContext: (runId: string) => void;
  /** The Chat's newest Run, which decides the latest turn's turn-level
   *  actions, and the follow-up sender those actions call. */
  latestRun: ChatLatestRunResponse | null;
  onFollowUp: (request: FollowUpRunRequest) => void;
};

/**
 * The row the actions sit in, owned here rather than by the vendored
 * `MessageActions`: transparent until its message is hovered or holds focus,
 * yet always in layout, so revealing it never shifts the transcript. It
 * stays revealed while one of its popups (the usage card) is open, since
 * that card is portaled outside the hovered message. Where the primary input
 * cannot hover (touch), `group-hover` never matches, so the row stays
 * visible. It sits under the user bubble's right edge, and on replies pulls
 * left so the first icon lines up with the text.
 */
function MessageActionRow({
  from,
  children,
}: {
  from: UIMessage["role"];
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 group-has-[[data-popup-open]]/message:opacity-100 [@media(hover:none)]:opacity-100",
        from === "user" ? "justify-end" : "-ml-1.5",
      )}
    >
      {children}
    </div>
  );
}

type ChatMessageFooterProps = ChatMessageActionProps & { isLast: boolean };

/** Fork, disabled rather than removed while a turn streams. */
function MessageForkAction({
  message,
  chatId,
  status,
  onForked,
}: Pick<ChatMessageFooterProps, "message" | "chatId" | "status" | "onForked">) {
  return (
    <MessageForkButton
      chatId={chatId}
      fromMessageId={message.id}
      disabled={status !== "ready" && status !== "error"}
      onForked={onForked}
    />
  );
}

function UserMessageFooter(props: ChatMessageFooterProps) {
  return (
    <MessageActionRow from="user">
      <MessageCopyButton parts={props.message.parts} />
      <ComingSoonMessageAction label="Edit" icon={PencilIcon} />
      <MessageForkAction {...props} />
    </MessageActionRow>
  );
}

/** The reply's action row: per-message actions, the turn-level actions the
 *  latest turn alone offers, fork, then the context receipt and usage. */
function AssistantMessageFooter({
  message,
  availableModels,
  chatId,
  status,
  onForked,
  onInspectContext,
  latestRun,
  onFollowUp,
  isLast,
}: ChatMessageFooterProps) {
  return (
    <MessageActionRow from="assistant">
      <MessageCopyButton parts={message.parts} />
      {isLast && (
        <TurnActions
          chatId={chatId}
          latestRun={latestRun}
          reply={message}
          status={status}
          onFollowUp={onFollowUp}
        />
      )}
      <MessageForkAction
        message={message}
        chatId={chatId}
        status={status}
        onForked={onForked}
      />
      <AssistantContextActions
        metadata={message.metadata}
        availableModels={availableModels}
        onInspectContext={onInspectContext}
      />
    </MessageActionRow>
  );
}

function ChatMessageFooter(props: ChatMessageFooterProps) {
  return props.message.role === "user" ? (
    <UserMessageFooter {...props} />
  ) : (
    <AssistantMessageFooter {...props} />
  );
}

/** The reply's own affordances after the actions: the Run's context receipt,
 *  then its usage. */
function AssistantContextActions({
  metadata,
  availableModels,
  onInspectContext,
}: {
  metadata: unknown;
  availableModels: ReadonlyArray<AvailableModel>;
  onInspectContext: (runId: string) => void;
}) {
  const contextRunId = runIdFromMessageMetadata(metadata);
  return (
    <>
      {contextRunId && (
        <EffectiveContextAction
          onClick={() => onInspectContext(contextRunId)}
        />
      )}
      <MessageUsage metadata={metadata} models={availableModels} />
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

/** The regenerate notice a user turn carries (turn-actions D9/D13), rendered
 *  above its bubble with the transcript's context-item styling: the notice is
 *  server-authored context, not something the owner wrote. */
function MessageNotice({ message }: { message: UIMessage }) {
  const notice = message.role === "user" ? regenerateNoticePart(message) : null;
  if (notice === null) return null;
  return <RegenerateNoticePart payload={notice.data.payload} />;
}

/** The row's bubble: the pending shimmer or the stored parts. A turn whose
 *  parts all paint nothing (an image-only owner message) keeps its row and
 *  footer but no empty bubble. */
function MessageBubble({
  mode,
  parts,
  renderKey,
  renderers,
}: {
  mode: MessageRowMode;
  parts: UIMessage["parts"];
  renderKey: string;
  renderers: ChatMarkdownRenderers;
}) {
  if (mode !== "pending" && !hasVisibleContent(parts)) return null;
  return (
    <MessageContent>
      {mode === "pending" ? (
        <Shimmer as="span">Thinking…</Shimmer>
      ) : (
        <MessageSegments
          parts={parts}
          renderKey={renderKey}
          renderers={renderers}
        />
      )}
    </MessageContent>
  );
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
          // Names the group the action row reveals on, so no outer `group`
          // can trigger it.
          className="group/message"
          data-message-key={renderKey}
        >
          <MessageAttachments message={message} />
          <MessageNotice message={message} />
          <MessageBubble
            mode={mode}
            parts={message.parts}
            renderKey={renderKey}
            renderers={renderers}
          />
          <ChatMessageFooter {...footerProps} isLast={isLast} />
        </Message>
      )}
    </>
  );
}
