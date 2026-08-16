"use client";

import React, {
  useCallback,
  useEffect,
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
import { authAwareFetch } from "@/lib/api/client";
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
  mergeTrustedModelContextParts,
  messageRenderKey,
  modelSwitchPart,
  runIdFromMessageMetadata,
  shouldAdoptServerHistory,
} from "@/lib/services/chat/history";
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
  draftChatPath,
  type DraftPhase,
} from "@/lib/services/chat/draft-route";

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

// Right cell of the composer model+send pill: square inner corner, rounded
// outer corner, and a focus ring that lifts above its neighbour (see the group
// wrapper in the composer). Shared by the Stop and Send branches.
const COMPOSER_SEND_BUTTON_CLASS =
  "size-8 rounded-l-none rounded-r-md focus-visible:relative focus-visible:z-10";

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

  // This page boundary owns foreground presence before any session data loads.
  // In particular, a rehydrated draft can wait with no ChatSessionContent while
  // its history query resolves; registering here prevents that loading window
  // from being misclassified as a background run completion.
  useEffect(() => registerViewedChat(chatId), [chatId, registerViewedChat]);

  return (
    <ChatSession
      key={chatId}
      chatId={chatId}
      initialChatExists={initialChatExists}
      initialDraftPhase={initialDraftPhase}
    />
  );
}

function ChatSession({
  chatId,
  initialChatExists,
  initialDraftPhase,
}: {
  chatId: string;
  initialChatExists: boolean;
  initialDraftPhase: DraftPhase | null;
}) {
  const [session, dispatch] = useReducer(
    reduceDraftSession,
    initialDraftSession(initialDraftPhase, initialChatExists),
  );
  const historyQuery = useChatMessagesQuery({
    chatId,
    enabled: shouldQueryChatHistory(session),
    recoverSentDraft: session.kind === "recovering",
  });

  const draftPhase = draftPhaseForSession(session);
  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      draftChatPath(chatId, draftPhase),
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
      draftChatPath(chatId, "sent"),
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
      draftChatPath(chatId, null),
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
      onFinished={onFinished}
      onSendFailed={onSendFailed}
      onSendStarted={onSendStarted}
      resume={shouldResumeChat(session)}
    />
  );
}

function ChatSessionContent({
  chatId,
  chatMessages,
  compaction,
  onFinished,
  onSendFailed,
  onSendStarted,
  resume,
}: {
  chatId: string;
  chatMessages: UIMessage[];
  compaction: Compaction | null;
  onFinished: () => void;
  onSendFailed: () => void;
  onSendStarted: () => void;
  resume: boolean;
}) {
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<Error | null>(null);
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(null);

  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedModel, setSelectedModel } = useChatContext();
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
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: buildChatMessagesUrl(chatId),
        credentials: "include",
        fetch: authAwareFetch,
        prepareSendMessagesRequest: (options) => {
          const modelId = selectedModelRef.current;
          if (modelId === undefined) {
            // Unreachable in practice (both send affordances are gated on
            // modelReadyForSend), but this narrows undefined → string so a
            // request can never be built without a model.
            throw new Error(NO_MODEL_SELECTED_ERROR);
          }
          return prepareSendMessagesRequest({ ...options, modelId });
        },
        prepareReconnectToStreamRequest,
      }),
    [chatId],
  );
  const refreshChatList = () => {
    void queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
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
  // Guarded on settled state: mid-turn the live copy legitimately runs AHEAD of
  // the server (an optimistic user turn, an answer still streaming), and
  // overwriting it there is how duplicated/rewound transcripts happen (#259).
  useEffect(() => {
    if (
      !shouldAdoptServerHistory({
        status,
        serverMessages: chatMessages,
        liveMessages: messages,
      })
    ) {
      return;
    }
    setMessages(chatMessages);
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
        <Conversation className="h-full">
          <ConversationContent className="mx-auto w-full max-w-3xl space-y-4 px-5 py-12">
            {displayMessages.map((message, index) => {
              const renderKey = messageRenderKey(message);
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
                    fromModelId={switchPart.data.fromModelId}
                    toModelId={switchPart.data.toModelId}
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
                  <Message from={message.role}>
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
                        } else if (part.type === "data-model-context") {
                          // Trusted control metadata is surfaced by the
                          // boundary immediately before this message, never
                          // as message content.
                          return null;
                        } else if (
                          part.type === "data-tool-availability" ||
                          part.type === "data-recency-digest"
                        ) {
                          // Server-authored context reminders. They are
                          // rendered into the MODEL's prompt by the api's
                          // context-builder and are never visible chat
                          // content — without this branch they fall through
                          // to the "unsupported part type" span and print
                          // debug text into the owner's transcript on reload.
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
              {/* Model picker + send grouped into one bordered pill, pushed to
                  the right edge of the composer (design: `.mdl-group`). The end
                  buttons are individually rounded rather than clipped with
                  `overflow-hidden`, so their focus rings render in full; the
                  focused cell lifts above its neighbour (`z-10`) so nothing
                  clips the ring. */}
              <div className="ml-auto inline-flex items-center rounded-md border border-border">
                <ModelSelector className="rounded-l-md rounded-r-none focus-visible:relative focus-visible:z-10" />
                {/* Seam between the two cells. A plain self-stretch span, not
                    <Separator>: the shared primitive's vertical variant forces
                    `h-full`, which collapses to 0 in this auto-height pill (no
                    definite parent height), so the divider would vanish. */}
                <span aria-hidden className="w-px self-stretch bg-border" />
                {status === "streaming" || status === "submitted" ? (
                  <PromptInputButton
                    type="button"
                    onClick={handleStop}
                    className={COMPOSER_SEND_BUTTON_CLASS}
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
                    className={COMPOSER_SEND_BUTTON_CLASS}
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
