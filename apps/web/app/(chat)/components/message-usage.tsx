"use client";

/**
 * Per-turn usage/cost/model for an assistant message — a discreet badge that
 * opens a structured tooltip breakdown on hover/focus, adapted from
 * assistant-ui's message-timing (badge + tooltip breakdown) and context-display
 * (structured label/value rows) patterns to our own telemetry shape and to
 * DESIGN.md's semantic tokens: no ad-hoc severity colors — `--destructive` is
 * this system's only standing chromatic color (destructive/invalid states) and
 * the chart ramp is reserved for real data-viz surfaces, neither of which this
 * inline badge is — so context-window pressure is numeric-only, matching
 * assistant-ui's own colorless "Text" context-display variant.
 *
 * The data is the persisted turn telemetry, carried on `message.metadata.usage`
 * both live (a run-bridge message-metadata chunk) and from history — a single
 * render path serves both. BYOK cost transparency (#91/telemetry); the model
 * that produced each reply is the display half of #145's deferred model
 * attribution (the model id is already persisted per-turn, this is client-only).
 */

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import { modelContextWindow, modelDisplayName } from "@/lib/ai/models";

type TurnUsage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  model?: string;
  latencyMs?: number;
  costUsd?: number | null;
  status?: string;
};

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Parse the opaque `metadata.usage` into the known telemetry fields. */
export function parseTurnUsage(metadata: unknown): TurnUsage | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const usage = (metadata as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;
  return {
    inputTokens: num(u.inputTokens),
    cachedInputTokens: num(u.cachedInputTokens),
    outputTokens: num(u.outputTokens),
    totalTokens: num(u.totalTokens),
    reasoningTokens: num(u.reasoningTokens),
    model: typeof u.model === "string" ? u.model : undefined,
    latencyMs: num(u.latencyMs),
    costUsd: u.costUsd === null ? null : num(u.costUsd),
    status: typeof u.status === "string" ? u.status : undefined,
  };
}

// Fixed 'en-US' locale so server and client format identically (no hydration
// mismatch) regardless of the runtime default.
const nf = new Intl.NumberFormat("en-US");

export function formatCost(costUsd: number): string {
  // Sub-cent turns are common with cheap models — show enough precision. The
  // leading "~" signals an ESTIMATE: costUsd comes from a small built-in price
  // map keyed by model id, not the user's actual BYOK billing.
  if (costUsd > 0 && costUsd < 0.0001) {
    // toFixed(4) would round a real, nonzero cost down to "0.0000" —
    // indistinguishable from a genuinely free turn. Say so explicitly instead.
    return "~<$0.0001";
  }
  const dollars =
    costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
  return `~${dollars}`;
}

function formatLatency(latencyMs: number): string {
  return latencyMs < 1000
    ? `${Math.round(latencyMs)}ms`
    : `${(latencyMs / 1000).toFixed(1)}s`;
}

/**
 * A leading label when the turn did NOT complete normally, so a partial
 * (real-but-cut-short) usage line isn't misread as a finished answer. Completed
 * turns get no label. Pure so it's unit-tested without rendering.
 */
export function usageStatusLabel(status: string | undefined): string | null {
  if (status === "aborted") return "stopped";
  if (status === "error") return "error";
  return null;
}

export type UsageRow = { label: string; value: string };

/**
 * The visible badge `text` + structured tooltip `rows` for a turn, or null to
 * render nothing. Pure (deterministic formatting, no Date), so the render
 * decision — including the model-only branch (a turn that errored/stopped
 * before producing tokens still shows WHICH model) — is unit-tested without a
 * DOM.
 */
export function buildUsageLine(
  usage: TurnUsage | null,
): { text: string; rows: UsageRow[] } | null {
  const hasTokens = usage?.totalTokens !== undefined && usage.totalTokens !== 0;
  // Render when there's real token data OR a known model. Legacy status-only
  // rows (no tokens, no model) render nothing.
  if (!usage || (!hasTokens && !usage.model)) return null;

  const parts: string[] = [];
  // Lead with the model so "which model produced this reply" is visible at a
  // glance (not just on hover) — the model id is already persisted per-turn
  // (messages.usage.model), this is display-only.
  if (usage.model) parts.push(modelDisplayName(usage.model));
  const label = usageStatusLabel(usage.status);
  if (label) parts.push(label);
  if (hasTokens) {
    parts.push(`${nf.format(usage.totalTokens as number)} tokens`);
  }
  if (usage.costUsd !== undefined && usage.costUsd !== null) {
    parts.push(formatCost(usage.costUsd));
  }
  if (usage.latencyMs !== undefined) {
    parts.push(formatLatency(usage.latencyMs));
  }

  const rows: UsageRow[] = [];
  if (usage.inputTokens !== undefined) {
    rows.push({ label: "Input", value: nf.format(usage.inputTokens) });
  }
  // Deliberately truthy (not `!== undefined`): the backend always sets
  // cachedInputTokens (defaulting to 0 when no caching happened), so on
  // `!== undefined` the overwhelming majority of turns — which never use
  // prompt caching — would show a "Cached: 0" row on every single hover,
  // defeating the discreet/muted point of this badge.
  if (usage.cachedInputTokens) {
    rows.push({ label: "Cached", value: nf.format(usage.cachedInputTokens) });
  }
  if (usage.outputTokens !== undefined) {
    rows.push({ label: "Output", value: nf.format(usage.outputTokens) });
  }
  // `!== undefined` (not truthy): unlike cachedInputTokens, the backend OMITS
  // reasoningTokens entirely for non-reasoning models but sets it to a real 0
  // for a reasoning-capable model that chose not to reason this turn — a
  // truthy check would conflate those two distinct cases.
  if (usage.reasoningTokens !== undefined) {
    rows.push({
      label: "Reasoning",
      value: nf.format(usage.reasoningTokens),
    });
  }
  // Context-window pressure: the model's declared context window is a static
  // catalog fact (not per-turn telemetry), looked up client-side. A turn's
  // inputTokens is (system prompt + full/compacted history + this message) —
  // a faithful measure of how much of the window THIS request consumed, so
  // it doubles as a "context used" indicator without any new backend data.
  // Omitted entirely when the model isn't in the static catalog — never a
  // fabricated percentage against an unknown window.
  if (usage.model && usage.inputTokens !== undefined) {
    const contextWindow = modelContextWindow(usage.model);
    if (contextWindow) {
      const percent = Math.round((usage.inputTokens / contextWindow) * 100);
      rows.push({
        label: "Context",
        value: `${nf.format(usage.inputTokens)} / ${nf.format(contextWindow)} (${percent}%)`,
      });
    }
  }

  return { text: parts.join(" · "), rows };
}

export function MessageUsage({ metadata }: { metadata: unknown }) {
  const line = buildUsageLine(parseTurnUsage(metadata));
  if (!line) return null;

  // No detail to show on hover (e.g. a token-less errored turn with no model
  // known) — render the plain label, not an empty interactive tooltip.
  if (line.rows.length === 0) {
    return (
      <p className="text-muted-foreground mt-1 text-xs tabular-nums">
        {line.text}
      </p>
    );
  }

  return (
    // delayDuration=0: this is a data-disclosure hover, not a hint tooltip —
    // matches this shared Tooltip's own default (see tooltip.tsx), pinned
    // explicitly since not every call site in the app wraps a top-level
    // TooltipProvider.
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Message usage"
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              "mt-1 flex w-fit items-center rounded-md px-1.5 py-0.5 text-xs tabular-nums",
            )}
          >
            {line.text}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex flex-col gap-1">
          {line.rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4"
            >
              <span className="opacity-70">{row.label}</span>
              <span className="tabular-nums">{row.value}</span>
            </div>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
