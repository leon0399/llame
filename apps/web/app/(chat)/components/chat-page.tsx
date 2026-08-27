"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { useChat } from "@ai-sdk/react";

import { LoaderCircleIcon, SendIcon, StopCircleIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

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
import { MessageForkButton } from "./message-fork-button";
import { ButtonGroup } from "@workspace/ui/components/button-group";

import { EffortSelector } from "./effort-selector";
import { ModelSelector } from "./model-selector";
import {
  PromptInput,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputToolbar,
} from "./prompt-input";
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
import { useChatContext } from "@/contexts/chat-context";
import { useLatestRef } from "@/lib/hooks/use-latest-ref";
import { useActiveRuns } from "@/contexts/active-runs-context";
import {
  notificationLabel,
  streamingRunId,
} from "@/lib/services/chat/run-notifications";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { MessageUsage } from "./message-usage";
import { parseCapNoticePart, ToolCapNoticePart } from "./tool-cap-notice-part";
import { authAwareFetch } from "@/lib/api/fetch";
import {
  buildChatMessagesUrl,
  NO_MODEL_SELECTED_ERROR,
  prepareReconnectToStreamRequest,
  prepareSendMessagesRequest,
} from "@/lib/services/chat/transport";
import {
  chatQueryKeys,
  isChatHistoryMissing,
  useChatMessagesQuery,
} from "@/lib/services/chat/queries";
import { pinQueryKeys } from "@/lib/services/pins/queries";
import { hasModelId, useModelsQuery } from "@/lib/services/models/queries";
import { cancelRun, runIdToCancel } from "@/lib/services/chat/runs";
import { toast } from "@workspace/ui/components/sonner";
import { safeRandomUUID } from "@/lib/uuid";
import { useQueryClient } from "@tanstack/react-query";
import { compactionBoundaryIndex } from "@/lib/services/chat/compaction";
import type { Compaction } from "@/lib/services/chat/history";
import {
  adoptServerHistory,
  mergeTrustedModelContextParts,
  messageRenderKey,
  messageSeqFromMetadata,
  modelSwitchPart,
  runIdFromMessageMetadata,
} from "@/lib/services/chat/history";
import { ChatLoadOlder } from "./chat-load-older";
import { CompactionBoundary } from "./compaction-boundary";
import { ModelSwitchBoundary } from "@workspace/ui/components/custom/model-switch-boundary";
import {
  EffectiveContextAction,
  EffectiveContextInspector,
} from "./effective-context-inspector";
import {
  draftPhaseForSession,
  initialDraftSession,
  reduceDraftSession,
  shouldQueryChatHistory,
  shouldRenderChatOwner,
  shouldResumeChat,
} from "@/lib/services/chat/draft-session";
import {
  draftChatPathWithHash,
  type DraftPhase,
} from "@/lib/services/chat/draft-route";
import { useMessageTarget } from "@/lib/services/chat/message-target";

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

// Module-level so a draft's empty history keeps a stable identity across
// renders — it is a dependency of the history-adoption effect below.
const EMPTY_MESSAGES: UIMessage[] = [];

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
  const targetSeq = useMessageTarget(chatId);

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
      targetSeq={targetSeq}
    />
  );
}

function ChatSession({
  chatId,
  initialChatExists,
  initialDraftPhase,
  targetSeq,
}: {
  chatId: string;
  initialChatExists: boolean;
  initialDraftPhase: DraftPhase | null;
  targetSeq: number | null;
}) {
  const [session, dispatch] = useReducer(
    reduceDraftSession,
    targetSeq === null
      ? initialDraftSession(initialDraftPhase, initialChatExists)
      : initialChatExists
        ? { kind: "persisted", resumeRequested: false }
        : initialDraftSession(initialDraftPhase, initialChatExists),
  );
  const historyQuery = useChatMessagesQuery({
    chatId,
    enabled: shouldQueryChatHistory(session),
    recoverSentDraft: session.kind === "recovering",
    targetSeq: targetSeq ?? undefined,
  });

  const draftPhase = draftPhaseForSession(session);
  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      draftChatPathWithHash(chatId, draftPhase, window.location.hash),
    );
  }, [chatId, draftPhase]);

  useEffect(() => {
    if (session.kind !== "recovering" || historyQuery.data === undefined) {
      return;
    }
    dispatch({ type: "chat-visible" });
  }, [historyQuery.data, session.kind]);

  useEffect(() => {
    if (session.kind !== "recovering" || !historyQuery.isError) return;
    dispatch({
      type: isChatHistoryMissing(historyQuery.error)
        ? "history-missing"
        : "history-indeterminate",
    });
  }, [historyQuery.error, historyQuery.isError, session.kind]);

  const onSendStarted = useCallback(() => {
    if (session.kind !== "fresh") return;
    window.history.replaceState(
      window.history.state,
      "",
      draftChatPathWithHash(chatId, "sent", window.location.hash),
    );
    dispatch({ type: "send-started" });
  }, [chatId, session.kind]);

  const onSendFailed = useCallback(() => {
    dispatch({ type: "send-failed" });
  }, []);

  const onFinished = useCallback(() => {
    window.history.replaceState(
      window.history.state,
      "",
      draftChatPathWithHash(chatId, null, window.location.hash),
    );
    dispatch({ type: "finished" });
  }, [chatId]);

  if (!shouldRenderChatOwner(session)) {
    return null;
  }

  const history = historyQuery.data;
  return (
    <ChatSessionContent
      chatId={chatId}
      chatMessages={history?.messages ?? EMPTY_MESSAGES}
      compaction={history?.compaction ?? null}
      hasOlderMessages={historyQuery.hasNextPage}
      isLoadingOlderMessages={historyQuery.isFetchingNextPage}
      onLoadOlderMessages={() =>
        // cancelRefetch: false — an intersection re-fire while a page is
        // already in flight must join it, not abort and restart it.
        void historyQuery.fetchNextPage({ cancelRefetch: false })
      }
      onFinished={onFinished}
      onSendFailed={onSendFailed}
      onSendStarted={onSendStarted}
      resume={shouldResumeChat(session)}
      targetSeq={targetSeq}
    />
  );
}

function ChatSessionContent({
  chatId,
  chatMessages,
  compaction,
  hasOlderMessages,
  isLoadingOlderMessages,
  onLoadOlderMessages,
  onFinished,
  onSendFailed,
  onSendStarted,
  resume,
  targetSeq,
}: {
  chatId: string;
  chatMessages: UIMessage[];
  compaction: Compaction | null;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  onFinished: () => void;
  onSendFailed: () => void;
  onSendStarted: () => void;
  resume: boolean;
  targetSeq: number | null;
}) {
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<Error | null>(null);
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(null);

  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedModel, setSelectedModel, selectedEffort } = useChatContext();
  const { trackRun, untrackChat, markChatSeen } = useActiveRuns();
  const modelsQuery = useModelsQuery();
  const availableModels = modelsQuery.data?.models ?? [];
  const selectedModelAvailable = hasModelId(availableModels, selectedModel);

  useEffect(() => {
    if (!modelsQuery.data || modelsQuery.data.models.length === 0) return;
    if (!hasModelId(modelsQuery.data.models, selectedModel)) {
      setSelectedModel(modelsQuery.data.defaultModelId);
    }
  }, [modelsQuery.data, selectedModel, setSelectedModel]);

  // useChat (@ai-sdk/react) creates its Chat once per chatId and NEVER adopts a
  // new `transport` instance afterwards (it only recreates on an id change).
  // Closing the transport over `selectedModel` therefore froze it at the
  // first-render value (undefined, before models load), so a model chosen after
  // load never reached the request — the send failed with "no selected model".
  // Read the model from a ref instead, so the id-stable transport always sends
  // the CURRENT selection. Assigned during render (not via an effect) — it's a
  // plain latest-value mirror, only read later inside prepareSendMessagesRequest.
  const selectedModelRef = useLatestRef(selectedModel);
  // Same frozen-closure hazard as the model above: the transport is created
  // once, so reading `selectedEffort` directly would pin the first turn's
  // level for the life of the chat. `useLatestRef` bundles the per-render
  // assignment with the ref's creation — writing the two separately is how
  // effort came to be silently omitted from every send.
  const selectedEffortRef = useLatestRef(selectedEffort);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: buildChatMessagesUrl(chatId),
        credentials: "include",
        fetch: authAwareFetch,
        prepareSendMessagesRequest: (options) => {
          const modelId = selectedModelRef.current;
          const effort = selectedEffortRef.current;
          if (modelId === undefined) {
            // Unreachable in practice (both send affordances are gated on
            // modelReadyForSend), but this narrows undefined → string so a
            // request can never be built without a model.
            throw new Error(NO_MODEL_SELECTED_ERROR);
          }
          return prepareSendMessagesRequest({ ...options, modelId, effort });
        },
        prepareReconnectToStreamRequest,
      }),
    // The two refs are listed for the exhaustive-deps rule's benefit only: a
    // ref object is stable for the component's life, so including them cannot
    // rebuild the transport. `chatId` remains the sole real trigger — which is
    // the whole point, since useChat never adopts a new transport instance.
    [chatId, selectedModelRef, selectedEffortRef],
  );
  const refreshChatList = () => {
    void queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
    // TitleService (#78) may have named this chat — refresh the card query
    // ChatHeader falls back to when the row is not in a loaded list page.
    // exact: detail is the parent of …/messages; do not wipe history here.
    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.detail(chatId),
      exact: true,
    });
    // A run completion may have generated this chat's title (TitleService,
    // #78). The rail's pinned card denormalizes that title, so refresh pins
    // too — design D5a: a change to a card field invalidates the pins query.
    void queryClient.invalidateQueries({ queryKey: pinQueryKeys.list() });
  };
  // Compaction (#57) is embedded in this same messages response (#136) — a
  // compaction landing mid-conversation is refreshed "for free" by this same
  // invalidation, with no separate query/cache entry to keep in sync.
  // Memoized because the resume effect below depends on it, and a fresh
  // identity each render would re-run that effect every render.
  const refreshChatMessages = useCallback(
    () =>
      void queryClient.invalidateQueries({
        queryKey: chatQueryKeys.messages(chatId),
      }),
    [queryClient, chatId],
  );
  const refreshChatData = () => {
    refreshChatList();
    refreshChatMessages();
  };
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
    resumeStream,
  } = useChat({
    id: chatId,
    messages: chatMessages,
    generateId: safeRandomUUID,
    transport,
    // Resume-on-refresh (#49): reconnect only after owner-scoped history has
    // proved the chat exists. A fresh/sending draft never probes early; a
    // `?draft=sent` recovery first waits for the bounded history query. This
    // prevents a speculative 204 from racing persistence while still using
    // the same Chat instance for live error recovery.
    // The SDK's own `resume` effect is deliberately NOT used (see the guarded
    // effect below): it has no cleanup and no re-entrancy guard, so React
    // Strict Mode's double-invoked mount effect calls resumeStream() twice on
    // the same Chat instance. Two concurrent makeRequest() calls then race on
    // the shared `activeResponse`, which the first one clears in its finally —
    // the second dereferences it and throws (#260), and each accumulates its
    // own message state, duplicating the answer (#259).
    resume: false,
    // A completed turn proves the chat exists server-side. The session owner
    // removes the draft marker without routing or remounting, then this refresh
    // lets durable history replace the live projection under stable React keys.
    onFinish: ({ isAbort, isDisconnect, isError }) => {
      // A stream that ended by abort/disconnect/error is NOT a completed
      // turn: a page reload aborts the in-flight fetch, and treating that as
      // finish cleared the recorded draft id during teardown — destroying the
      // refresh-resume path this slice exists to add (found via CI trace
      // diagnostics). The run itself survives server-side; the reloaded page
      // recovers the canonical sent route and resumes it.
      if (isAbort || isDisconnect || isError) {
        onSendFailed();
        refreshChatData();
        return;
      }
      // The user watched this finish → drop it from the active-run registry so
      // the background poll can't fire a stale "reply ready" if they navigate
      // away right after.
      untrackChat(chatId);
      onFinished();
      refreshChatData();
    },
    // Do NOT untrack here: onError fires for a client-visible fetch/stream
    // error (e.g. a transient disconnect), but the durable run may still be
    // executing server-side regardless of what the client saw (#50) — like
    // the abort/disconnect/error branch of onFinish above, leave the run
    // tracked so the background poll can resolve its true terminal status
    // (completed/failed/expired) instead of silently forgetting a run that
    // might still complete.
    onError: () => {
      onSendFailed();
      refreshChatData();
    },
  });
  const displayedError = sendError ?? error;
  const displayMessages = mergeTrustedModelContextParts(
    messages,
    chatMessages,
  ).filter((message) => message.role !== "system");

  const targetMessageRendered =
    targetSeq !== null &&
    displayMessages.some(
      (message) => messageSeqFromMetadata(message.metadata) === targetSeq,
    );
  const scrolledTargetRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (
      !targetMessageRendered ||
      targetSeq === null ||
      scrolledTargetRef.current === targetSeq
    ) {
      return;
    }
    const target = document.getElementById(`msg-${targetSeq}`);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    scrolledTargetRef.current = targetSeq;
  }, [targetMessageRendered, targetSeq]);
  const modelSendUnavailableReason = (() => {
    if (modelsQuery.isPending) return null;
    if (modelsQuery.isError) {
      return "Models could not be loaded; chat sending is unavailable.";
    }
    if (availableModels.length === 0) {
      return "No chat models are configured; chat sending is unavailable.";
    }
    if (!selectedModelAvailable) {
      return "Select an available model to send.";
    }
    return null;
  })();
  const modelReadyForSend = modelsQuery.isSuccess && selectedModelAvailable;

  // Resume-on-refresh and live first-send recovery (#49), driven here instead
  // of via useChat's `resume`
  // prop: the SDK's own effect has no cleanup or re-entrancy guard, so Strict
  // Mode's double-invoked mount effect resumes the same Chat instance twice
  // and the two concurrent requests race on shared state (#259/#260 — see the
  // note at the useChat call). The ref is set synchronously before the call,
  // so the second invocation is a no-op; each route identity has one owner and
  // one Chat instance.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!resume || resumedRef.current) return;
    resumedRef.current = true;
    // Always re-read history once the probe settles, INCLUDING when it answers
    // 204. Verified in the pinned SDK (ai 6.0.217): `reconnectToStream` returns
    // null on 204 and `makeRequest` then returns before the block that fires
    // onFinish — so that path emits no callback at all, and with a 60s
    // staleTime nothing else would refetch. That is precisely the case where
    // the run went terminal between this page's history read and the probe,
    // i.e. where the answer is durable and the log is the only stale thing
    // (#261). Cheap and idempotent otherwise: the adoption below is a no-op
    // when the refetch brings nothing new.
    // Promise.resolve: `resumeStream()` is a promise in the SDK, but wrapping
    // keeps this from depending on that — a stubbed/void-returning
    // implementation must not throw here.
    void Promise.resolve(resumeStream()).finally(refreshChatMessages);
  }, [resume, resumeStream, refreshChatMessages]);

  // Adopt that refetched history — the client half of #261. useChat freezes
  // `messages` at creation (see PersistedChatSession) and never re-adopts a
  // later fetch, and the post-finish `router.replace` does NOT remount this
  // component (key={chatId} is unchanged), so a healed history otherwise never
  // reaches the log: the durable answer sits in the query cache, unread. A
  // resume can leave the log stale in two ways — 204 with no stream at all, or
  // a reconnect that arrives after the run's deltas were already emitted and
  // so replays nothing visible. Both end with the server holding the truth.
  // This is also how an on-demand older page (#187) reaches the transcript:
  // the query grows, adoptServerHistory sees newer coverage or a longer
  // window, and the merged list lands via the same setMessages. Guarded on
  // settled state inside adoptServerHistory: mid-turn the live copy
  // legitimately runs AHEAD of the server (an optimistic user turn, an answer
  // still streaming), and overwriting it there is how duplicated/rewound
  // transcripts happen (#259).
  useEffect(() => {
    const healed = adoptServerHistory({
      status,
      serverMessages: chatMessages,
      liveMessages: messages,
    });
    if (healed !== null) setMessages(healed);
  }, [chatMessages, messages, status, setMessages]);

  // Register the active run globally so its completion notifies (toast + badge)
  // if the user navigates to another chat before it finishes — the durable
  // worker keeps generating regardless (#50). Label the toast with the first
  // user turn, so "Reply ready — <question>" is meaningful.
  useEffect(() => {
    if (status !== "streaming" && status !== "submitted") return;
    const runId = streamingRunId(messages);
    if (!runId) return;
    trackRun(runId, chatId, notificationLabel(messages));
  }, [status, messages, chatId, trackRun]);

  // Opening a chat clears its unseen-completion badge.
  useEffect(() => {
    markChatSeen(chatId);
  }, [chatId, markChatSeen]);

  // Surface conversation compaction (#57): where older turns were folded into
  // a summary for the model's context. `compaction` arrives embedded in the
  // SAME messages fetch (#136) — no second, independently-failing request,
  // and no separate "is it enabled yet" gate to get wrong.
  const compactionIndex = compactionBoundaryIndex(
    displayMessages as ReadonlyArray<{ metadata?: { seq?: number } }>,
    compaction?.uptoSeq ?? null,
  );

  // Stop must CANCEL the durable run, not just close our SSE — otherwise the
  // worker keeps generating (and billing BYOK tokens) after "stop". While a run
  // streams, the assistant message's id is the run id (the bridge's start-chunk
  // surrogate), so cancel it, then abort the client stream. Best-effort: a run
  // that's already gone/terminal makes the cancel moot (cancelRun swallows
  // those); we still abort the client either way. During the brief "submitted"
  // window the last message is the user turn (no run id yet) → just stop().
  function handleStop() {
    const runId = runIdToCancel(messages);
    if (runId) {
      // cancelRun already swallows the normal 404/409 races (run gone /
      // terminal); reaching here means the cancel genuinely failed, so the run
      // may still be generating (and billing) server-side — surface it rather
      // than let the user believe stop saved tokens when it may not have.
      void cancelRun(runId).catch((err: unknown) => {
        console.error("Failed to cancel run", err);
        toast.error(
          "Couldn't confirm the response was stopped — it may still be finishing.",
        );
      });
    }
    void stop();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
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
    } catch (caught) {
      onSendFailed();
      setInput(text);
      setSendError(
        caught instanceof Error ? caught : new Error(String(caught)),
      );
    }
  }

  return (
    <>
      <div className="relative flex-1 overflow-hidden">
        {/* initial="instant": the reader must LAND at the newest message, not
            watch the page scroll from the top to it — with SSR-rendered
            history the smooth initial animation reads as a jump to the top
            and back down once hydration finishes.
            resize="instant": the markdown/reasoning renderers are deliberate
            client-only dynamic chunks (chat-bundle-boundary.test.ts), so on a
            hard reload the transcript mounts as short shells and grows by
            thousands of px when they arrive. A smooth resize animates that
            catch-up as a visible scroll down the page; instant keeps the view
            pinned to the bottom within the same frame. Streaming growth gets
            the same instant follow, which reads as steady, not animated. */}
        <Conversation className="h-full" initial="instant" resize="instant">
          {/* TODO(#187): a reader who walks a several-thousand-message chat
              to the top accumulates the whole transcript in the DOM. If that
              ever measures heavy, [content-visibility:auto] on message rows
              (or the virtualization #187 originally named) is the next step
              — measure before reaching for either. */}
          <ConversationContent className="mx-auto w-full max-w-3xl space-y-4 px-5 py-12">
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
            {displayMessages.map((message, index) => {
              const renderKey = messageRenderKey(message);
              const messageSeq = messageSeqFromMetadata(message.metadata);
              const isUserMessage = message.role === "user";
              const switchPart = isUserMessage
                ? modelSwitchPart(message)
                : null;
              const contextRunId = isUserMessage
                ? null
                : runIdFromMessageMetadata(message.metadata);
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
                    onInspectContext={() =>
                      setInspectedRunId(switchPart.data.runId)
                    }
                  />
                </div>
              ) : null;

              return (
                <React.Fragment key={`message-${renderKey}`}>
                  {boundary}
                  {modelBoundary}
                  {/* data-message-key anchors ChatLoadOlder's scroll
                      compensation when older pages prepend. */}
                  <Message
                    id={messageSeq === null ? undefined : `msg-${messageSeq}`}
                    from={message.role}
                    data-message-key={renderKey}
                  >
                    <MessageContent>
                      {message.parts.map((part, partIndex) => {
                        const messagePartKey = `message-part-${renderKey}-${partIndex}`;

                        if (part.type === "reasoning") {
                          return (
                            <Reasoning
                              key={messagePartKey}
                              isStreaming={part.state === "streaming"}
                              defaultOpen={false}
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        } else if (part.type === "text") {
                          return (
                            <MessageResponse key={messagePartKey}>
                              {part.text}
                            </MessageResponse>
                          );
                        } else if (isToolUIPart(part)) {
                          const toolName = getToolName(part);
                          const toolState =
                            part.state === "output-error" &&
                            part.resultProviderMetadata?.llame?.cancelled ===
                              true
                              ? "cancelled"
                              : (part.state ?? "input-streaming");
                          return (
                            <Tool key={messagePartKey}>
                              <ToolHeader
                                type={`tool-${toolName}`}
                                state={toolState}
                                title={
                                  part.type === "dynamic-tool"
                                    ? toolName
                                    : undefined
                                }
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
                        } else if (part.type === "data-cap-notice") {
                          // Step-cap notice (D6): persisted alongside the
                          // tool call/result parts when a run hits
                          // tools.maxStepsPerRun. Same part → same chip,
                          // live or reloaded from history.
                          const capNotice = parseCapNoticePart(part);
                          return capNotice ? (
                            <ToolCapNoticePart
                              key={messagePartKey}
                              {...capNotice}
                            />
                          ) : null;
                        } else if (part.type === "data-context") {
                          // Every server-authored context item, whatever its
                          // producer. They are rendered into the MODEL's
                          // prompt by the api's context-builder and are never
                          // visible chat content; the model-change boundary
                          // above this message is the only owner-facing
                          // surface today. One branch rather than a list of
                          // producers, so a producer this build does not know
                          // about cannot fall through to the "unsupported
                          // part type" span and print debug text into the
                          // owner's transcript on reload.
                          return null;
                        }

                        return (
                          <span key={messagePartKey}>
                            unsupported part type: {part.type}
                          </span>
                        );
                      })}
                    </MessageContent>
                    {!isUserMessage && (
                      <div className="flex flex-wrap items-center gap-1">
                        <MessageUsage
                          metadata={message.metadata}
                          models={availableModels}
                        />
                        {contextRunId && (
                          <EffectiveContextAction
                            onClick={() => setInspectedRunId(contextRunId)}
                          />
                        )}
                      </div>
                    )}
                    {(status === "ready" || status === "error") && (
                      // Persistent action row (not hover-only) so the fork
                      // affordance stays discoverable — reuses the shared
                      // MessageActions primitive (the row future per-message
                      // actions, e.g. copy, will join). On BOTH roles: the
                      // API forks from any message id regardless of role,
                      // and this feature is pitched as "fork from any
                      // point" — restricting the UI to assistant replies
                      // only would silently narrow that to less than what
                      // ships.
                      <MessageActions className="mt-1">
                        <MessageForkButton
                          chatId={chatId}
                          fromMessageId={message.id}
                          onForked={(forkedChatId) =>
                            router.push(`/chat/${forkedChatId}`)
                          }
                        />
                      </MessageActions>
                    )}
                  </Message>
                </React.Fragment>
              );
            })}
            {/* All loaded messages are within the summarized span → boundary sits
                after the last one. */}
            {compaction && compactionIndex === displayMessages.length && (
              <div className="mx-auto w-full max-w-3xl md:px-6">
                <CompactionBoundary
                  summary={compaction.summary}
                  createdAt={compaction.createdAt}
                  stats={compaction.stats}
                  models={availableModels}
                />
              </div>
            )}
            {displayedError && (
              <div className="max-w-3xl mx-auto">
                <Alert variant={"destructive"} className="w-full">
                  <AlertTitle>Error: {displayedError.name}</AlertTitle>
                  <AlertDescription className="text-sm">
                    {displayedError.message}
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton className="shadow-sm" />
        </Conversation>
      </div>

      <div className="bg-background z-10 shrink-0 px-3 pb-3 md:px-5 md:pb-5">
        <div className="mx-auto max-w-3xl">
          {modelSendUnavailableReason && (
            <p className="mb-2 text-xs text-destructive">
              {modelSendUnavailableReason}
            </p>
          )}
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              name="message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What would you like to know?"
              // Deliberate: the chat page's sole purpose is this composer,
              // so autofocusing it on load matches established chat-UI
              // convention (this is not a modal interrupting other content).
              // oxlint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            <PromptInputToolbar>
              {/* Two units, not one pill: the SELECTORS are attached to each
                  other, and send stands alone.

                  Send left the group because being its last cell forced
                  `rounded-r-lg` with squared left corners, and a paper-plane
                  glyph reads off-centre inside an asymmetric box. Standalone,
                  it keeps Button's own all-round `rounded-lg` and the icon
                  centres itself — a shape fix rather than nudging the glyph.

                  `gap-2` is the same 8px ButtonGroup applies between nested
                  groups (`has-[>[data-slot=button-group]]:gap-2`), so the
                  separation is the design system's answer, not a hand-picked
                  number. Both units are h-8, which that gap is scaled for. */}
              <div className="ml-auto flex items-center gap-2">
                <ButtonGroup>
                  <ModelSelector />
                  {/* Only present when the selected model declares an effort
                      vocabulary; the group re-collapses to a single cell when
                      it renders nothing. */}
                  <EffortSelector />
                </ButtonGroup>
                {status === "streaming" || status === "submitted" ? (
                  <PromptInputButton
                    type="button"
                    variant="outline"
                    // size-8, the same box as the selector cells' h-8. Stated
                    // through the API rather than a class override, and with
                    // no corner overrides — Button's symmetric `rounded-lg` is
                    // what makes the icon read centred.
                    size="icon"
                    onClick={handleStop}
                    aria-label="Stop generation"
                  >
                    {status === "submitted" ? (
                      <LoaderCircleIcon size={16} className="animate-spin" />
                    ) : (
                      <StopCircleIcon size={16} />
                    )}
                  </PromptInputButton>
                ) : (
                  <PromptInputButton
                    variant="outline"
                    size="icon"
                    type="submit"
                    aria-label="Send message"
                    disabled={!modelReadyForSend}
                  >
                    <SendIcon size={16} />
                  </PromptInputButton>
                )}
              </div>
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
      <EffectiveContextInspector
        runId={inspectedRunId}
        open={inspectedRunId !== null}
        onOpenChange={(open) => {
          if (!open) setInspectedRunId(null);
        }}
      />
    </>
  );
}
