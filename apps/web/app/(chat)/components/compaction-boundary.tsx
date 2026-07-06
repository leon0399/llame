"use client";

import { useState } from "react";

import { LayersIcon } from "lucide-react";

import {
  Checkpoint,
  CheckpointIcon,
  CheckpointTrigger,
} from "@/components/components/ai/checkpoint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";

/**
 * Marks where a long chat was compacted (#57): messages above are folded into
 * a server summary for the MODEL's context (they stay fully visible here —
 * this only explains the model's view). A distinct timeline checkpoint (AI
 * Elements' Checkpoint pattern — a horizontal-rule row with an icon + label,
 * https://elements.ai-sdk.dev/components/checkpoint — vendored into
 * @/components/components/ai/checkpoint since there's no shadcn-registry
 * entry for it), not a subtle inline expander: the boundary must be clearly
 * visible in the conversation, not easy to miss. Clicking it opens the
 * summary in a modal. Read-only; the summary is the owner's own data,
 * rendered PLAINTEXT (`whitespace-pre-wrap`, no markdown) — it can carry
 * content a future public-share view would need to strip, so it must never
 * become a markdown beacon even though this endpoint itself is owner-scoped
 * only.
 */
export function CompactionBoundary({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Checkpoint className="my-4">
        <CheckpointIcon>
          <LayersIcon aria-hidden="true" className="size-4 shrink-0" />
        </CheckpointIcon>
        <CheckpointTrigger onClick={() => setOpen(true)}>
          Earlier messages summarized for context
        </CheckpointTrigger>
      </Checkpoint>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compacted conversation summary</DialogTitle>
            <DialogDescription>
              Earlier turns were folded into this summary for the model&apos;s
              context. The messages themselves are still shown above — this is
              what the model sees instead of them.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm whitespace-pre-wrap">{summary}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
