"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

/**
 * Scrollable chat transcript container that auto-sticks to the bottom as new
 * messages stream in, while letting the reader scroll up without fighting
 * the auto-scroll. Wrap {@link ConversationContent} (or
 * {@link ConversationEmptyState}) as its child, and give it (or an ancestor)
 * a bounded height so it actually scrolls.
 *
 * @see https://elements.ai-sdk.dev/components/conversation
 * @summary for the scrollable, auto-stick-to-bottom message transcript
 */
export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

/**
 * Padded, gapped flex column that lays out message children (e.g. `Message`
 * from `./message.js`) inside a {@link Conversation}'s scrollable body.
 *
 * @summary for laying out messages inside the transcript's scrollable body
 */
export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 p-4", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  /** Heading shown above the description. */
  title?: string;
  /** Supporting text under the title; omit to hide it. */
  description?: string;
  /** Optional icon rendered above the title. */
  icon?: React.ReactNode;
};

/**
 * Centered placeholder rendered in place of {@link ConversationContent}
 * before any messages exist. Pass `children` instead of `title`/`description`
 * for a fully custom layout.
 *
 * @summary for the "no messages yet" placeholder state
 */
export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

/**
 * Floating "scroll to latest" affordance that renders only while the reader
 * has scrolled away from the bottom of a {@link Conversation}. Must be
 * rendered inside a `Conversation` — it reads stick-to-bottom state from
 * context.
 *
 * @summary for the floating jump-to-latest-message button
 */
export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full",
          className,
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
