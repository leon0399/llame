"use client";

import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";

import type { ChatStatus, UIMessage } from "ai";
import type { StickToBottomContext } from "use-stick-to-bottom";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";

import { ChatLoadOlder } from "./chat-load-older";
import { CompactionBoundary } from "./compaction-boundary";
import { ChatMessageRow } from "./chat-message-row";
import { messageBoundaries } from "./message-boundaries";
import { FailedTurnRow } from "./failed-turn-row";
import { needsFailedTurnRow } from "./turn-action-rules";
import {
  messageRenderKey,
  messageSeqFromMetadata,
  type Compaction,
} from "@/lib/services/chat/history";
import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import type { FollowUpRunRequest } from "@/lib/services/chat/transport";
import type { AvailableModel } from "@/lib/services/models/queries";

type ChatTranscriptMessageProps = {
  chatId: string;
  message: UIMessage;
  index: number;
  isLast: boolean;
  compaction: Compaction | null;
  compactionIndex: number;
  availableModels: ReadonlyArray<AvailableModel>;
  status: ChatStatus;
  latestRun: ChatLatestRunResponse | null;
  onRegenerate: (request: FollowUpRunRequest) => void;
  onInspectContext: (runId: string) => void;
  onForked: (forkedChatId: string) => void;
};

/** Test-only render probe — fires when a memoized transcript row actually
 *  renders (not when memo bails). Used by the stream-tick harness. Counts
 *  render-phase invocations, including ones React may discard. */
let transcriptMessageRenderProbe: ((renderKey: string) => void) | null = null;

export function setTranscriptMessageRenderProbe(
  probe: ((renderKey: string) => void) | null,
): void {
  transcriptMessageRenderProbe = probe;
}

/** One row's boundary computation plus its `ChatMessageRow` — split out of
 *  `ChatTranscriptMessages` as its own self-contained region. Memoized so a
 *  streaming token on the live tail does not reconcile idle fat turns (80+
 *  tool headers) when `mergeTrustedModelContextParts` preserved their
 *  message identity. Default shallow compare is enough once parent props
 *  (`onForked`, `availableModels`, message refs) stay stable across ticks. */
const ChatTranscriptMessage = memo(function ChatTranscriptMessage({
  message,
  index,
  compaction,
  compactionIndex,
  availableModels,
  ...rowProps
}: ChatTranscriptMessageProps) {
  const renderKey = messageRenderKey(message);
  transcriptMessageRenderProbe?.(renderKey);
  const { boundary, modelBoundary } = messageBoundaries({
    message,
    index,
    compaction,
    compactionIndex,
    availableModels,
    onInspectContext: rowProps.onInspectContext,
  });

  return (
    <ChatMessageRow
      {...rowProps}
      renderKey={renderKey}
      message={message}
      availableModels={availableModels}
      boundary={boundary}
      modelBoundary={modelBoundary}
    />
  );
});

type ChatTranscriptCompactionBoundaryProps = {
  compaction: Compaction;
  availableModels: ReadonlyArray<AvailableModel>;
};

/** The trailing checkpoint boundary, shown when it lands after the last
 * loaded conversation row. Split out of `ChatTranscriptMessages` as its own
 * self-contained region. */
function ChatTranscriptCompactionBoundary({
  compaction,
  availableModels,
}: ChatTranscriptCompactionBoundaryProps) {
  return (
    <div className="mx-auto w-full max-w-3xl md:px-6">
      <CompactionBoundary compaction={compaction} models={availableModels} />
    </div>
  );
}

type ChatTranscriptMessagesProps = {
  chatId: string;
  displayMessages: Array<UIMessage>;
  compaction: Compaction | null;
  compactionIndex: number;
  availableModels: ReadonlyArray<AvailableModel>;
  status: ChatStatus;
  latestRun: ChatLatestRunResponse | null;
  onRegenerate: (request: FollowUpRunRequest) => void;
  onInspectContext: (runId: string) => void;
};

type ChatTranscriptMessageListProps = ChatTranscriptMessagesProps & {
  onForked: (forkedChatId: string) => void;
};

/** The mapped message rows only — kept separate so the parent stays under
 *  the per-function line budget after the stable `onForked` callback.
 *  Exported for the memo regression harness (stream-tick idle-row commits). */
export function ChatTranscriptMessageList({
  chatId,
  displayMessages,
  compaction,
  compactionIndex,
  availableModels,
  status,
  latestRun,
  onRegenerate,
  onInspectContext,
  onForked,
}: ChatTranscriptMessageListProps) {
  return displayMessages.map((message, index) => (
    <ChatTranscriptMessage
      key={`message-${messageRenderKey(message)}`}
      chatId={chatId}
      message={message}
      index={index}
      isLast={index === displayMessages.length - 1}
      compaction={compaction}
      compactionIndex={compactionIndex}
      availableModels={availableModels}
      status={status}
      latestRun={latestRun}
      onRegenerate={onRegenerate}
      onInspectContext={onInspectContext}
      onForked={onForked}
    />
  ));
}

/** Every message row, plus the trailing compaction boundary when it lands
 *  after the last loaded message. Split out of `ChatTranscript` as its own
 *  self-contained region. */
function ChatTranscriptMessages(props: ChatTranscriptMessagesProps) {
  const { displayMessages, compaction, compactionIndex } = props;
  const onForked = useForkedChatNavigation();

  return (
    <>
      <ChatTranscriptMessageList {...props} onForked={onForked} />
      <ChatTranscriptFailedTurn {...props} />
      {/* All loaded messages are within the summarized span → boundary sits
          after the last one. */}
      {compaction && compactionIndex === displayMessages.length && (
        <ChatTranscriptCompactionBoundary
          compaction={compaction}
          availableModels={props.availableModels}
        />
      )}
    </>
  );
}

/** Lands a fork on the new Chat. Split out of `ChatTranscriptMessages` so that
 *  component composes only regions. */
function useForkedChatNavigation(): (forkedChatId: string) => void {
  const router = useRouter();
  return useCallback(
    (forkedChatId: string) => {
      router.push(`/chat/${forkedChatId}`);
    },
    [router],
  );
}

/** The latest turn's Regenerate when its Run left no reply to sit under
 *  (turn-actions D13). Render-nothing for every other transcript. */
function ChatTranscriptFailedTurn({
  chatId,
  displayMessages,
  latestRun,
  onRegenerate,
}: ChatTranscriptMessagesProps) {
  if (latestRun === null) return null;
  if (!needsFailedTurnRow(displayMessages, latestRun)) return null;
  return (
    <FailedTurnRow
      chatId={chatId}
      latestRun={latestRun}
      onRegenerate={onRegenerate}
    />
  );
}

/** The send/stream error alert. Split out of `ChatTranscriptBody` as its
 *  own self-contained region. */
function ChatTranscriptErrorAlert({ error }: { error: Error }) {
  return (
    <div className="max-w-3xl mx-auto">
      <Alert variant={"destructive"} className="w-full">
        <AlertTitle>Error: {error.name}</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    </div>
  );
}

type ChatTranscriptProps = {
  chatId: string;
  displayMessages: Array<UIMessage>;
  compaction: Compaction | null;
  compactionIndex: number;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  availableModels: ReadonlyArray<AvailableModel>;
  status: ChatStatus;
  latestRun: ChatLatestRunResponse | null;
  onRegenerate: (request: FollowUpRunRequest) => void;
  displayedError: Error | undefined;
  onInspectContext: (runId: string) => void;
};

/** The scrollable region's content: older-page loading, every message row,
 *  and a send/stream error. Split out of `ChatTranscript` as its own
 *  self-contained region — reuses its parent's full prop set. */
function ChatTranscriptBody(props: ChatTranscriptProps) {
  const {
    displayMessages,
    hasOlderMessages,
    isLoadingOlderMessages,
    onLoadOlderMessages,
    displayedError,
  } = props;
  return (
    <>
      <ChatLoadOlder
        hasOlder={hasOlderMessages}
        isLoading={isLoadingOlderMessages}
        onLoadOlder={onLoadOlderMessages}
        oldestMessageKey={
          displayMessages.length > 0
            ? messageRenderKey(displayMessages[0])
            : null
        }
      />
      <ChatTranscriptMessages {...props} />
      {displayedError && <ChatTranscriptErrorAlert error={displayedError} />}
    </>
  );
}

/**
 * Lands a `#msg-N` open on its target row (#1237). Runs from the component
 * that owns the `Conversation`, so it fires on the commit that first mounts
 * the transcript — which waits for the Markdown renderers, so the row exists —
 * after the stick-to-bottom context has attached. Layout effects run child
 * first, so `ChatLoadOlder`'s pre-paint bottom pin has already run (and
 * latched) by then; this scroll simply overrides it. What pulls the reader
 * back afterwards is every writer that runs on LATER frames while the lock
 * holds: the library's content ResizeObserver (its initial bottom snap and
 * each growth catch-up, a `scrollToBottom` whose rAF loop continues only
 * while `state.isAtBottom`) and `ChatLoadOlder`'s synchronous re-pin on
 * resize (gated on `isAtBottom` / `escapedFromLock`). `stopScroll` — the
 * library's own escape, what its wheel handler calls when the reader scrolls
 * up — clears `isAtBottom` and sets `escapedFromLock`, which disarms all of
 * them. Ordinary opens (no target) keep the bottom pin.
 */
function useTargetScroll(
  conversationRef: RefObject<StickToBottomContext | null>,
  displayMessages: Array<UIMessage>,
  targetSeq: number | null,
) {
  const targetLoaded =
    targetSeq !== null &&
    displayMessages.some(
      (message) => messageSeqFromMetadata(message.metadata) === targetSeq,
    );
  const scrolledTargetRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!targetLoaded || scrolledTargetRef.current === targetSeq) return;
    const target = document.getElementById(`msg-${targetSeq}`);
    if (!target) return;
    conversationRef.current?.stopScroll();
    target.scrollIntoView({ block: "center" });
    scrolledTargetRef.current = targetSeq;
  }, [conversationRef, targetLoaded, targetSeq]);
}

/** The scrollable message log. Split out of `ChatSessionContent` as its own
 *  self-contained region. */
export function ChatTranscript({
  targetSeq,
  ...props
}: ChatTranscriptProps & { targetSeq: number | null }) {
  const conversationRef = useRef<StickToBottomContext>(null);
  useTargetScroll(conversationRef, props.displayMessages, targetSeq);
  return (
    <div className="relative flex-1 overflow-hidden">
      {/* initial="instant": the reader must LAND at the newest message, not
          watch the page scroll from the top to it — with SSR-rendered
          history the smooth initial animation reads as a jump to the top
          and back down once hydration finishes.
          resize="instant": markdown/reasoning bodies are client-loaded
          through ChatMarkdownProvider before the transcript mounts, so on a
          hard reload growth should not come from empty shells filling in.
          Instant still covers streaming growth and older-page prepends. */}
      <Conversation
        className="h-full"
        initial="instant"
        resize="instant"
        contextRef={conversationRef}
      >
        {/* #187: tool/reasoning chrome uses content-visibility:auto
            (globals.css); message rows do not — they own scroll-anchor
            geometry. True list virtualization remains deferred until a
            several-thousand-message walk still measures heavy after that. */}
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {/* The message column's own rhythm: 20px gutters, 48px of air above
              and below, 48px between rows — the 32px the primitive's gap-8
              gave plus the 16px each row carried as a `space-y-4` margin.
              Both now come from this wrapper's gap-12, and its negative margin
              cancels the primitive's p-4 so the wrapper, not the component,
              sets the inset. */}
          <div className="-m-4 flex flex-col gap-12 px-5 py-12">
            <ChatTranscriptBody {...props} />
          </div>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
}
