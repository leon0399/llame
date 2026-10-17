"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { UIMessage } from "ai";

import { Button } from "@workspace/ui/components/button";

import { copyText } from "@/lib/clipboard";

/**
 * Copies a message's Markdown: its text parts only, in stored order, separated
 * by a blank line. Reasoning, tool calls, and attachments are not part of the
 * text, so they are left out.
 */
export function MessageCopyButton({ parts }: { parts: UIMessage["parts"] }) {
  const [copied, setCopied] = useState(false);
  const markdown = parts
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .filter((text) => text !== "")
    .join("\n\n");

  const copy = async () => {
    if (await copyText(markdown)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={markdown === ""}
      onClick={() => void copy()}
    >
      {copied ? (
        <CheckIcon data-icon="inline-start" aria-hidden="true" />
      ) : (
        <CopyIcon data-icon="inline-start" aria-hidden="true" />
      )}
      <span className="text-trim-cap">Copy</span>
    </Button>
  );
}
