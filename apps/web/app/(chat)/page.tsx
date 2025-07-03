'use client';

import { useChat } from '@ai-sdk/react';

import { LoaderCircleIcon, SendIcon, StopCircleIcon } from 'lucide-react';

import { Textarea } from '@workspace/ui/components/textarea';
import { useAutoResizeTextarea } from '@workspace/ui/hooks/use-autoresize-textarea';
import { cn } from '@workspace/ui/lib/utils';

import type { ComponentProps, HTMLAttributes, KeyboardEventHandler } from 'react';
import { Button } from '@workspace/ui/components/button';

export type AIInputProps = HTMLAttributes<HTMLFormElement>;

export const AIInput = ({ className, ...props }: AIInputProps) => (
  <form
    className={cn(
      'w-full divide-y overflow-hidden rounded-xl border bg-background shadow-sm',
      className
    )}
    {...props}
  />
);

export type AIInputTextareaProps = ComponentProps<typeof Textarea> & {
  minHeight?: number;
  maxHeight?: number;
};

export const AIInputTextarea = ({
  className,
  placeholder = 'What would you like to know?',
  minHeight = 48,
  maxHeight = 164,
  ...props
}: AIInputTextareaProps) => {
  const textareaRef = useAutoResizeTextarea({
    minHeight,
    maxHeight,
  });

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    // @TODO: allow to configure enter key behavior

    // if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    //   e.preventDefault();
    //   const form = e.currentTarget.form;
    //   if (form) {
    //     form.requestSubmit();
    //   }
    // }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  return (
    <Textarea
      name="message"
      placeholder={placeholder}
      ref={textareaRef}
      className={cn(
        'w-full resize-none rounded-none border-none p-3 shadow-none outline-none ring-0 focus-visible:ring-0',
        className
      )}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
};

export type AIInputToolbarProps = HTMLAttributes<HTMLDivElement>;

export const AIInputToolbar = ({
  className,
  ...props
}: AIInputToolbarProps) => (
  <div
    className={cn('flex items-center justify-between p-1', className)}
    {...props}
  />
);

export type AIInputButtonProps = ComponentProps<typeof Button>;

export const AIInputButton = ({
  className,
  variant = 'ghost',
  size = 'icon',
  ...props
}: AIInputButtonProps) => (
  <Button
    variant={variant}
    size={size}
    className={cn(
      'gap-1.5 text-muted-foreground cursor-pointer', 
      className
    )}
    {...props}
  />
);

export default function Page() {
  const { messages, input, handleInputChange, handleSubmit, status, stop } =
    useChat({
      api: '/api/v1/chat'
    });

  return (
    <div className="flex flex-col w-full min-h-screen justify-center gap-4 bg-secondary p-8">
      {messages.map(message => (
        <div key={message.id}>
          {message.role === 'user' ? 'User: ' : 'AI: '}
          {message.content}
        </div>
      ))}

      <AIInput onSubmit={handleSubmit} className='mt-auto'>
        <AIInputTextarea
          name="message"
          value={input}
          onChange={handleInputChange}
          placeholder="What would you like to know?"
        />
        <AIInputToolbar>
          {status === 'streaming' || status === 'submitted' ? (
            <AIInputButton
              type="button"
              onClick={() => stop()}
              className='ml-auto'
            >
              { status === 'submitted' ? (
                <LoaderCircleIcon size={16} className='animate-spin' />
              ) : (
                <StopCircleIcon size={16} />
              )}
            </AIInputButton>
          ) : (
            <AIInputButton
              className='ml-auto'
              type="submit"
            >
              <SendIcon size={16} />
            </AIInputButton>
          )}
        </AIInputToolbar>
      </AIInput>
    </div>
  );
}