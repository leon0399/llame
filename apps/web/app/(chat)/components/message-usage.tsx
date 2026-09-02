"use client";

/**
 * Per-turn usage/cost/model for an assistant message — matches Leo's
 * authoritative design (the telemetry hover card in
 * `llame-double-sidebar.dc.html`'s `.tel-hc` / `.tel-badge` / `.tel-pop`
 * markup): a terse `font-mono` badge ("model · total time") that reveals a
 * 3-column breakdown (Performance / Tokens / Cost & model) on hover/focus.
 * Scoped to the PER-MESSAGE card only — the design also shows a separate
 * right-hand sidebar context-window gauge, deliberately out of scope here.
 *
 * The data is the persisted turn telemetry, carried on `message.metadata.usage`
 * both live (a run-bridge message-metadata chunk) and from history — a single
 * render path serves both. BYOK cost transparency (#91/telemetry); the model
 * that produced each reply is the display half of #145's deferred model
 * attribution (the model id is already persisted per-turn, this is client-only).
 *
 * Uses `HoverCard`, not `Tooltip`: this is rich, structured content (a
 * 3-column table), which is exactly what HoverCard is for and what Tooltip's
 * ARIA role is not (a tooltip should be brief, supplementary text). It also
 * ships the popover-surfaced card treatment DESIGN.md specifies for these
 * overlays out of the box (bg-popover/border/shadow-md) with no arrow —
 * Tooltip's own Arrow element stayed `bg-foreground` even after overriding
 * the content's background, producing a mismatched dark diamond glued to a
 * light card.
 *
 * Known gap vs. the design (flagged, not silently dropped): the Performance
 * column's "First token" / "Speed" / "Chunks" rows need per-turn instrumentation
 * (time-to-first-token, tokens/sec, delta-chunk count) that the persisted
 * `TurnTelemetry` doesn't compute yet — only "Total" (latencyMs) exists today.
 * That's a backend follow-up, out of scope for this display-only pass.
 */

import { InfoIcon } from "lucide-react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import { cn } from "@workspace/ui/lib/utils";

import {
  modelDisplayName,
  type AvailableModel,
} from "@/lib/services/models/queries";
import { effortDisplayLabel } from "@/lib/services/models/effort";

export type TurnUsage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  modelId?: string;
  effort?: string;
  latencyMs?: number;
  costUsd?: number | null;
  status?: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Non-null-object guard; the object's actual shape is unknown to this file. */
function isPlainObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function num(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) return undefined;
  return value;
}

/** The subset of `metadata.usage`'s fields this file reads, still unvalidated. */
type RawTurnUsage = {
  inputTokens?: unknown;
  cachedInputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  reasoningTokens?: unknown;
  modelId?: unknown;
  effort?: unknown;
  latencyMs?: unknown;
  costUsd?: unknown;
  status?: unknown;
};

/** Parse the opaque `metadata.usage` into the known telemetry fields. */
export function parseTurnUsage(metadata: unknown): TurnUsage | null {
  if (!isPlainObject(metadata)) return null;
  // SAFETY: `isPlainObject` only proves `metadata` is a non-null object; the
  // `usage` property may be absent or any shape, which the `isPlainObject`
  // check right below re-validates before anything reads through it.
  const usage = (metadata as { usage?: unknown }).usage;
  if (!isPlainObject(usage)) return null;
  // SAFETY: `RawTurnUsage` only names the fields read below, each still
  // `unknown` and independently guarded (`num`/`isString`) before use.
  const u = usage as RawTurnUsage;
  return {
    inputTokens: num(u.inputTokens),
    cachedInputTokens: num(u.cachedInputTokens),
    outputTokens: num(u.outputTokens),
    totalTokens: num(u.totalTokens),
    reasoningTokens: num(u.reasoningTokens),
    modelId: isString(u.modelId) ? u.modelId : undefined,
    effort: isString(u.effort) ? u.effort : undefined,
    latencyMs: num(u.latencyMs),
    costUsd: u.costUsd === null ? null : num(u.costUsd),
    status: isString(u.status) ? u.status : undefined,
  };
}

function trimTrailingZero(s: string): string {
  return s.replace(/\.0$/, "");
}

/**
 * Abbreviated token count ("1.5k", "1.2M"), matching the design's own
 * `fmtTokens` exactly. Deliberately locale-independent (plain string math, no
 * `Intl.NumberFormat`) — same SSR-hydration-safety goal the repo's earlier
 * `en-US`-pinned formatting served, just via a format that needs no locale at
 * all.
 */
function fmtTokens(n: number): string {
  const rounded = Math.round(n);
  if (rounded >= 1_000_000) {
    return `${trimTrailingZero((rounded / 1_000_000).toFixed(1))}M`;
  }
  if (rounded >= 1000) {
    return `${trimTrailingZero((rounded / 1000).toFixed(1))}k`;
  }
  return String(rounded);
}

export function formatCost(costUsd: number): string {
  // The design's own precision tiers (2dp at/above $1, 3dp at/above a cent,
  // else 4dp), plus a fallback this repo's own review round added: below
  // $0.0001, toFixed(4) would round a real, nonzero cost down to "0.0000" —
  // indistinguishable from a genuinely free turn. The row is labeled "Est.
  // cost" (not a "~" value prefix) — the estimate signal now lives in the
  // label, matching the design's copy.
  if (costUsd > 0 && costUsd < 0.0001) return "<$0.0001";
  if (costUsd >= 1) return `$${costUsd.toFixed(2)}`;
  if (costUsd >= 0.01) return `$${costUsd.toFixed(3)}`;
  return `$${costUsd.toFixed(4)}`;
}

function formatLatency(latencyMs: number): string {
  // 2 decimal places once past 1s, matching the design's `fmtMs` exactly.
  return latencyMs < 1000
    ? `${Math.round(latencyMs)}ms`
    : `${(latencyMs / 1000).toFixed(2)}s`;
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
export type UsageSection = { header: string; rows: Array<UsageRow> };

/** Derived display values shared by the badge text and the Cost & model section. */
type UsageDisplayContext = {
  modelName: string | undefined;
  effortDisplay: string | undefined;
  hasTokens: boolean;
};

function buildBadgeText(
  usage: TurnUsage,
  label: string | null,
  ctx: UsageDisplayContext,
): string | null {
  if (usage.modelId) {
    // The design's badge shape: "model · effort · total time" — tokens/cost
    // live only in the hover breakdown, not inline. Effort sits between the
    // two because it qualifies the model, not the timing, and drops out
    // entirely for a turn that carried none rather than showing a placeholder.
    return [
      label,
      ctx.modelName,
      ctx.effortDisplay ?? null,
      usage.latencyMs !== undefined ? formatLatency(usage.latencyMs) : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  }
  if (ctx.hasTokens) {
    // A turn persisted before model tracking existed — degrade to the
    // token-only shape rather than showing nothing.
    // SAFETY: `hasTokens` is `totalTokens !== undefined && totalTokens !== 0`.
    return [label, `${fmtTokens(usage.totalTokens as number)} tokens`]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  }
  return null;
}

// Performance section — only "Total" is available today; see the file header
// for the First token / Speed / Chunks gap.
function buildPerformanceSection(usage: TurnUsage): UsageSection | null {
  if (usage.latencyMs === undefined) return null;
  return {
    header: "Performance",
    rows: [{ label: "Total", value: formatLatency(usage.latencyMs) }],
  };
}

function buildTokenSection(usage: TurnUsage): UsageSection | null {
  const rows: Array<UsageRow> = [];
  if (usage.inputTokens !== undefined) {
    rows.push({ label: "Input", value: fmtTokens(usage.inputTokens) });
  }
  if (usage.cachedInputTokens !== undefined) {
    rows.push({
      label: "of which cached",
      value: fmtTokens(usage.cachedInputTokens),
    });
  }
  if (usage.outputTokens !== undefined) {
    rows.push({ label: "Output", value: fmtTokens(usage.outputTokens) });
  }
  if (usage.outputTokens !== undefined || usage.reasoningTokens !== undefined) {
    // Always shown once we have real turn data (defaulting to 0 for a
    // non-reasoning model), matching the design's consistent 4-row Tokens
    // column rather than omitting the row for the common non-reasoning case.
    rows.push({
      label: "Reasoning",
      value: fmtTokens(usage.reasoningTokens ?? 0),
    });
  }
  return rows.length > 0 ? { header: "Tokens", rows } : null;
}

function buildCostSection(
  usage: TurnUsage,
  ctx: UsageDisplayContext,
): UsageSection | null {
  const rows: Array<UsageRow> = [];
  if (usage.modelId) {
    rows.push({ label: "Model", value: ctx.modelName ?? usage.modelId });
  }
  // Indented beneath Model the way "of which cached" sits beneath Input: it
  // qualifies the row above rather than standing as a peer fact.
  if (ctx.effortDisplay !== undefined) {
    rows.push({ label: "at effort", value: ctx.effortDisplay });
  }
  if (ctx.hasTokens) {
    // SAFETY: `hasTokens` is `totalTokens !== undefined && totalTokens !== 0`.
    rows.push({
      label: "Total tokens",
      value: fmtTokens(usage.totalTokens as number),
    });
  }
  // Omitted entirely when cost is unknown (an unpriced model) — never a fake
  // "$0.00".
  if (usage.costUsd !== undefined && usage.costUsd !== null) {
    rows.push({ label: "Est. cost", value: formatCost(usage.costUsd) });
  }
  return rows.length > 0 ? { header: "Cost & model", rows } : null;
}

/**
 * The visible badge `text` + the hover card's column `sections` for a turn, or
 * null to render nothing. Pure (deterministic formatting, no Date), so the
 * render decision is unit-tested without a DOM.
 */
export function buildUsageLine(
  usage: TurnUsage | null,
  models?: ReadonlyArray<AvailableModel>,
): { text: string; sections: Array<UsageSection> } | null {
  if (!usage) return null;

  const ctx: UsageDisplayContext = {
    modelName:
      usage.modelId !== undefined
        ? modelDisplayName(usage.modelId, models)
        : undefined,
    effortDisplay:
      usage.effort !== undefined
        ? effortDisplayLabel(
            models?.find((model) => model.id === usage.modelId)?.reasoning
              ?.effortLevels,
            usage.effort,
          )
        : undefined,
    hasTokens: usage.totalTokens !== undefined && usage.totalTokens !== 0,
  };

  const text = buildBadgeText(usage, usageStatusLabel(usage.status), ctx);
  if (text === null) return null;

  const sections = [
    buildPerformanceSection(usage),
    buildTokenSection(usage),
    buildCostSection(usage, ctx),
  ].filter((section): section is UsageSection => section !== null);

  return { text, sections };
}

// Shared typography/spacing (matches the design's `.tel-badge`) — the
// negative left margin is an optical alignment trick so the badge's own
// padding doesn't visually indent past the message content's left edge.
const badgeTypographyClassName =
  "text-muted-foreground -ml-[0.45rem] mt-1 inline-flex w-fit items-center gap-[0.3rem] rounded-md px-[0.45rem] py-[0.2rem] font-mono text-[0.72rem]";

/** One Performance/Tokens/Cost & model column of the hover card's breakdown. */
function UsageSectionColumn({ section }: { section: UsageSection }) {
  return (
    <div className="flex min-w-[7rem] flex-col gap-[0.32rem]">
      <div className="text-[0.66rem] font-semibold tracking-wider text-muted-foreground uppercase">
        {section.header}
      </div>
      {section.rows.map((row) => (
        <div
          key={row.label}
          className={cn(
            "flex items-center justify-between gap-[1.1rem] text-xs",
            (row.label === "of which cached" || row.label === "at effort") &&
              "pl-[0.85rem]",
          )}
        >
          <span className="text-muted-foreground">{row.label}</span>
          <b className="font-mono font-medium text-foreground">{row.value}</b>
        </div>
      ))}
    </div>
  );
}

export function MessageUsage({
  metadata,
  models,
}: {
  metadata: unknown;
  models?: ReadonlyArray<AvailableModel>;
}) {
  const line = buildUsageLine(parseTurnUsage(metadata), models);
  // `sections` is never empty once `text` is non-null: a known model always
  // contributes at least a "Model" row and a token-only legacy turn always
  // contributes at least a "Total tokens" row to Cost & model — so there is
  // always something to reveal on hover.
  if (!line) return null;

  return (
    // delay=0/closeDelay=0 (on the trigger, per Base UI): this is a
    // data-disclosure hover, not a "sneak peek" — reveal immediately,
    // matching the design's plain CSS `:hover` (no delay).
    <HoverCard>
      <HoverCardTrigger
        delay={0}
        closeDelay={0}
        render={
          <button
            type="button"
            aria-label={`Message usage: ${line.text}`}
            className={cn(
              badgeTypographyClassName,
              "cursor-default transition-colors hover:bg-accent hover:text-foreground",
            )}
          />
        }
      >
        {line.text}
        <InfoIcon size={12} className="opacity-70" />
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        // HoverCardContent already ships the popover-surfaced card treatment
        // DESIGN.md specifies for these overlays (bg-popover, border,
        // shadow-md, no arrow) — just widen it past the default w-64/p-4 for
        // this card's 3-column table layout.
        className="flex w-fit max-w-none flex-nowrap gap-[1.9rem] p-[0.8rem]"
      >
        {line.sections.map((section) => (
          <UsageSectionColumn key={section.header} section={section} />
        ))}
      </HoverCardContent>
    </HoverCard>
  );
}
