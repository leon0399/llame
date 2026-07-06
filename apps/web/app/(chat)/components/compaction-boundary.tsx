"use client";

import { LayersIcon } from "lucide-react";

/**
 * Marks where a long chat was compacted (#57): messages above are folded into a
 * server summary for the MODEL's context (they stay fully visible here — this
 * only explains the model's view). Click to read the summary. Read-only; the
 * summary is the owner's own data (React-escaped; never shared publicly).
 */
export function CompactionBoundary({ summary }: { summary: string }) {
  return (
    <details className="text-muted-foreground group my-4 rounded-lg text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="bg-border h-px flex-1" />
        <LayersIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="text-xs">Earlier messages summarized for context</span>
        <span aria-hidden="true" className="bg-border h-px flex-1" />
      </summary>
      <div className="bg-muted/30 mt-2 rounded-md border px-3 py-2 text-xs whitespace-pre-wrap">
        {summary}
      </div>
    </details>
  );
}
