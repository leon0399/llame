"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { UIMessage } from "ai";

import { MessageActionButton } from "./message-action-button";

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
    <>
      <MessageActionButton
        label="Copy"
        icon={copied ? CheckIcon : CopyIcon}
        disabled={markdown === ""}
        onClick={() => void copy()}
      />
      {/* Outside the button, so its name stays "Copy"; announces success. */}
      <output className="sr-only">{copied ? "Copied" : ""}</output>
    </>
  );
}
