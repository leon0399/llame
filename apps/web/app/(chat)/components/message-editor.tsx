"use client";

import { useState } from "react";

import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";

/**
 * Inline editor for a user message (edit & resubmit). Save is disabled until the
 * text is non-empty AND changed. Cmd/Ctrl+Enter saves, Escape cancels.
 */
export function MessageEditor({
  initialText,
  onSave,
  onCancel,
}: {
  initialText: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const trimmed = text.trim();
  const canSave = trimmed.length > 0 && trimmed !== initialText.trim();

  return (
    <div className="flex w-full max-w-[85%] flex-col gap-2 sm:max-w-[75%]">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        rows={3}
        aria-label="Edit message"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSave) {
            e.preventDefault();
            onSave(trimmed);
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(trimmed)} disabled={!canSave}>
          Save &amp; submit
        </Button>
      </div>
    </div>
  );
}
