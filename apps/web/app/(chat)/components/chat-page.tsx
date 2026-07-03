"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { useChat } from "@ai-sdk/react";

import {
  BotIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SendIcon,
  StopCircleIcon,
  UserIcon,
} from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { useRouter } from "next/navigation";

import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/components/ai/message";
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
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageReasoning } from "@/components/components/ai/message/message-reasoning";
import { ToolCallPart } from "./tool-call-part";
import { authAwareFetch } from "@/lib/api/client";
import {
  buildChatMessagesUrl,
  prepareReconnectToStreamRequest,
  prepareSendMessagesRequest,
} from "@/lib/services/chat/transport";
import {
  chatQueryKeys,
  useChatMessagesQuery,
} from "@/lib/services/chat/queries";
import { useModelsQuery } from "@/lib/services/models/queries";
import { cancelRun, runIdToCancel } from "@/lib/services/chat/runs";
import { messageText } from "@/lib/clipboard";
import { useActiveRuns } from "@/contexts/active-runs-context";
import { MessageUsage } from "./message-usage";
import { MessageCopyButton } from "./message-copy-button";
import { ChatTodos } from "./chat-todos";
import { toast } from "@workspace/ui/components/sonner";
import { safeRandomUUID } from "@/lib/uuid";
import { useQueryClient } from "@tanstack/react-query";

export type ChatPageProps = {
  chatId?: string;
  initialMessages?: UIMessage[];
};

export function ChatPage({
  chatId: persistedChatId,
  initialMessages = [],
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
  initialMessages: UIMessage[];
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
  initialMessages: UIMessage[];
  navigateOnFinish?: boolean;
}) {
  const { data: cachedInitialMessages = [] } = useChatMessagesQuery({
    chatId,
    initialMessages,
  });

  return (
    <ChatSessionContent
      chatId={chatId}
      chatMessages={cachedInitialMessages}
      navigateOnFinish={navigateOnFinish}
      resume
    />
  );
}

function ChatSessionContent({
  chatId,
  chatMessages,
  navigateOnFinish,
  resume,
}: {
  chatId: string;
  chatMessages: UIMessage[];
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
    setActiveChatId,
    setDraftChatId,
    selectedModel,
  } = useChatContext();
  const { trackRun, untrackChat, markChatSeen } = useActiveRuns();
  const { data: availableModels = [] } = useModelsQuery();
  // Only send a model the api will accept (#76): an id not in the live
  // available set (e.g. the static default before the user picks) is omitted,
  // and the api resolves the caller's default instead of 422-ing.
  const modelToSend = availableModels.some((m) => m.id === selectedModel)
    ? selectedModel
    : undefined;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: buildChatMessagesUrl(chatId),
        credentials: "include",
        fetch: authAwareFetch,
        prepareSendMessagesRequest,
        prepareReconnectToStreamRequest,
      }),
    [chatId],
  );
  const refreshChatList = () =>
    void queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
  const refreshChatMessages = () =>
    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.messages(chatId),
    });
  const refreshChatData = () => {
    refreshChatList();
    refreshChatMessages();
  };
  const { messages, sendMessage, regenerate, status, stop, error } = useChat({
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
    // but do NOT adopt — a pre-create failure (e.g. 402 no-credential) leaves no row, so
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
    onError: () => {
      untrackChat(chatId);
      refreshChatData();
    },
  });
  const displayedError = sendError ?? error;
  const displayMessages = messages.filter(
    (message) => message.role !== "system",
  );

  // Register the active run globally so its completion notifies (toast + badge)
  // if the user navigates to another chat before it finishes — the durable
  // worker keeps generating regardless (#50). Label the toast with the first
  // user turn, so "Reply ready — <question>" is meaningful.
  useEffect(() => {
    if (status !== "streaming" && status !== "submitted") return;
    const runId = runIdToCancel(messages);
    if (!runId) return;
    const firstUser = messages.find((m) => m.role === "user");
    const label =
      (firstUser && messageText(firstUser.parts).slice(0, 48)) ||
      "your conversation";
    trackRun(runId, chatId, label);
  }, [status, messages, chatId, trackRun]);

  // Opening a chat clears its unseen-completion badge.
  useEffect(() => {
    markChatSeen(chatId);
  }, [chatId, markChatSeen]);

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
    if (!text || status === "streaming" || status === "submitted") {
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
      // adopted as active in onFinish, once the chat is known to exist. The selected model
      // (#76) rides in the request body → prepareSendMessagesRequest forwards it.
      await sendMessage(
        { text },
        modelToSend !== undefined
          ? { body: { model: modelToSend } }
          : undefined,
      );
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
            {displayMessages.map((message) => {
              const isUserMessage = message.role === "user";

              return (
                <Message
                  key={`message-${message.id}`}
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
                      {message.parts.map((part, index) => {
                        const messagePartKey = `message-part-${message.id}-${index}`;

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
                          // AI SDK v6 emits `dynamic-tool` parts (our tools are
                          // dynamic from the client's view); typed tool parts
                          // (`tool-<name>`) share the same {state,input,output}.
                          const toolPart = part as {
                            type: string;
                            toolName?: string;
                            state: string;
                            input?: unknown;
                            output?: unknown;
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
                            />
                          );
                        }

                        return (
                          <span key={messagePartKey}>
                            unsupported part type: {part.type}
                          </span>
                        );
                      })}
                      {!isUserMessage && (
                        <MessageUsage metadata={message.metadata} />
                      )}
                      <div className="mt-1 flex items-center gap-1">
                        <MessageCopyButton parts={message.parts} />
                        {!isUserMessage &&
                          message.id === displayMessages.at(-1)?.id &&
                          (status === "ready" || status === "error") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Regenerate response"
                              title="Regenerate response"
                              onClick={() =>
                                void regenerate({
                                  messageId: message.id,
                                  ...(modelToSend !== undefined
                                    ? { body: { model: modelToSend } }
                                    : {}),
                                })
                              }
                            >
                              <RefreshCwIcon className="h-3.5 w-3.5" />
                            </Button>
                          )}
                      </div>
                    </div>
                  </div>
                </Message>
              );
            })}
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
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <ChatTodos
            chatId={chatId}
            enabled={displayMessages.length > 0}
          />
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              name="message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What would you like to know?"
              autoFocus
            />
            <PromptInputToolbar>
              {status === "streaming" || status === "submitted" ? (
                <PromptInputButton
                  type="button"
                  onClick={handleStop}
                  className="ml-auto"
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
                  className="ml-auto"
                  type="submit"
                  aria-label="Send message"
                >
                  <SendIcon size={16} />
                </PromptInputButton>
              )}
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </>
  );
}
