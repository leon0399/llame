'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';

import { BotIcon, LoaderCircleIcon, SendIcon, StopCircleIcon, UserIcon } from 'lucide-react';

import { Message, MessageAvatar, MessageContent } from '@/components/components/ai/message';
import {
  PromptInput,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputToolbar
} from '@/components/components/ai/prompt-input';
import { ChatContainerContent, ChatContainerRoot, ScrollButton } from '@/components/components/ai/chat-container';
import { cn } from '@workspace/ui/lib/utils';
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { useChatContext } from '@/contexts/chat-context';
import { DefaultChatTransport } from 'ai';
import { MessageReasoning } from '@/components/components/ai/message/message-reasoning';
import { authAwareFetch } from '@/lib/api/client';
import { buildChatMessagesUrl, prepareSendMessagesRequest } from '@/lib/services/chat/transport';
import { chatQueryKeys, createChat } from '@/lib/services/chat/queries';
import { useQueryClient } from '@tanstack/react-query';

const PENDING_CHAT_ID = '00000000-0000-0000-0000-000000000000';

type QueuedMessage = {
  id: string;
  text: string;
};

export default function Page() {
  const { activeChatId } = useChatContext();
  const queuedMessage = useRef<QueuedMessage | null>(null);
  const [queuedMessageId, setQueuedMessageId] = useState<string | null>(null);

  const queueMessage = useCallback((message: QueuedMessage) => {
    queuedMessage.current = message;
    setQueuedMessageId(message.id);
  }, []);

  const consumeQueuedMessage = useCallback(() => {
    const message = queuedMessage.current;
    queuedMessage.current = null;
    setQueuedMessageId(null);
    return message;
  }, []);

  return (
    <ChatSession
      key={activeChatId ?? 'new'}
      chatId={activeChatId}
      queuedMessageId={queuedMessageId}
      queueMessage={queueMessage}
      consumeQueuedMessage={consumeQueuedMessage}
    />
  );
}

function ChatSession({
  chatId,
  queuedMessageId,
  queueMessage,
  consumeQueuedMessage,
}: {
  chatId: string | null;
  queuedMessageId: string | null;
  queueMessage: (message: QueuedMessage) => void;
  consumeQueuedMessage: () => QueuedMessage | null;
}) {
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('');
  const [createError, setCreateError] = useState<Error | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  const queryClient = useQueryClient();
  const { setActiveChatId } = useChatContext();
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: buildChatMessagesUrl(chatId ?? PENDING_CHAT_ID),
        credentials: 'include',
        fetch: authAwareFetch,
        prepareSendMessagesRequest,
      }),
    [chatId],
  );
  const { messages, sendMessage, status, stop, error } =
    useChat({
      id: chatId ?? 'new',
      generateId: () => crypto.randomUUID(),
      transport,
      // A completed turn bumps the chat's updatedAt server-side; refresh the
      // sidebar list so the active chat re-sorts into the right time group.
      onFinish: () => {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.infinite });
      },
    });
  const displayedError = createError ?? error;

  useEffect(() => {
    if (!chatId || !queuedMessageId) {
      return;
    }

    const queued = consumeQueuedMessage();
    if (!queued) {
      return;
    }

    // Send a NEW message — do NOT pass `messageId` (that means "replace the message
    // already in state with this id" and throws if absent). The SDK assigns the
    // client-generated id via `generateId` and the transport forwards it.
    void sendMessage({ text: queued.text }).catch((caught) => {
      setInput(queued.text);
      setCreateError(caught instanceof Error ? caught : new Error(String(caught)));
    });
  }, [chatId, consumeQueuedMessage, queuedMessageId, sendMessage]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || status === 'streaming' || status === 'submitted' || isCreatingChat) {
      return;
    }

    setInput('');
    setCreateError(null);

    if (!chatId) {
      setIsCreatingChat(true);
      try {
        const chat = await createChat();
        queueMessage({ id: crypto.randomUUID(), text });
        setActiveChatId(chat.id);
        await queryClient.invalidateQueries({ queryKey: chatQueryKeys.infinite });
      } catch (caught) {
        setInput(text);
        setCreateError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setIsCreatingChat(false);
      }
      return;
    }

    try {
      await sendMessage({ text });
    } catch (caught) {
      setInput(text);
      setCreateError(caught instanceof Error ? caught : new Error(String(caught)));
    }
  }

  return (
    <>
      <div ref={chatContainerRef} className="relative flex-1 overflow-y-auto">
        <ChatContainerRoot className="h-full">
          <ChatContainerContent className="space-y-4 px-5 py-12">
            {messages.map((message) => {
              const isUserMessage = message.role === 'user';

              return (
                <Message
                  key={`message-${message.id}`}
                  className={cn(
                    "mx-auto flex w-full max-w-3xl flex-col gap-2 px-0 md:px-6",
                    isUserMessage ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={cn(
                      "flex w-full items-start gap-3",
                      isUserMessage ? "flex-row-reverse" : "flex-row"
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
                        isUserMessage ? "items-end" : "items-start"
                      )}
                    >
                      { message.parts.map((part, index) => {
                        const messagePartKey = `message-part-${message.id}-${index}`;

                        if (part.type === 'reasoning') {
                          return (
                            <MessageReasoning
                              key={messagePartKey}
                              isLoading={part.state === 'streaming'}
                              reasoning={part.text}
                            />
                          )
                        } else if (part.type === 'text') {
                          return (
                            <MessageContent
                              key={messagePartKey}
                              className={cn(
                                "prose text-primary",
                                isUserMessage
                                  ? "bg-secondary text-primary max-w-[85%] sm:max-w-[75%]"
                                  : "bg-transparent text-primary w-full flex-1 overflow-x-auto rounded-lg p-0 py-0"
                              )}
                              markdown
                            >
                              {part.text}
                            </MessageContent>
                          );
                        }

                        return (
                          <span key={messagePartKey}>
                            unsupported part type: {part.type}
                          </span>
                        );
                      }) }
                      {/* <MessageContent
                        className={cn(
                          "prose text-primary",
                          isUserMessage
                            ? "bg-secondary text-primary max-w-[85%] sm:max-w-[75%]"
                            : "bg-transparent text-primary w-full flex-1 overflow-x-auto rounded-lg p-0 py-0"
                        )}
                        markdown
                      >
                        { message.parts
                          .map(part => (part.type === 'text' ? part.text : ''))
                          .join('') }
                      </MessageContent> */}
                    </div>
                  </div>
                </Message>
              );
            })}
            { displayedError && (
              <div className='max-w-3xl mx-auto'>
                <Alert variant={"destructive"} className='w-full'>
                  <AlertTitle>Error: {displayedError.name}</AlertTitle>
                  <AlertDescription className="text-sm">
                    {displayedError.message}
                  </AlertDescription>
                </Alert>
              </div>
            ) }
          </ChatContainerContent>
          <div className="absolute bottom-4 left-1/2 flex w-full max-w-3xl -translate-x-1/2 justify-end px-5">
            <ScrollButton className="shadow-sm" />
          </div>
        </ChatContainerRoot>
      </div>

      <div className="bg-background z-10 shrink-0 px-3 pb-3 md:px-5 md:pb-5">
        <div className="mx-auto max-w-3xl">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              name="message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What would you like to know?"
              autoFocus
            />
            <PromptInputToolbar>
              {status === 'streaming' || status === 'submitted' || isCreatingChat ? (
                <PromptInputButton
                  type="button"
                  onClick={() => stop()}
                  className='ml-auto'
                  disabled={isCreatingChat}
                >
                  {status === 'submitted' || isCreatingChat ? (
                    <LoaderCircleIcon size={16} className='animate-spin' />
                  ) : (
                    <StopCircleIcon size={16} />
                  )}
                </PromptInputButton>
              ) : (
                <PromptInputButton
                  className='ml-auto'
                  type="submit"
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
