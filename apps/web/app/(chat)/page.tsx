'use client';

import React from 'react';

import { useChat } from '@ai-sdk/react';

import { LoaderCircleIcon, SendIcon, StopCircleIcon } from 'lucide-react';

import { Message, MessageThinkingContent } from '@/components/components/ai/message';
import { PromptInput, PromptInputButton, PromptInputTextarea, PromptInputToolbar } from '@/components/components/ai/prompt-input';

export default function Page() {
  const { messages, input, handleInputChange, handleSubmit, status, stop } =
    useChat({
      api: '/api/v1/chats'
    });

  return (
    <div className="flex flex-col w-full min-h-screen justify-center gap-4 p-8">
      <div className="relative w-full">
        <div className="flex flex-col w-full p-4 overflow-y-auto">
          <div className="flex flex-col gap-6">
            {messages.map(message => (
              <Message message={message} key={message.id} />
            ))}
          </div>

          {status === 'submitted' && (
            <div>
              <MessageThinkingContent />
            </div>
          )}
        </div>
      </div>

      <PromptInput onSubmit={handleSubmit} className='mt-auto '>
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
              { status === 'submitted' ? (
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
  );
}