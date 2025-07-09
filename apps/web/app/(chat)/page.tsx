'use client';

import React, { useRef } from 'react';

import { useChat } from '@ai-sdk/react';

import { LoaderCircleIcon, SendIcon, StopCircleIcon } from 'lucide-react';

import { Message, MessageThinkingContent } from '@/components/components/ai/message';
import {
  PromptInput,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputToolbar
} from '@/components/components/ai/prompt-input';
import { ChatContainerContent, ChatContainerRoot, ScrollButton } from '@/components/components/ai/chat-container';

export default function Page() {
  const chatContainerRef = useRef<HTMLDivElement>(null)

  const { messages, input, handleInputChange, handleSubmit, status, stop } =
    useChat({
      api: '/api/v1/chats'
    });

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <div ref={chatContainerRef} className="relative flex-1 overflow-y-auto">
        <ChatContainerRoot className="h-full">
          <ChatContainerContent className="space-y-0 px-5 py-12">
            {messages.map(message => (
              <Message message={message} key={message.id} />
            ))}
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
              onChange={handleInputChange}
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
    </main>
  );
}