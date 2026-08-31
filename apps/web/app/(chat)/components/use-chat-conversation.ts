import { useState } from "react";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useQueryClient } from "@tanstack/react-query";

import { useChatContext } from "@/contexts/chat-context";
import { useActiveRuns } from "@/contexts/active-runs-context";
import { cancelRun, runIdToCancel } from "@/lib/services/chat/runs";
import { toast } from "@workspace/ui/components/sonner";
import { compactionBoundaryIndex } from "@/lib/services/chat/compaction";
import {
  mergeTrustedModelContextParts,
  messageSeqFromMetadata,
  type Compaction,
} from "@/lib/services/chat/history";
import {
  useChatEngine,
  useChatHistorySync,
  useChatModelSelection,
  useChatPresenceEffects,
  useChatRefresh,
  useChatSendTransport,
  useTargetScrollEffect,
} from "./use-chat-engine";

type ChatSubmitHandlersArgs = {
  sendMessage: ReturnType<typeof useChat>["sendMessage"];
  status: ReturnType<typeof useChat>["status"];
  modelReadyForSend: boolean;
  onSendStarted: () => void;
  onSendFailed: () => void;
  input: string;
  setInput: (value: string) => void;
  setSendError: (error: Error | null) => void;
};

// Stop must CANCEL the durable run, not just close our SSE — otherwise the
// worker keeps generating (and billing BYOK tokens) after "stop". While a run
// streams, the assistant message's id is the run id (the bridge's start-chunk
// surrogate), so cancel it, then abort the client stream. Best-effort: a run
// that's already gone/terminal makes the cancel moot (cancelRun swallows
// those); we still abort the client either way. During the brief "submitted"
// window the last message is the user turn (no run id yet) → just stop().
// Split out of `useChatActions` as a plain factory — it calls no hooks.
function createHandleStop(
  messages: Array<UIMessage>,
  stop: ReturnType<typeof useChat>["stop"],
) {
  return function handleStop() {
    const runId = runIdToCancel(messages);
    if (runId) {
      // cancelRun already swallows the normal 404/409 races (run gone /
      // terminal); reaching here means the cancel genuinely failed, so the run
      // may still be generating (and billing) server-side — surface it rather
      // than let the user believe stop saved tokens when it may not have.
      void cancelRun(runId).catch((error: unknown) => {
        console.error("Failed to cancel run", error);
        toast.error(
          "Couldn't confirm the response was stopped — it may still be finishing.",
        );
      });
    }
    void stop();
  };
}

/** The composer's submit handler — split out of `useChatActions` as a
 *  plain factory, it calls no hooks. */
function createHandleSubmit({
  input,
  setInput,
  setSendError,
  status,
  modelReadyForSend,
  sendMessage,
  onSendStarted,
  onSendFailed,
}: ChatSubmitHandlersArgs) {
  return async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (
      !text ||
      status === "streaming" ||
      status === "submitted" ||
      !modelReadyForSend
    ) {
      return;
    }

    setInput("");
    setSendError(null);

    try {
      // Mark the canonical URL synchronously before the first request. A hard
      // reload can then recover this exact identity without sessionStorage.
      onSendStarted();
      // First message to a new chat upserts it server-side, then streams (#86). The id is
      // adopted as active in onFinish, once the chat is known to exist.
      await sendMessage({ text });
    } catch (error) {
      onSendFailed();
      setInput(text);
      setSendError(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

type UseChatActionsArgs = {
  messages: Array<UIMessage>;
  stop: ReturnType<typeof useChat>["stop"];
  sendMessage: ReturnType<typeof useChat>["sendMessage"];
  status: ReturnType<typeof useChat>["status"];
  modelReadyForSend: boolean;
  onSendStarted: () => void;
  onSendFailed: () => void;
};

/** The composer's own input/error state plus its two submit-adjacent
 *  handlers — split out so `useChatConversation` composes only the pieces
 *  of state it owns directly. */
function useChatActions({
  messages,
  stop,
  sendMessage,
  status,
  modelReadyForSend,
  onSendStarted,
  onSendFailed,
}: UseChatActionsArgs) {
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<Error | null>(null);

  const handleStop = createHandleStop(messages, stop);
  const handleSubmit = createHandleSubmit({
    input,
    setInput,
    setSendError,
    status,
    modelReadyForSend,
    sendMessage,
    onSendStarted,
    onSendFailed,
  });

  return { input, setInput, sendError, handleStop, handleSubmit };
}

/** Every piece of state `useChatConversation` needs that isn't specific to
 *  one `chatId`'s live `useChat` engine: chat-context/active-runs reads,
 *  model-selection readiness, the send transport, and the cache-refresh
 *  callbacks. Composed here so `useChatConversation` calls one hook instead
 *  of six. */
function useChatSetup(chatId: string) {
  const queryClient = useQueryClient();
  const { selectedModel, setSelectedModel, selectedEffort } = useChatContext();
  const { trackRun, untrackChat, markChatSeen } = useActiveRuns();
  const modelSelection = useChatModelSelection(selectedModel, setSelectedModel);
  const transport = useChatSendTransport(chatId, selectedModel, selectedEffort);
  const refresh = useChatRefresh(chatId, queryClient);

  return {
    ...modelSelection,
    transport,
    ...refresh,
    trackRun,
    untrackChat,
    markChatSeen,
  };
}

type UseChatSideEffectsArgs = {
  displayMessages: Array<UIMessage>;
  targetSeq: number | null;
  resume: boolean;
  resumeStream: ReturnType<typeof useChat>["resumeStream"];
  refreshChatMessages: () => void;
  chatMessages: Array<UIMessage>;
  messages: Array<UIMessage>;
  status: ReturnType<typeof useChat>["status"];
  setMessages: ReturnType<typeof useChat>["setMessages"];
  chatId: string;
  trackRun: (runId: string, chatId: string, label: string) => void;
  markChatSeen: (chatId: string) => void;
};

/** Every effect the conversation state drives once messages exist: the
 *  scroll-to-target, the resume/history-adoption pair (#261), and the
 *  run-presence pair — composed here, in this order, so their relative
 *  passive-effect scheduling matches a single component's call order. */
function useChatSideEffects({
  displayMessages,
  targetSeq,
  resume,
  resumeStream,
  refreshChatMessages,
  chatMessages,
  messages,
  status,
  setMessages,
  chatId,
  trackRun,
  markChatSeen,
}: UseChatSideEffectsArgs) {
  const targetMessageRendered =
    targetSeq !== null &&
    displayMessages.some(
      (message) => messageSeqFromMetadata(message.metadata) === targetSeq,
    );
  useTargetScrollEffect(targetMessageRendered, targetSeq);
  useChatHistorySync({
    resume,
    resumeStream,
    refreshChatMessages,
    chatMessages,
    messages,
    status,
    setMessages,
  });
  useChatPresenceEffects({ status, messages, chatId, trackRun, markChatSeen });
}

// Surface conversation compaction (#57): where older turns were folded into
// a summary for the model's context. `compaction` arrives embedded in the
// SAME messages fetch (#136) — no second, independently-failing request,
// and no separate "is it enabled yet" gate to get wrong. Pure — no hooks —
// so it can be called from anywhere in render; split out of
// `useChatEngineState` purely to shrink that hook's own line count.
function deriveChatTranscript(
  messages: Array<UIMessage>,
  chatMessages: Array<UIMessage>,
  compaction: Compaction | null,
) {
  const displayMessages = mergeTrustedModelContextParts(
    messages,
    chatMessages,
  ).filter((message) => message.role !== "system");
  // SAFETY: `UIMessage["metadata"]` is generic/unknown-shaped at the type
  // level; every message here is one this app persisted, so its metadata is
  // always this app's own `{ seq?: number }` shape (or absent).
  const compactionIndex = compactionBoundaryIndex(
    displayMessages as ReadonlyArray<{ metadata?: { seq?: number } }>,
    compaction?.uptoSeq ?? null,
  );
  return { displayMessages, compactionIndex };
}

type UseChatEngineStateArgs = {
  chatId: string;
  chatMessages: Array<UIMessage>;
  compaction: Compaction | null;
  targetSeq: number | null;
  resume: boolean;
  onFinished: () => boolean;
  onTargetSendInterrupted: () => boolean;
  onSendFailed: () => void;
  setup: ReturnType<typeof useChatSetup>;
};

/** The `useChat` engine itself, plus everything derived from its live
 *  messages: the displayed transcript, the compaction boundary, and every
 *  effect that reacts to them. Split out so `useChatConversation` composes
 *  only a handful of top-level calls. */
function useChatEngineState({
  chatId,
  chatMessages,
  compaction,
  targetSeq,
  resume,
  onFinished,
  onTargetSendInterrupted,
  onSendFailed,
  setup,
}: UseChatEngineStateArgs) {
  const engine = useChatEngine({
    ...setup,
    chatId,
    chatMessages,
    onFinished,
    onTargetSendInterrupted,
    onSendFailed,
  });
  const { displayMessages, compactionIndex } = deriveChatTranscript(
    engine.messages,
    chatMessages,
    compaction,
  );

  useChatSideEffects({
    ...setup,
    displayMessages,
    targetSeq,
    resume,
    resumeStream: engine.resumeStream,
    chatMessages,
    messages: engine.messages,
    status: engine.status,
    setMessages: engine.setMessages,
    chatId,
  });

  return { engine, displayMessages, compactionIndex };
}

/** Pure — no hooks: the `ChatComposer` props derived from setup and
 *  actions. Split out purely to shrink `useChatConversation`'s own line
 *  count. */
function buildComposerState(
  setup: ReturnType<typeof useChatSetup>,
  actions: ReturnType<typeof useChatActions>,
) {
  return {
    input: actions.input,
    setInput: actions.setInput,
    handleSubmit: actions.handleSubmit,
    handleStop: actions.handleStop,
    modelReadyForSend: setup.modelReadyForSend,
    modelSendUnavailableReason: setup.modelSendUnavailableReason,
  };
}

/** Pure — no hooks: the `ChatTranscript` props derived from setup, actions,
 *  and engine state. Split out purely to shrink `useChatConversation`'s own
 *  line count. */
function buildTranscriptState(
  setup: ReturnType<typeof useChatSetup>,
  actions: ReturnType<typeof useChatActions>,
  engineState: ReturnType<typeof useChatEngineState>,
) {
  return {
    displayMessages: engineState.displayMessages,
    compactionIndex: engineState.compactionIndex,
    availableModels: setup.availableModels,
    displayedError: actions.sendError ?? engineState.engine.error,
  };
}

export type UseChatConversationArgs = {
  chatId: string;
  chatMessages: Array<UIMessage>;
  compaction: Compaction | null;
  onFinished: () => boolean;
  onTargetSendInterrupted: () => boolean;
  onSendFailed: () => void;
  onSendStarted: () => void;
  resume: boolean;
  targetSeq: number | null;
};

/**
 * Owns every piece of state `ChatSessionContent` needs: the model
 * selection, the send transport, the `useChat` engine itself, history
 * resume/adoption, run presence, and the composer's submit handlers. Split
 * out so `ChatSessionContent` composes only markup — this hook must stay a
 * direct call from that component's own render (see `useChatEngine`'s
 * comment on why).
 */
export function useChatConversation({
  chatId,
  chatMessages,
  compaction,
  onFinished,
  onTargetSendInterrupted,
  onSendFailed,
  onSendStarted,
  resume,
  targetSeq,
}: UseChatConversationArgs) {
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(null);
  const setup = useChatSetup(chatId);
  const engineState = useChatEngineState({
    chatId,
    chatMessages,
    compaction,
    targetSeq,
    resume,
    onFinished,
    onTargetSendInterrupted,
    onSendFailed,
    setup,
  });
  const actions = useChatActions({
    messages: engineState.engine.messages,
    stop: engineState.engine.stop,
    sendMessage: engineState.engine.sendMessage,
    status: engineState.engine.status,
    modelReadyForSend: setup.modelReadyForSend,
    onSendStarted,
    onSendFailed,
  });

  return {
    status: engineState.engine.status,
    composer: buildComposerState(setup, actions),
    transcript: buildTranscriptState(setup, actions, engineState),
    dialog: { inspectedRunId, setInspectedRunId },
  };
}
