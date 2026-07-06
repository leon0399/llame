"use client";

// Matches @workspace/ui/components/button's own convention (`import * as
// React from "react"`): Next's bundler doesn't need it (automatic JSX
// runtime), but it keeps this file's JSX transformable standalone too — this
// component's vitest render test transforms it directly, outside Next/SWC.
import * as React from "react";
import { GitBranchIcon } from "lucide-react";
import { Button } from "@workspace/ui/components/button";

// Relative (not "@/…") import deliberately: keeps this leaf component free of
// the tsconfig path alias, so its render test can run under plain vitest
// (no vite-tsconfig-paths / alias config needed for a single component).
import { useForkChat } from "../../../lib/services/chat/fork";

/**
 * Fork-from-here action: copies the conversation up to this message into a
 * new chat the caller owns. Lives in a message's action row (alongside future
 * actions like copy) — a persistent, always-visible affordance, not a
 * hover-reveal — so the feature stays discoverable.
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
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      aria-label="Fork from here"
      title="Fork the conversation from here into a new chat"
      disabled={disabled || forkMutation.isPending}
      onClick={() =>
        forkMutation.mutate(
          { chatId, fromMessageId },
          { onSuccess: (forked) => onForked(forked.id) },
        )
      }
    >
      <GitBranchIcon className="h-3.5 w-3.5" />
    </Button>
  );
}
