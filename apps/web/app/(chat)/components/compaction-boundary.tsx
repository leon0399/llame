"use client";

import { useState } from "react";

import { ChevronDownIcon, ChevronRightIcon, LayersIcon } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";

/**
 * Marks where a long chat was compacted (#57): messages above are folded into
 * a server summary for the MODEL's context (they stay fully visible here —
 * this only explains the model's view). Matches Leo's design spec (the
 * "Trip to Lisbon" chat in the double-sidebar design file): a horizontal
 * rule interrupted by a centered pill chip (icon + "Context compacted" +
 * a chevron), which toggles an INLINE result card below it — not a modal.
 *
 * DATA GAP, not a token-mapping detail — this is a decision for Leo, not one
 * made silently: the design's chip meta reads "N messages · saved X tokens"
 * and the card header reads "{before} → {after} tokens · {model}" — the
 * actual SUBSTANCE of this feature (how much context got folded). The
 * design's own data model has no timestamp on this element at all. The
 * current `GET /chats/:id/compaction` response only carries
 * `{ uptoSeq, summary, createdAt }` — no `usage`/message-count/model, even
 * though `compactions.usage` (jsonb) already exists in the DB and could
 * carry it; exposing it is a DTO/egress change deserving its own review, not
 * something to fold silently into a styling pass. Until that's decided, the
 * card header shows a relative timestamp (`createdAt`) as a placeholder —
 * ONE occurrence only (not duplicated in the chip, which the compression
 * stats can't be substituted for without misleading duplication). Options:
 * (a) keep this placeholder, (b) show no meta at all until the real stats
 * exist (arguably more honest than a substitute), (c) extend the DTO with
 * the real compression stats — the only path to literal design fidelity.
 *
 * Read-only; the summary is the owner's own data, rendered PLAINTEXT
 * (`whitespace-pre-wrap`, no markdown) — it can carry content a future
 * public-share view would need to strip, so it must never become a markdown
 * beacon even though this endpoint itself is owner-scoped only.
 */
export function CompactionBoundary({
  summary,
  createdAt,
}: {
  summary: string;
  createdAt: string;
}) {
  const [open, setOpen] = useState(false);
  const relativeTime = formatDistanceToNowStrict(new Date(createdAt), {
    addSuffix: true,
  });

  return (
    <div className="w-full">
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-full border border-border",
            "bg-background px-3 py-1.5 text-foreground shadow-xs transition-colors",
            "hover:bg-accent",
          )}
        >
          <LayersIcon
            aria-hidden="true"
            className="size-[15px] text-muted-foreground"
          />
          <span className="text-sm font-medium">Context compacted</span>
          {open ? (
            <ChevronDownIcon
              aria-hidden="true"
              className="size-[15px] text-muted-foreground"
            />
          ) : (
            <ChevronRightIcon
              aria-hidden="true"
              className="size-[15px] text-muted-foreground"
            />
          )}
        </button>
        <Separator className="flex-1" />
      </div>
      {open && (
        <div className="mt-2.5 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <span className="text-[0.82rem] font-semibold">
              Compaction result
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {relativeTime}
            </span>
          </div>
          <div className="px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap">
            {summary}
          </div>
          <div className="px-3.5 pb-3 text-xs leading-relaxed text-muted-foreground">
            This summary replaces the compacted messages in the model&apos;s
            context. The full transcript is preserved and still searchable —
            nothing is hidden.
          </div>
        </div>
      )}
    </div>
  );
}
