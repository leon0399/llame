"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { useChat } from "@ai-sdk/react";

import {
  BotIcon,
  LoaderCircleIcon,
  SendIcon,
  StopCircleIcon,
  UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  Message,
  MessageActions,
  MessageAvatar,
  MessageContent,
} from "@/components/components/ai/message";
import { MessageForkButton } from "./message-fork-button";
import { ModelSelector } from "./model-selector";
import {
  PromptInput,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/components/ai/prompt-input";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ScrollButton,
} from "@/components/components/ai/chat-container";
import { cn } from "@workspace/ui/lib/utils";
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
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageReasoning } from "@/components/components/ai/message/message-reasoning";
import { MessageUsage } from "./message-usage";
import { ToolCallPart } from "./tool-call-part";
import {
  parseCapNoticePart,
  ToolCapNoticePart,
} from "./tool-cap-notice-part";
import { authAwareFetch } from "@/lib/api/client";
import {
  buildChatMessagesUrl,
  NO_MODEL_SELECTED_ERROR,
  prepareReconnectToStreamRequest,
  prepareSendMessagesRequest,
} from "@/lib/services/chat/transport";
import {
  chatQueryKeys,
  useChatMessagesQuery,
} from "@/lib/services/chat/queries";
import { hasModelId, useModelsQuery } from "@/lib/services/models/queries";
import { cancelRun, runIdToCancel } from "@/lib/services/chat/runs";
import { toast } from "@workspace/ui/components/sonner";
import { safeRandomUUID } from "@/lib/uuid";
import { useQueryClient } from "@tanstack/react-query";
import { compactionBoundaryIndex } from "@/lib/services/chat/compaction";
import type { ChatHistory, Compaction } from "@/lib/services/chat/history";
import { CompactionBoundary } from "./compaction-boundary";

const EMPTY_HISTORY: ChatHistory = { messages: [], compaction: null };

// Right cell of the composer model+send pill: square inner corner, rounded
// outer corner, and a focus ring that lifts above its neighbour (see the group
// wrapper in the composer). Shared by the Stop and Send branches.
const COMPOSER_SEND_BUTTON_CLASS =
  "size-8 rounded-l-none rounded-r-md focus-visible:relative focus-visible:z-10";

export type ChatPageProps = {
  chatId?: string;
  initialMessages?: ChatHistory;
};

export function ChatPage({
  chatId: persistedChatId,
  initialMessages = EMPTY_HISTORY,
}: ChatPageProps) {
  const { draftChatId, draftRestored, setActiveChatId, setDraftChatId } =
    useChatContext();
  // Mint the chat id client-side for a brand-new chat so the first message creates-or-appends
  // in a single POST (#86). Never reaches the DOM (used only as the React key, the useChat id,
  // and the transport target), so an SSR/client mint mismatch causes no hydration error.
  const [newChatId] = useState(safeRandomUUID);
  const chatId = persistedChatId ?? draftChatId ?? newChatId;

  useEffect(() => {
    setActiveChatId(persistedChatId ?? null);
    if (persistedChatId !== undefined) {
      setDraftChatId(null);
    }
  }, [persistedChatId, setActiveChatId, setDraftChatId]);

  // Key by chat id: route changes and "New Chat" remount the AI SDK Chat instance, but adopting
  // the minted id after a successful first send does not interrupt an in-flight stream.
  return (
    <ChatSession
      key={chatId}
      chatId={chatId}
      initialMessages={initialMessages}
      navigateOnFinish={persistedChatId === undefined}
      rehydratedDraft={
        persistedChatId === undefined && draftRestored && chatId === draftChatId
      }
    />
  );
}

function ChatSession({
  chatId,
  initialMessages,
  navigateOnFinish,
  rehydratedDraft,
}: {
  chatId: string;
  initialMessages: ChatHistory;
  navigateOnFinish: boolean;
  rehydratedDraft: boolean;
}) {
  // A rehydrated draft (its id survived a refresh in the per-tab store, so a
  // send already happened) is server-side real: fetch its messages and probe
  // resume like a persisted chat, but keep draft navigation semantics.
  if (navigateOnFinish && !rehydratedDraft) {
    return <DraftChatSession chatId={chatId} />;
  }
  return (
    <PersistedChatSession
      chatId={chatId}
      initialMessages={initialMessages}
      navigateOnFinish={navigateOnFinish}
    />
  );
}

function DraftChatSession({ chatId }: { chatId: string }) {
  return (
    <ChatSessionContent
      chatId={chatId}
      chatMessages={[]}
      compaction={null}
      navigateOnFinish
      resume={false}
    />
  );
}

function PersistedChatSession({
  chatId,
  initialMessages,
  navigateOnFinish = false,
}: {
  chatId: string;
  initialMessages: ChatHistory;
  navigateOnFinish?: boolean;
}) {
  // A rehydrated draft (navigateOnFinish) has no SSR-seeded history — its
  // `initialMessages` is only the EMPTY_HISTORY placeholder. Seeding that as
  // initialData makes the query resolve "empty" on first render, and useChat
  // (AI SDK v6) freezes its messages at creation and never re-adopts the
  // later-fetched history — so the resumed conversation renders as an empty
  // log (#49 draft-resume). Withhold initialData in that case and wait for the
  // real fetch, so ChatSessionContent (and its useChat) is created WITH the
  // messages. The persisted route keeps its SSR initialData → no load flash.
  const seededHistory = navigateOnFinish ? undefined : initialMessages;
  const { data: history } = useChatMessagesQuery({
    chatId,
    initialMessages: seededHistory,
  });

  if (history === undefined) {
    return null;
  }

  return (
    <ChatSessionContent
      chatId={chatId}
      chatMessages={history.messages}
      compaction={history.compaction}
      navigateOnFinish={navigateOnFinish}
      resume
    />
  );
}

function ChatSessionContent({
  chatId,
  chatMessages,
  compaction,
  navigateOnFinish,
  resume,
}: {
  chatId: string;
  chatMessages: UIMessage[];
  compaction: Compaction | null;
  navigateOnFinish: boolean;
  resume: boolean;
}) {
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<Error | null>(null);

  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    draftChatId,
    recordSentDraft,
    selectedModel,
    setActiveChatId,
    setDraftChatId,
    setSelectedModel,
  } = useChatContext();
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
  const refreshChatList = () =>
    void queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
  // Compaction (#57) is embedded in this same messages response (#136) — a
  // compaction landing mid-conversation is refreshed "for free" by this same
  // invalidation, with no separate query/cache entry to keep in sync.
  const refreshChatMessages = () =>
    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.messages(chatId),
    });
  const refreshChatData = () => {
    refreshChatList();
    refreshChatMessages();
  };
  const { messages, sendMessage, status, stop, error } = useChat({
    id: chatId,
    messages: chatMessages,
    generateId: safeRandomUUID,
    transport,
    // Resume-on-refresh (#49): on mount, reconnect to the chat's active run
    // (GET /chats/:id/stream) and replay it live — the run survives the socket
    // (worker mode), so a refresh mid-answer picks up where it left off. A
    // FRESH draft can't have a server-side run yet and skips the probe; a
    // rehydrated draft (its id came from the per-tab store, meaning a send
    // already happened before a refresh) probes like a persisted chat.
    // MOUNT-TIME PROP, deliberately not derived from draft state: deriving it
    // flipped resume true mid-session right after the send recorded the
    // draft id — the SDK then probed 204 against the not-yet-committed run
    // and fired a spurious onFinish that cleared the draft and navigated
    // early (found via CI trace diagnostics).
    resume,
    // A completed turn proves the chat exists server-side: adopt the id as active (so the
    // sidebar highlights it — key is already this chatId, so no remount) and refresh the
    // list. On error we only refresh (a mid-stream failure may still have created the chat)
    // but do NOT adopt — a pre-persistence validation failure leaves no row, so
    // adopting would point activeChatId at a non-existent chat.
    onFinish: ({ isAbort, isDisconnect, isError }) => {
      // A stream that ended by abort/disconnect/error is NOT a completed
      // turn: a page reload aborts the in-flight fetch, and treating that as
      // finish cleared the recorded draft id during teardown — destroying the
      // refresh-resume path this slice exists to add (found via CI trace
      // diagnostics). The run itself survives server-side; the reloaded page
      // rehydrates the draft and resumes it.
      if (isAbort || isDisconnect || isError) {
        refreshChatData();
        return;
      }
      // The user watched this finish → drop it from the active-run registry so
      // the background poll can't fire a stale "reply ready" if they navigate
      // away right after.
      untrackChat(chatId);
      setActiveChatId(chatId);
      if (navigateOnFinish) {
        setDraftChatId(null);
        router.replace(`/chat/${chatId}`);
      }
      refreshChatData();
    },
    // Do NOT untrack here: onError fires for a client-visible fetch/stream
    // error (e.g. a transient disconnect), but the durable run may still be
    // executing server-side regardless of what the client saw (#50) — like
    // the abort/disconnect/error branch of onFinish above, leave the run
    // tracked so the background poll can resolve its true terminal status
    // (completed/failed/expired) instead of silently forgetting a run that
    // might still complete.
    onError: refreshChatData,
  });
  const displayedError = sendError ?? error;
  const displayMessages = messages.filter(
    (message) => message.role !== "system",
  );
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
      // Record the draft id BEFORE the send: the context persists it per-tab
      // (sessionStorage), so a refresh mid-first-answer re-mounts `/` with the
      // SAME chat id and the resume probe picks the stream back up (#49).
      if (navigateOnFinish && draftChatId !== chatId) {
        recordSentDraft(chatId);
      }
      // First message to a new chat upserts it server-side, then streams (#86). The id is
      // adopted as active in onFinish, once the chat is known to exist.
      await sendMessage({ text });
    } catch (caught) {
      setInput(text);
      setSendError(
        caught instanceof Error ? caught : new Error(String(caught)),
      );
    }
  }

  return (
    <>
      <div ref={chatContainerRef} className="relative flex-1 overflow-y-auto">
        <ChatContainerRoot className="h-full">
          <ChatContainerContent className="space-y-4 px-5 py-12">
            {displayMessages.map((message, index) => {
              const isUserMessage = message.role === "user";
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

              return (
                <React.Fragment key={`message-${message.id}`}>
                  {boundary}
                  <Message
                    className={cn(
                      "mx-auto flex w-full max-w-3xl flex-col gap-2 px-0 md:px-6",
                      isUserMessage ? "items-end" : "items-start",
                    )}
                  >
                    <div
                      className={cn(
                        "flex w-full items-start gap-3",
                        isUserMessage ? "flex-row-reverse" : "flex-row",
                      )}
                    >
                      {isUserMessage ? (
                        <MessageAvatar
                          className="h-6 w-6 -me-9 hidden sm:block sticky top-4"
                          alt={`Avatar of the user`}
                        >
                          <UserIcon size={16} className="text-primary" />
                        </MessageAvatar>
                      ) : (
                        <MessageAvatar
                          className="h-6 w-6 -ms-9 hidden sm:block sticky top-4"
                          alt={`Avatar of the assistant`}
                        >
                          <BotIcon size={16} className="text-primary" />
                        </MessageAvatar>
                      )}
                      <div
                        className={cn(
                          "flex w-full flex-col",
                          isUserMessage ? "items-end" : "items-start",
                        )}
                      >
                        {message.parts.map((part, partIndex) => {
                          const messagePartKey = `message-part-${message.id}-${partIndex}`;

                          if (part.type === "reasoning") {
                            return (
                              <MessageReasoning
                                key={messagePartKey}
                                isLoading={part.state === "streaming"}
                                reasoning={part.text}
                              />
                            );
                          } else if (part.type === "text") {
                            return (
                              <MessageContent
                                key={messagePartKey}
                                className={cn(
                                  "prose text-primary",
                                  isUserMessage
                                    ? "bg-secondary text-primary max-w-[85%] sm:max-w-[75%]"
                                    : "bg-transparent text-primary w-full flex-1 overflow-x-auto rounded-lg p-0 py-0",
                                )}
                                markdown
                              >
                                {part.text}
                              </MessageContent>
                            );
                          } else if (
                            part.type === "dynamic-tool" ||
                            part.type.startsWith("tool-")
                          ) {
                            // Tool-calling loop: render the agent's tool use.
                            // Persisted history carries typed `tool-<name>`
                            // parts (D5); `dynamic-tool` is handled too in
                            // case the transport ever surfaces it live —
                            // both share the same
                            // {state,input,output,errorText} shape.
                            const toolPart = part as {
                              type: string;
                              toolName?: string;
                              state: string;
                              input?: unknown;
                              output?: unknown;
                              errorText?: string;
                            };
                            return (
                              <ToolCallPart
                                key={messagePartKey}
                                toolName={
                                  toolPart.toolName ??
                                  toolPart.type.replace(/^tool-/, "")
                                }
                                state={toolPart.state}
                                input={toolPart.input}
                                output={toolPart.output}
                                errorText={toolPart.errorText}
                              />
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
                          }

                          return (
                            <span key={messagePartKey}>
                              unsupported part type: {part.type}
                            </span>
                          );
                        })}
                        {!isUserMessage && (
                          <MessageUsage
                            metadata={message.metadata}
                            models={availableModels}
                          />
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
                      </div>
                    </div>
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
          </ChatContainerContent>
          <div className="absolute bottom-4 left-1/2 flex w-full max-w-3xl -translate-x-1/2 justify-end px-5">
            <ScrollButton className="shadow-sm" />
          </div>
        </ChatContainerRoot>
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
    </>
  );
}
