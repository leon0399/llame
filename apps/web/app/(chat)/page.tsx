'use client';

import React, { useRef, useState } from 'react';

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
import { useChatContext } from '@/contexts/chat-context';
import { DefaultChatTransport } from 'ai';

export default function Page() {
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('');

  const { selectedModel } = useChatContext();
  const { messages, sendMessage, status, stop } =
    useChat({
      transport: new DefaultChatTransport({
        api: '/api/v1/chats',
      })
    });

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
                      <MessageContent
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
                      </MessageContent>
                    </div>
                  </div>
                </Message>
              );
            })}
          </ChatContainerContent>
          <div className="absolute bottom-4 left-1/2 flex w-full max-w-3xl -translate-x-1/2 justify-end px-5">
            <ScrollButton className="shadow-sm" />
          </div>
        </ChatContainerRoot>
      </div>

      <div className="bg-background z-10 shrink-0 px-3 pb-3 md:px-5 md:pb-5">
        <div className="mx-auto max-w-3xl">
          <PromptInput onSubmit={(e) => {
            e.preventDefault();
            if (input.trim() === '') return;
            sendMessage({
              text: input,
            }, {
              body: {
                model: selectedModel
              },
            });
            setInput('');
          }}>
            <PromptInputTextarea
              name="message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What would you like to know?"
              autoFocus
            />
            <PromptInputToolbar>
              {status === 'streaming' || status === 'submitted' ? (
                <PromptInputButton
                  type="button"
                  onClick={() => stop()}
                  className='ml-auto'
                >
                  {status === 'submitted' ? (
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