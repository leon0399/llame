"use client";

import { useEffect } from "react";

import type { UIMessage } from "ai";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";

import { useActiveRuns } from "@/contexts/active-runs-context";
import { useMessageTarget } from "@/lib/services/chat/message-target";
import type { Compaction } from "@/lib/services/chat/history";
import {
  shouldRenderChatOwner,
  shouldResumeChat,
} from "@/lib/services/chat/draft-session";
import type { DraftPhase } from "@/lib/services/chat/draft-route";

import { useChatSessionState } from "./use-chat-session-state";
import { useChatConversation } from "./use-chat-conversation";
import { ChatTranscript } from "./chat-transcript";
import { ChatComposer } from "./chat-composer";
import { EffectiveContextInspector } from "./effective-context-inspector";

// Module-level so a draft's empty history keeps a stable identity across
// renders — it is a dependency of the history-adoption effect inside
// `useChatHistorySync` (see use-chat-conversation.ts).
const EMPTY_MESSAGES: Array<UIMessage> = [];

export type ChatPageProps = {
  chatId: string;
  initialChatExists: boolean;
  initialDraftPhase: DraftPhase | null;
};

export function ChatPage({
  chatId,
  initialChatExists,
  initialDraftPhase,
}: ChatPageProps) {
  const { registerViewedChat } = useActiveRuns();
  const { resolveLatest, targetSeq } = useMessageTarget(chatId);

  // This page boundary owns foreground presence before any session data loads.
  // In particular, a rehydrated draft can wait with no ChatSessionContent while
  // its history query resolves; registering here prevents that loading window
  // from being misclassified as a background run completion.
  useEffect(() => registerViewedChat(chatId), [chatId, registerViewedChat]);

  // The server cannot see URL fragments. Keep the first client render equal to
  // the SSR shell, then mount exactly one history mode after the hash resolves.
  if (targetSeq === undefined) return null;

  return (
    <ChatSession
      key={`${chatId}:${targetSeq === null ? "latest" : targetSeq}`}
      chatId={chatId}
      initialChatExists={initialChatExists}
      initialDraftPhase={initialDraftPhase}
      onTargetSendFinished={resolveLatest}
      targetSeq={targetSeq}
    />
  );
}

type ChatSessionProps = {
  chatId: string;
  initialChatExists: boolean;
  initialDraftPhase: DraftPhase | null;
  onTargetSendFinished: () => void;
  targetSeq: number | null;
};

type ChatSessionRender =
  | { kind: "hidden" }
  | { kind: "unavailable" }
  | { kind: "ready"; contentProps: ChatSessionContentProps };

/** The render decision for one `ChatSession` mount, derived from its state
 *  hook: hidden while an owner-mounted draft recovers, unavailable when a
 *  target message's history probe failed, or the full `ChatSessionContent`
 *  props once history has resolved. Pure — no hooks — split out purely to
 *  shrink `ChatSession`'s own line count. */
function deriveChatSessionRender(
  chatId: string,
  targetSeq: number | null,
  sessionState: ReturnType<typeof useChatSessionState>,
): ChatSessionRender {
  const {
    session,
    historyQuery,
    onTargetSendInterrupted,
    onSendStarted,
    onSendFailed,
    onFinished,
  } = sessionState;

  if (!shouldRenderChatOwner(session)) return { kind: "hidden" };
  if (targetSeq !== null && historyQuery.data === undefined) {
    return historyQuery.isError ? { kind: "unavailable" } : { kind: "hidden" };
  }

  return {
    kind: "ready",
    contentProps: {
      chatId,
      chatMessages: historyQuery.data?.messages ?? EMPTY_MESSAGES,
      compaction: historyQuery.data?.compaction ?? null,
      hasOlderMessages: historyQuery.hasNextPage,
      isLoadingOlderMessages: historyQuery.isFetchingNextPage,
      onLoadOlderMessages: () =>
        // cancelRefetch: false — an intersection re-fire while a page is
        // already in flight must join it, not abort and restart it.
        void historyQuery.fetchNextPage({ cancelRefetch: false }),
      onFinished,
      onTargetSendInterrupted,
      onSendFailed,
      onSendStarted,
      resume: shouldResumeChat(session),
      targetSeq,
    },
  };
}

function ChatSession({
  chatId,
  initialChatExists,
  initialDraftPhase,
  onTargetSendFinished,
  targetSeq,
}: ChatSessionProps) {
  const sessionState = useChatSessionState({
    chatId,
    initialChatExists,
    initialDraftPhase,
    targetSeq,
    onTargetSendFinished,
  });
  const render = deriveChatSessionRender(chatId, targetSeq, sessionState);

  if (render.kind === "hidden") return null;
  if (render.kind === "unavailable") return <TargetUnavailable />;
  return <ChatSessionContent {...render.contentProps} />;
}

function TargetUnavailable() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 items-center px-5 py-12">
      <Alert variant="destructive">
        <AlertTitle>Message unavailable</AlertTitle>
        <AlertDescription>
          This message is no longer available in this chat.
        </AlertDescription>
      </Alert>
    </div>
  );
}

type ChatSessionContentProps = {
  chatId: string;
  chatMessages: Array<UIMessage>;
  compaction: Compaction | null;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  onFinished: () => boolean;
  onTargetSendInterrupted: () => boolean;
  onSendFailed: () => void;
  onSendStarted: () => void;
  resume: boolean;
  targetSeq: number | null;
};

type ChatSessionDialogProps = {
  dialog: ReturnType<typeof useChatConversation>["dialog"];
};

/** The effective-context inspector, wired to its own open/close slice of
 *  conversation state. Split out of `ChatSessionContent` as its own
 *  self-contained region. */
function ChatSessionDialog({ dialog }: ChatSessionDialogProps) {
  return (
    <EffectiveContextInspector
      runId={dialog.inspectedRunId}
      open={dialog.inspectedRunId !== null}
      onOpenChange={(open) => {
        if (!open) dialog.setInspectedRunId(null);
      }}
    />
  );
}

function ChatSessionContent(props: ChatSessionContentProps) {
  const {
    chatId,
    compaction,
    hasOlderMessages,
    isLoadingOlderMessages,
    onLoadOlderMessages,
  } = props;
  const { status, composer, transcript, dialog } = useChatConversation(props);

  return (
    <>
      <ChatTranscript
        chatId={chatId}
        displayMessages={transcript.displayMessages}
        compaction={compaction}
        compactionIndex={transcript.compactionIndex}
        hasOlderMessages={hasOlderMessages}
        isLoadingOlderMessages={isLoadingOlderMessages}
        onLoadOlderMessages={onLoadOlderMessages}
        availableModels={transcript.availableModels}
        status={status}
        displayedError={transcript.displayedError}
        onInspectContext={dialog.setInspectedRunId}
      />
      <ChatComposer
        input={composer.input}
        onInputChange={composer.setInput}
        onSubmit={composer.handleSubmit}
        status={status}
        onStop={composer.handleStop}
        modelReadyForSend={composer.modelReadyForSend}
        modelSendUnavailableReason={composer.modelSendUnavailableReason}
      />
      <ChatSessionDialog dialog={dialog} />
    </>
  );
}
