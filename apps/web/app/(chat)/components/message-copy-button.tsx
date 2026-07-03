"use client";

import { useState } from "react";

import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";

import { copyText, messageText } from "@/lib/clipboard";

/** Copy a message's text parts to the clipboard (secure-context-safe). */
export function MessageCopyButton({ parts }: { parts: ReadonlyArray<unknown> }) {
  const [copied, setCopied] = useState(false);
  const text = messageText(parts);
  if (!text) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      aria-label="Copy message"
      title="Copy"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
