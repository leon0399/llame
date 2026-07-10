"use client";

import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";

import { usePromptsQuery } from "@/lib/services/prompts/queries";
import { matchingPrompts } from "@/lib/services/prompts/matching";
import {
  extractPlaceholders,
  fillPlaceholders,
} from "@/lib/services/prompts/templating";

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
  // A selected prompt whose body has {{placeholders}} → the fill-in dialog.
  const [fillContent, setFillContent] = useState<string | null>(null);

  const matches = matchingPrompts(input, prompts);
  const open = matches !== null && input !== dismissedFor;
  const list = open ? matches : null;

  useEffect(() => {
    setHighlighted(0);
  }, [input]);

  const select = (content: string) => {
    // A prompt with {{placeholders}} opens a fill dialog; dismiss the `/` menu
    // for the current token (so cancelling doesn't reopen it in a loop). A
    // plain prompt inserts directly, as before.
    if (extractPlaceholders(content).length > 0) {
      setDismissedFor(input);
      setFillContent(content);
    } else {
      onInsert(content);
      setDismissedFor(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!list) return;
    // Real prompt names are ASCII slugs (DTO-enforced), but the query itself
    // can transiently match one mid-IME-composition (e.g. romaji "su" toward
    // a kana conversion can match a saved "/summarize" prompt). Don't hijack
    // the Enter that CONFIRMS the composition — let it through undisturbed.
    if (e.nativeEvent.isComposing) return;
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

  const menu = (
    <>
      {list && (
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
      )}
      {fillContent !== null && (
        <FillPromptDialog
          content={fillContent}
          onSubmit={(filled) => {
            onInsert(filled);
            setFillContent(null);
          }}
          onClose={() => setFillContent(null)}
        />
      )}
    </>
  );

  return { onKeyDown, menu };
}

/** Collects a value for each `{{placeholder}}`, then substitutes + inserts. */
function FillPromptDialog({
  content,
  onSubmit,
  onClose,
}: {
  content: string;
  onSubmit: (filled: string) => void;
  onClose: () => void;
}) {
  const placeholders = useMemo(() => extractPlaceholders(content), [content]);
  const [values, setValues] = useState<Record<string, string>>({});

  const submit = () => onSubmit(fillPlaceholders(content, values));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fill in the prompt</DialogTitle>
        </DialogHeader>
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {placeholders.map((name, i) => (
            <div key={name} className="space-y-1">
              {/* index-based id — a placeholder NAME can contain spaces/punct
                  ({{target language}}), which is invalid in a DOM id. */}
              <label className="text-xs font-medium" htmlFor={`ph-${i}`}>
                {name}
              </label>
              <Input
                id={`ph-${i}`}
                autoFocus={i === 0}
                value={values[name] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [name]: e.target.value }))
                }
                onKeyDown={(e) => {
                  // Don't hijack the Enter that confirms an IME composition
                  // (values can be any text, unlike the ASCII-slug `/` menu).
                  if (e.nativeEvent.isComposing) return;
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (i === placeholders.length - 1) {
                    submit();
                  } else {
                    document.getElementById(`ph-${i + 1}`)?.focus();
                  }
                }}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Insert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
