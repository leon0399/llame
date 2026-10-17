"use client";

// Matches @workspace/ui/components/button's own convention (`import * as
// React from "react"`): Next's bundler doesn't need it (automatic JSX
// runtime), but it keeps this file's JSX transformable standalone too — this
// component's vitest render test transforms it directly, outside Next/SWC.
import * as React from "react";
import { GitForkIcon } from "lucide-react";
import { Button } from "@workspace/ui/components/button";

// Relative (not "@/…") import deliberately: keeps this leaf component free of
// the tsconfig path alias, so its render test can run under plain vitest
// (no vite-tsconfig-paths / alias config needed for a single component).
import { useForkChat } from "../../../lib/services/chat/fork";

/**
 * Fork-from-here action: copies the conversation up to this message into a
 * new chat the caller owns. One labeled action in a message's action row; the
 * row, not this button, owns the hover reveal.
 */
export function MessageForkButton({
  chatId,
  fromMessageId,
  disabled = false,
  onForked,
}: {
  chatId: string;
  fromMessageId: string;
  disabled?: boolean;
  onForked: (forkedChatId: string) => void;
}) {
  const forkMutation = useForkChat();

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-label="Fork from here"
      disabled={disabled || forkMutation.isPending}
      onClick={() =>
        forkMutation.mutate(
          { chatId, fromMessageId },
          { onSuccess: (forked) => onForked(forked.id) },
        )
      }
    >
      <GitForkIcon data-icon="inline-start" aria-hidden="true" />
      <span className="text-trim-cap">Fork</span>
    </Button>
  );
}
