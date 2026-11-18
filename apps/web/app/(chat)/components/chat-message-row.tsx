import type { ReactNode } from "react";

import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer";
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import { Message, MessageContent } from "@workspace/ui/components/message";
import type { ChatStatus, UIMessage } from "ai";
import { FileSearchIcon, PencilIcon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import { MessageActionButton } from "./message-action-button";
import {
  groupAssistantParts,
  groupReplyBlocks,
  type GroupedAssistantPart,
  type PlainPart,
} from "./group-assistant-parts";
import { StepsBlock } from "./message-steps";
import { hasVisibleContent, isVisibleSegment } from "./message-visibility";
import { InstructionsPart } from "./instructions-part";
import { HostNoticePart } from "./job-notice-part";
import { HostMessageRow } from "./host-message-row";
import { InterruptedNoticePart } from "./interrupted-notice-part";
import { MessageAttachments } from "./message-attachments";
import { MessageCopyButton } from "./message-copy-button";
import { MessageForkButton } from "./message-fork-button";
import { MessageUsage } from "./message-usage";
import { PromptImportsPart } from "./prompt-imports-part";
import { RegenerateNoticePart } from "./regenerate-notice-part";
import {
  CompactionDisabledNote,
  CompactionFailedNote,
} from "./compaction-notes";
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
  isInterruptedNoticePart,
  isInstructionsPart,
  isPromptImportsPart,
  isRegenerateNoticePart,
  isHostMessageMetadata,
  messageSeqFromMetadata,
  runIdFromMessageMetadata,
} from "@/lib/services/chat/history";

// Markdown/reasoning bodies come from `ChatMarkdownProvider` — never
// next/dynamic here. Dynamic still mounts an empty shell on first paint even
// after a bare import() preload; the page gates the transcript on these
// handles so bodies land in one paint. TODO(#417): server-rendered markdown
// per message under 'use cache' removes the client wait.

/** Renders one non-reasoning message part — text, a tool call/result, a
 *  step-cap notice, the instructions or prompt-imports chip, or a
 *  server-authored context item this build does not render (the walk
 *  withholds those before they reach here). */
function MessagePartView({
  part,
  renderers,
}: {
  part: PlainPart;
  renderers: ChatMarkdownRenderers;
}) {
  if (part.type === "text") {
    const MessageResponse = renderers.MessageResponse;

    return <MessageResponse>{part.text}</MessageResponse>;
  }

  if (part.type === "data-compaction-failed") {
    return <CompactionFailedNote />;
  }

  if (part.type === "data-compaction-disabled") {
    return <CompactionDisabledNote />;
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
      <MessageActionButton
        label="Edit"
        icon={PencilIcon}
        tooltip="Edit — coming soon"
        disabled
      />
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
        <MessageActionButton
          label="System prompt"
          icon={FileSearchIcon}
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

/** Empty answer starts do not move a streaming reply past its steps. */
function isVisibleReplySegment(segment: GroupedAssistantPart) {
  return (
    isVisibleSegment(segment) &&
    (segment.kind === "reasoning" ||
      segment.part.type !== "text" ||
      segment.part.text.trim() !== "")
  );
}

/** Walks the stored parts as blocks: each run of steps (thinking and tool
 *  calls) is one trace, and everything else renders in stored order. Only the
 *  last block of a reply that is still streaming can be running. */
function MessageSegments({
  parts,
  renderKey,
  renderers,
  streaming,
}: {
  parts: UIMessage["parts"];
  renderKey: string;
  renderers: ChatMarkdownRenderers;
  streaming: boolean;
}) {
  const blocks = groupReplyBlocks(
    groupAssistantParts(parts).filter(isVisibleReplySegment),
  );

  return blocks.map((block, at) => {
    if (block.kind === "steps") {
      return (
        <StepsBlock
          key={`message-steps-${renderKey}-${block.startIndex}`}
          block={block}
          running={streaming && at === blocks.length - 1}
          renderKey={renderKey}
          renderers={renderers}
        />
      );
    }

    return (
      <MessagePartView
        key={`message-part-${renderKey}-${block.index}`}
        part={block.part}
        renderers={renderers}
      />
    );
  });
}

/** Server-authored notices precede owner content in their stored order. */
function MessageNotice({ message }: { message: UIMessage }) {
  if (message.role !== "user") return null;

  return message.parts.map((part, index) => {
    if (isInterruptedNoticePart(part)) {
      return <InterruptedNoticePart key={index} />;
    }

    if (isRegenerateNoticePart(part)) {
      return <RegenerateNoticePart key={index} payload={part.data.payload} />;
    }

    return <HostNoticePart key={index} part={part} />;
  });
}

/** The row's body: the pending shimmer or the stored parts — the owner's in a
 *  bubble, the reply's flush with the column. A turn whose parts all paint
 *  nothing (an image-only owner message) keeps its row and footer but no empty
 *  bubble. */
function MessageBubble({
  from,
  mode,
  parts,
  renderKey,
  renderers,
  streaming,
}: {
  from: UIMessage["role"];
  mode: MessageRowMode;
  parts: UIMessage["parts"];
  renderKey: string;
  renderers: ChatMarkdownRenderers;
  streaming: boolean;
}) {
  if (mode === "pending") return <Shimmer as="span">Thinking…</Shimmer>;

  if (!hasVisibleContent(parts)) return null;

  const segments = (
    <MessageSegments
      parts={parts}
      renderKey={renderKey}
      renderers={renderers}
      streaming={streaming}
    />
  );

  return from === "user" ? (
    <Bubble align="end" variant="muted">
      <BubbleContent>{segments}</BubbleContent>
    </Bubble>
  ) : (
    segments
  );
}

function hostMessageRow(
  message: UIMessage,
  renderKey: string,
  boundary: ReactNode,
  modelBoundary: ReactNode,
): ReactNode | null {
  return message.role === "user" && isHostMessageMetadata(message.metadata) ? (
    <HostMessageRow
      message={message}
      renderKey={renderKey}
      boundary={boundary}
      modelBoundary={modelBoundary}
    />
  ) : null;
}

type VisibleChatMessageProps = {
  message: UIMessage;
  messageSeq: number | null;
  mode: MessageRowMode;
  renderKey: string;
  renderers: ChatMarkdownRenderers;
  footerProps: ChatMessageActionProps;
  isLast: boolean;
};

function VisibleChatMessage(props: VisibleChatMessageProps) {
  const { message, messageSeq, renderKey, footerProps, isLast } = props;
  const { status } = footerProps;

  return (
    // `Message` names the `group/message` the action row reveals on, so no
    // outer `group` can trigger it.
    <Message
      id={messageSeq === null ? undefined : `msg-${messageSeq}`}
      align={message.role === "user" ? "end" : "start"}
      data-message-key={renderKey}
    >
      <MessageContent>
        <MessageAttachments message={message} />
        <MessageNotice message={message} />
        <MessageBubble
          from={message.role}
          mode={props.mode}
          parts={message.parts}
          renderKey={renderKey}
          renderers={props.renderers}
          streaming={
            isLast && (status === "submitted" || status === "streaming")
          }
        />
        <ChatMessageFooter {...footerProps} isLast={isLast} />
      </MessageContent>
    </Message>
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

  const hostRow = hostMessageRow(message, renderKey, boundary, modelBoundary);

  if (hostRow !== null) return hostRow;

  const mode = messageRowMode({ message, isLast, status });

  return (
    <>
      {boundary}
      {modelBoundary}
      {mode === "hidden" ? null : (
        <VisibleChatMessage
          message={message}
          messageSeq={messageSeq}
          mode={mode}
          renderKey={renderKey}
          renderers={renderers}
          footerProps={footerProps}
          isLast={isLast}
        />
      )}
    </>
  );
}
