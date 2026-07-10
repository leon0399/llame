"use client";

import { useState } from "react";

import { ChevronDownIcon, ChevronRightIcon, LayersIcon } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import type { CompactionStats } from "@/lib/services/chat/history";
import {
  modelDisplayName,
  type AvailableModel,
} from "@/lib/services/models/queries";

// Matches the design file's own `fmtTokens` formatting convention exactly
// (double-sidebar design file: 1.5k, 2.3M — lowercase "k", trailing ".0"
// trimmed).
function formatTokenCount(value: number): string {
  const rounded = Math.round(value);
  if (rounded >= 1_000_000) {
    return `${trimTrailingZero((rounded / 1_000_000).toFixed(1))}M`;
  }
  if (rounded >= 1_000) {
    return `${trimTrailingZero((rounded / 1_000).toFixed(1))}k`;
  }
  return String(rounded);
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Marks where a long chat was compacted (#57): messages above are folded into
 * a server summary for the MODEL's context (they stay fully visible here —
 * this only explains the model's view). Matches Leo's design spec (the
 * "Trip to Lisbon" chat in the double-sidebar design file): a horizontal
 * rule interrupted by a centered pill chip (icon + "Context compacted" +
 * a chevron), which toggles an INLINE result card below it — not a modal.
 *
 * `stats` (#136) closes the compression-stats gap from the earlier design
 * pass: `GET :id/messages` now embeds compaction stats derived from the
 * compaction's `usage` telemetry (message count is seq-derived and always
 * present when a compaction exists; token counts/model depend on `usage`,
 * which an older or seeded compaction may lack). Chip meta prefers
 * "N messages · saved X tokens"; the card header prefers
 * "{before} → {after} tokens · {model}" — each falls back to a relative
 * timestamp independently when its own stats aren't available, rather than
 * showing nothing or fabricating a number.
 *
 * Read-only; the summary is the owner's own data, rendered PLAINTEXT
 * (`whitespace-pre-wrap`, no markdown) — it can carry content a future
 * public-share view would need to strip, so it must never become a markdown
 * beacon even though this endpoint itself is owner-scoped only.
 */
export function CompactionBoundary({
  summary,
  createdAt,
  stats,
  models,
}: {
  summary: string;
  createdAt: string;
  stats: CompactionStats;
  models?: readonly AvailableModel[];
}) {
  const [open, setOpen] = useState(false);
  const relativeTime = formatDistanceToNowStrict(new Date(createdAt), {
    addSuffix: true,
  });

  const hasTokenStats =
    stats.beforeTokens !== null && stats.afterTokens !== null;

  const chipMeta = (() => {
    if (stats.absorbedMessageCount === null) return relativeTime;
    const messageCount = pluralize(stats.absorbedMessageCount, "message");
    if (!hasTokenStats) return messageCount;
    // Non-null assertions guarded by hasTokenStats above.
    const saved = stats.beforeTokens! - stats.afterTokens!;
    return `${messageCount} · saved ${formatTokenCount(saved)} tokens`;
  })();

  const cardMeta = hasTokenStats
    ? `${formatTokenCount(stats.beforeTokens!)} → ${formatTokenCount(stats.afterTokens!)} tokens${
        stats.modelId ? ` · ${modelDisplayName(stats.modelId, models)}` : ""
      }`
    : relativeTime;

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
          <span className="text-xs text-muted-foreground">{chipMeta}</span>
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
              {cardMeta}
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
