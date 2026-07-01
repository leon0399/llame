"use client";

import { useEffect, useMemo, useState } from "react";

import { useChat } from "@ai-sdk/react";

import { useRouter } from "next/navigation";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
  usePromptInputController,
} from "@workspace/ui/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@workspace/ui/components/ai-elements/reasoning";
import { cn } from "@workspace/ui/lib/utils";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { useChatContext } from "@/contexts/chat-context";
import { DefaultChatTransport, type ChatStatus, type UIMessage } from "ai";
import { authAwareFetch } from "@/lib/api/client";
import {
  buildChatMessagesUrl,
  prepareSendMessagesRequest,
} from "@/lib/services/chat/transport";
import {
  chatQueryKeys,
  useChatMessagesQuery,
} from "@/lib/services/chat/queries";
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
  const { draftChatId, setActiveChatId, setDraftChatId } = useChatContext();
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
    />
  );
}

function ChatSession({
  chatId,
  initialMessages,
  navigateOnFinish,
}: {
  chatId: string;
  initialMessages: UIMessage[];
  navigateOnFinish: boolean;
}) {
  const [sendError, setSendError] = useState<Error | null>(null);

  const router = useRouter();
  const queryClient = useQueryClient();
  const { setActiveChatId } = useChatContext();
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: buildChatMessagesUrl(chatId),
        credentials: "include",
        fetch: authAwareFetch,
        prepareSendMessagesRequest,
      }),
    [chatId],
  );
  const refreshChatList = () =>
    void queryClient.invalidateQueries({ queryKey: chatQueryKeys.infinite });
  const refreshChatMessages = () =>
    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.messages(chatId),
    });
  const refreshChatData = () => {
    refreshChatList();
    refreshChatMessages();
  };
  const { data: cachedInitialMessages = [] } = useChatMessagesQuery({
    chatId,
    enabled: !navigateOnFinish,
    initialMessages,
  });
  const { messages, sendMessage, status, stop, error } = useChat({
    id: chatId,
    messages: cachedInitialMessages,
    generateId: safeRandomUUID,
    transport,
    // A completed turn proves the chat exists server-side: adopt the id as active (so the
    // sidebar highlights it — key is already this chatId, so no remount) and refresh the
    // list. On error we only refresh (a mid-stream failure may still have created the chat)
    // but do NOT adopt — a pre-create failure (e.g. 402 no-credential) leaves no row, so
    // adopting would point activeChatId at a non-existent chat.
    onFinish: () => {
      setActiveChatId(chatId);
      if (navigateOnFinish) {
        router.replace(`/chat/${chatId}`);
      }
      refreshChatData();
    },
    onError: refreshChatData,
  });
  const displayedError = sendError ?? error;
  const displayMessages = messages.filter(
    (message) => message.role !== "system",
  );

  async function sendSubmittedMessage(message: PromptInputMessage) {
    const text = message.text.trim();

    setSendError(null);

    try {
      // First message to a new chat upserts it server-side, then streams (#86). The id is
      // adopted as active in onFinish, once the chat is known to exist.
      await sendMessage({ text });
    } catch (caught) {
      setSendError(
        caught instanceof Error ? caught : new Error(String(caught)),
      );
      throw caught;
    }
  }

  return (
    <>
      <div className="relative flex flex-1 overflow-hidden">
        <Conversation className="h-full">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-4 px-5 py-12 md:px-11">
            {displayMessages.map((message) => {
              const isUserMessage = message.role === "user";

              return (
                <Message
                  className="w-full max-w-full"
                  from={message.role}
                  key={`message-${message.id}`}
                >
                  <MessageContent
                    className={cn(
                      isUserMessage ? "max-w-[85%] sm:max-w-[75%]" : "w-full",
                    )}
                  >
                    {message.parts.map((part, index) => {
                      const messagePartKey = `message-part-${message.id}-${index}`;

                      if (part.type === "reasoning") {
                        return (
                          <Reasoning
                            isStreaming={part.state === "streaming"}
                            key={messagePartKey}
                          >
                            <ReasoningTrigger />
                            <ReasoningContent>{part.text}</ReasoningContent>
                          </Reasoning>
                        );
                      }

                      if (part.type === "text") {
                        return (
                          <MessageResponse key={messagePartKey}>
                            {part.text}
                          </MessageResponse>
                        );
                      }

                      return (
                        <span key={messagePartKey}>
                          unsupported part type: {part.type}
                        </span>
                      );
                    })}
                  </MessageContent>
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
          </ConversationContent>
          <ConversationScrollButton className="shadow-sm" />
        </Conversation>
      </div>

      <div className="bg-background z-10 shrink-0 px-3 pb-3 md:px-5 md:pb-5">
        <div className="mx-auto max-w-3xl">
          <PromptInputProvider>
            <ChatPromptInput
              onSubmit={sendSubmittedMessage}
              status={status}
              stop={stop}
            />
          </PromptInputProvider>
        </div>
      </div>
    </>
  );
}

type ChatPromptInputProps = {
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  status: ChatStatus;
  stop: () => void;
};

function ChatPromptInput({ onSubmit, status, stop }: ChatPromptInputProps) {
  const { textInput } = usePromptInputController();

  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();
    if (!text || status === "streaming" || status === "submitted") {
      throw new Error("Message is not ready to send.");
    }

    textInput.clear();

    try {
      await onSubmit({ ...message, text });
    } catch (caught) {
      textInput.setInput(text);
      throw caught;
    }
  }

  return (
    <PromptInput maxFiles={0} onSubmit={handleSubmit}>
      <PromptInputTextarea
        autoFocus
        name="message"
        placeholder="What would you like to know?"
      />
      <PromptInputFooter>
        <PromptInputTools />
        <PromptInputSubmit
          className="ml-auto"
          onStop={() => stop()}
          status={status}
        />
      </PromptInputFooter>
    </PromptInput>
  );
}
