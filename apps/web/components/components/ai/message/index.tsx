import { Markdown } from "@workspace/ui/components/markdown";
import { TextShimmer } from "@workspace/ui/components/text-shimmer";
import { cn } from "@workspace/ui/lib/utils";
import { UIMessage } from "ai";
import { cva, VariantProps } from "class-variance-authority";
import React, { ComponentProps, forwardRef } from "react";

export type MessageThinkingContentProps = Omit<ComponentProps<typeof TextShimmer>, 'children'> & {
  children?: string;
};

export function MessageThinkingContent({
  className,
  duration = 1,
  children = 'Thinking...',
  ...props
}: MessageThinkingContentProps) {
  return (
    <TextShimmer className={cn('font-mono text-sm', className)} duration={duration} {...props}>
      {children}
    </TextShimmer>
  );
}
MessageThinkingContent.displayName = 'MessageThinkingContent';

export type MessagePartProps = {
  part: UIMessage['parts'][number];
}

export function MessagePart({
  part,
}: MessagePartProps) {
  if (part.type === 'text') {
    return (
      <Markdown className="prose dark:prose-invert max-w-none">
        {part.text}
      </Markdown>
    );
  }

  return (
    <div className="text-red-500">
      Unsupported message part type: {part.type}
    </div>
  );
}
MessagePart.displayName = 'MessagePart';

export type MessageContentProps = {
  message: UIMessage;
}

export function MessageContent({
  message,
}: MessageContentProps) {
  return (
    <>
      {message.parts.map((part, index) => (
        <MessagePart key={index} part={part} />
      ))}
    </>
  );
}
MessageContent.displayName = 'MessageContent';

const messageBubbleVariant = cva(
  "flex gap-2 max-w-[60%] items-end relative group",
  {
    variants: {
      variant: {
        received: "self-start",
        sent: "self-end flex-row-reverse",
      },
      layout: {
        default: "",
        ai: "max-w-full w-full items-center",
      },
    },
    defaultVariants: {
      variant: "received",
      layout: "default",
    },
  },
);

interface MessageBubbleProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof messageBubbleVariant> {}

const MessageContainer = forwardRef<HTMLDivElement, MessageBubbleProps>(
  ({ className, variant, layout, children, ...props }, ref) => (
    <div
      className={cn(
        messageBubbleVariant({ variant, layout, className }),
        "relative group",
      )}
      ref={ref}
      {...props}
    >
      {React.Children.map(children, (child) =>
        React.isValidElement(child) && typeof child.type !== "string"
          ? React.cloneElement(child, {
              variant,
              layout,
            } as React.ComponentProps<typeof child.type>)
          : child,
      )}
    </div>
  ),
);
MessageContainer.displayName = "MessageContainer";

export type MessageProps = {
  message: UIMessage;
  className?: string;
}

export function Message({
  message,
  className
}: MessageProps) {
  return (
    <MessageContainer
      variant={message.role === 'user' ? 'sent' : 'received'}
      layout={message.role === 'assistant' ? 'ai' : 'default'}
      className={cn(className)}
    >
      <MessageContent message={message} />
    </MessageContainer>
  );
}
Message.displayName = 'Message';
