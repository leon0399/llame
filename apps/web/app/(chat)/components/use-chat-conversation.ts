import { useCallback, useState } from "react";

import { useChat } from "@ai-sdk/react";
import type { FileUIPart, UIMessage } from "ai";
import { useQueryClient } from "@tanstack/react-query";

import { useChatContext } from "@/contexts/chat-context";
import { useActiveRuns } from "@/contexts/active-runs-context";
import { compactionBoundaryIndex } from "@/lib/services/chat/compaction";
import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import type { FollowUpRunRequest } from "@/lib/services/chat/transport";
import {
  useStreamInterruption,
  type StreamInterruption,
} from "@/lib/services/chat/stream-repair";
import {
  mergeTrustedModelContextParts,
  type Compaction,
} from "@/lib/services/chat/history";
import {
  useChatEngine,
  useChatHistorySync,
  useChatModelSelection,
  useChatPresenceEffects,
  useChatRefresh,
  useChatSendTransport,
} from "./use-chat-engine";
import { replacedReplyIndex } from "./turn-action-rules";
import { usePendingStop } from "./use-pending-stop";
import {
  attachmentFileParts,
  type ComposerAttachments,
  revokePreviews,
  useComposerAttachments,
} from "./use-composer-attachments";

type ChatSubmitHandlersArgs = {
  sendMessage: ReturnType<typeof useChat>["sendMessage"];
  status: ReturnType<typeof useChat>["status"];
  modelReadyForSend: boolean;
  onSendStarted: () => void;
  onSendFailed: () => void;
  input: string;
  setInput: (value: string) => void;
  setSendError: (error: Error | null) => void;
  attachments: ComposerAttachments;
};

/** The user message for `sendMessage`: file parts in thumbnail order, and no
 *  text part for an image-only message (the API rejects blank text). */
function outgoingMessage(text: string, files: Array<FileUIPart>) {
  return text ? { text, files } : { files };
}

/** Clears the composer, sends, and restores the text and images if the send
 *  throws; images attached while it was pending stay after the restored ones. */
async function sendComposed(
  {
    setInput,
    setSendError,
    sendMessage,
    onSendStarted,
    onSendFailed,
    attachments,
  }: ChatSubmitHandlersArgs,
  text: string,
  files: Array<FileUIPart>,
) {
  const sent = attachments.items;
  setInput("");
  attachments.clear();
  setSendError(null);

  try {
    // Mark the canonical URL synchronously before the first request. A hard
    // reload can then recover this exact identity without sessionStorage.
    onSendStarted();
    // First message to a new chat upserts it server-side, then streams (#86). The id is
    // adopted as active in onFinish, once the chat is known to exist.
    await sendMessage(outgoingMessage(text, files));
    revokePreviews(sent);
  } catch (error) {
    onSendFailed();
    setInput(text);
    attachments.restore(sent);
    setSendError(error instanceof Error ? error : new Error(String(error)));
  }
}

/** The composer's submit handler — split out of `useChatActions` as a
 *  plain factory, it calls no hooks. */
function createHandleSubmit(args: ChatSubmitHandlersArgs) {
  const { input, status, modelReadyForSend, attachments } = args;
  return async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    const files = attachmentFileParts(attachments.items);
    if (
      (!text && files.length === 0) ||
      status === "streaming" ||
      status === "submitted" ||
      !modelReadyForSend ||
      attachments.sendBlocked
    ) {
      return;
    }
    await sendComposed(args, text, files);
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
  onSendFailed,
  ...submit
}: UseChatActionsArgs) {
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<Error | null>(null);
  const attachments = useComposerAttachments();
  const { pendingStop, requestStop, clearPendingStop } = usePendingStop({
    messages,
    stop,
    status: submit.status,
  });

  const handleSubmit = createHandleSubmit({
    ...submit,
    input,
    setInput,
    setSendError,
    attachments,
    onSendFailed: () => {
      clearPendingStop();
      onSendFailed();
    },
  });

  return {
    input,
    setInput,
    sendError,
    handleStop: requestStop,
    handleSubmit,
    pendingStop,
    attachments,
  };
}

/** Every piece of state `useChatConversation` needs that isn't specific to
 *  one `chatId`'s live `useChat` engine: chat-context/active-runs reads,
 *  model-selection readiness, the send transport, and the cache-refresh
 *  callbacks. Composed here so `useChatConversation` stays a thin owner. */
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
  refreshChatBinding: () => void;
  interruption: StreamInterruption | null;
};

/** Every effect the conversation state drives once messages exist: the
 *  resume/history-adoption pair (#261), the interrupted-stream repair (#1284),
 *  and the run-presence pair — composed here, in this order, so their relative
 *  passive-effect scheduling matches a single component's call order. */
function useChatSideEffects({
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
  refreshChatBinding,
  interruption,
}: UseChatSideEffectsArgs) {
  useChatHistorySync({
    resume,
    resumeStream,
    refreshChatMessages,
    chatMessages,
    messages,
    status,
    setMessages,
    interruption,
  });
  useChatPresenceEffects({
    status,
    messages,
    chatId,
    trackRun,
    markChatSeen,
    refreshChatBinding,
  });
}

// Surface conversation compaction as the checkpoint boundary (#57): the
// checkpoint arrives as an owner history row, while `toChatUiMessages`
// deliberately drops that non-conversation row before rendering. The
// checkpoint's absorbed-through boundary still places the marker before the
// triggering user row.
function deriveChatTranscript(
  messages: Array<UIMessage>,
  chatMessages: Array<UIMessage>,
  compaction: Compaction | null,
  latestRun: ChatLatestRunResponse | null,
) {
  const merged = mergeTrustedModelContextParts(messages, chatMessages).filter(
    (message) => message.role !== "system",
  );
  // A follow-up Run of the latest turn that has not settled replaced its
  // reply: hide that reply so a reload before the dispatch shows the resumed
  // stream alone (turn-actions D13).
  const replaced = replacedReplyIndex(merged, latestRun);
  const displayMessages =
    replaced === null
      ? merged
      : merged.filter((_message, index) => index !== replaced);
  // SAFETY: `UIMessage["metadata"]` is generic/unknown-shaped at the type
  // level; every message here is one this app persisted, so its metadata is
  // always this app's own `{ seq?: number }` shape (or absent).
  const compactionIndex = compactionBoundaryIndex(
    displayMessages as ReadonlyArray<{ metadata?: { seq?: number } }>,
    compaction?.absorbedThroughSeq ?? null,
  );
  return { displayMessages, compactionIndex };
}

type UseChatEngineStateArgs = {
  chatId: string;
  chatMessages: Array<UIMessage>;
  compaction: Compaction | null;
  latestRun: ChatLatestRunResponse | null;
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
function useChatEngineState(args: UseChatEngineStateArgs) {
  const { chatId, chatMessages, compaction, latestRun, resume, setup } = args;
  // The run whose stream dropped while it was still executing (#1284). Held
  // here rather than acted on in the finish handler: re-attaching needs the
  // `Chat` instance `useChatEngine` returns, and an effect is where that
  // boundary is already crossed.
  const streamInterruption = useStreamInterruption();
  const engine = useChatEngine({
    ...setup,
    chatId,
    chatMessages,
    onFinished: args.onFinished,
    onTargetSendInterrupted: args.onTargetSendInterrupted,
    onSendFailed: args.onSendFailed,
    onStreamInterrupted: streamInterruption.report,
  });
  const transcript = deriveChatTranscript(
    engine.messages,
    chatMessages,
    compaction,
    latestRun,
  );

  useChatSideEffects({
    ...setup,
    resume,
    resumeStream: engine.resumeStream,
    chatMessages,
    messages: engine.messages,
    status: engine.status,
    setMessages: engine.setMessages,
    chatId,
    interruption: streamInterruption.interruption,
  });

  return { engine, ...transcript };
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
    pendingStop: actions.pendingStop,
    attachments: actions.attachments,
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
  turn: TurnState,
) {
  return {
    displayMessages: engineState.displayMessages,
    compactionIndex: engineState.compactionIndex,
    availableModels: setup.availableModels,
    displayedError: actions.sendError ?? engineState.engine.error,
    latestRun: turn.latestRun,
    onRegenerate: turn.onRegenerate,
  };
}

/** The latest Run the turn-level actions judge, and the sender they call. */
type TurnState = {
  latestRun: ChatLatestRunResponse | null;
  onRegenerate: (request: FollowUpRunRequest) => void;
};

/** The follow-up sender: `regenerate()` with a body naming the action, which
 *  the transport routes to the follow-up Run (turn-actions D13). */
function useTurnRegenerate(
  regenerate: ReturnType<typeof useChat>["regenerate"],
) {
  return useCallback(
    (request: FollowUpRunRequest) => {
      void regenerate({ body: request });
    },
    [regenerate],
  );
}

export type UseChatConversationArgs = {
  chatId: string;
  chatMessages: Array<UIMessage>;
  compaction: Compaction | null;
  latestRun: ChatLatestRunResponse | null;
  onFinished: () => boolean;
  onTargetSendInterrupted: () => boolean;
  onSendFailed: () => void;
  onSendStarted: () => void;
  resume: boolean;
};

/**
 * Owns every piece of state `ChatSessionContent` needs: the model
 * selection, the send transport, the `useChat` engine itself, history
 * resume/adoption, run presence, and the composer's submit handlers. Split
 * out so `ChatSessionContent` composes only markup — this hook must stay a
 * direct call from that component's own render (see `useChatEngine`'s
 * comment on why).
 */
export function useChatConversation(args: UseChatConversationArgs) {
  const { chatId, onSendStarted, onSendFailed } = args;
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(null);
  const setup = useChatSetup(chatId);
  const engineState = useChatEngineState({ ...args, setup });
  const actions = useChatActions({
    messages: engineState.engine.messages,
    stop: engineState.engine.stop,
    sendMessage: engineState.engine.sendMessage,
    status: engineState.engine.status,
    modelReadyForSend: setup.modelReadyForSend,
    onSendStarted,
    onSendFailed,
  });
  const onRegenerate = useTurnRegenerate(engineState.engine.regenerate);

  return {
    status: engineState.engine.status,
    composer: buildComposerState(setup, actions),
    transcript: buildTranscriptState(setup, actions, engineState, {
      latestRun: args.latestRun,
      onRegenerate,
    }),
    dialog: { inspectedRunId, setInspectedRunId },
  };
}
