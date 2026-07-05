"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import { usePromptsQuery } from "@/lib/services/prompts/queries";
import { matchingPrompts } from "@/lib/services/prompts/matching";

/**
 * The `/`-triggered prompt menu for the composer. Returns an `onKeyDown` to pass
 * to the textarea (intercepts Arrow/Enter/Escape ONLY while the menu is open —
 * bare Enter selects, Shift+Enter is left alone for a newline) and the rendered
 * menu (or null). Selecting a prompt replaces the composer input with its body.
 */
export function usePromptMenu({
  input,
  onInsert,
}: {
  input: string;
  onInsert: (content: string) => void;
}): { onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void; menu: ReactNode } {
  const { data: prompts = [] } = usePromptsQuery();
  const [highlighted, setHighlighted] = useState(0);
  // Escape dismisses the menu for the CURRENT input; any edit reopens it.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const matches = matchingPrompts(input, prompts);
  const open = matches !== null && input !== dismissedFor;
  const list = open ? matches : null;

  useEffect(() => {
    setHighlighted(0);
  }, [input]);

  const select = (content: string) => {
    onInsert(content);
    setDismissedFor(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!list) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && !e.shiftKey) {
      // Only BARE Enter selects; Shift+Enter falls through to a newline.
      e.preventDefault();
      const chosen = list[highlighted] ?? list[0];
      if (chosen) select(chosen.content);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissedFor(input);
    }
  };

  const menu = list ? (
    <div
      role="listbox"
      aria-label="Prompt commands"
      className="bg-popover text-popover-foreground mb-1 max-h-64 overflow-y-auto rounded-lg border shadow-md"
    >
      {list.map((prompt, i) => (
        <button
          key={prompt.id}
          type="button"
          role="option"
          aria-selected={i === highlighted}
          onMouseEnter={() => setHighlighted(i)}
          onClick={() => select(prompt.content)}
          className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm ${
            i === highlighted ? "bg-accent text-accent-foreground" : ""
          }`}
        >
          <span className="font-medium">/{prompt.name}</span>
          <span className="text-muted-foreground line-clamp-1 text-xs">
            {prompt.content}
          </span>
        </button>
      ))}
    </div>
  ) : null;

  return { onKeyDown, menu };
}
