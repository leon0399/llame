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
  /**
   * Provider-reported cache-creation tokens. They are a SUBSET of
   * `inputTokens` (the adapter's input total includes them), reported
   * separately so a cached turn's largest line stays visible; llame never
   * infers or backfills the count.
   */
  cacheWriteTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  modelId?: string;
  effort?: string;
  latencyMs?: number;
  costUsd?: number | null;
  status?: string;
  complete?: boolean;
  billing?: "usage" | "subscription";
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
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
  cacheWriteTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  reasoningTokens?: unknown;
  modelId?: unknown;
  effort?: unknown;
  latencyMs?: unknown;
  costUsd?: unknown;
  status?: unknown;
  complete?: unknown;
  billing?: unknown;
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
  // validated by its field parser or billing enum check before use.
  const u = usage as RawTurnUsage;
  return {
    inputTokens: num(u.inputTokens),
    cachedInputTokens: num(u.cachedInputTokens),
    cacheWriteTokens: num(u.cacheWriteTokens),
    outputTokens: num(u.outputTokens),
    totalTokens: num(u.totalTokens),
    reasoningTokens: num(u.reasoningTokens),
    modelId: isString(u.modelId) ? u.modelId : undefined,
    effort: isString(u.effort) ? u.effort : undefined,
    latencyMs: num(u.latencyMs),
    costUsd: u.costUsd === null ? null : num(u.costUsd),
    status: isString(u.status) ? u.status : undefined,
    complete: isBoolean(u.complete) ? u.complete : undefined,
    billing:
      u.billing === "usage" || u.billing === "subscription"
        ? u.billing
        : undefined,
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

/** Preserve a numeric floor when an incomplete cost is below display precision. */
function formatLowerBoundCost(costUsd: number): string {
  if (costUsd <= 0 || costUsd >= 0.0001) return formatCost(costUsd);
  const exponent = Math.floor(Math.log10(costUsd));
  const decimalPlaces = 1 - exponent;
  const scale = 10 ** decimalPlaces;
  const truncatedCost = Math.floor(costUsd * scale) / scale;
  return `$${truncatedCost.toFixed(decimalPlaces)}`;
}

/** A cost as displayed: exact, or a numeric floor after the lower-bound prefix. */
function formatDisplayCost(costUsd: number, lowerBoundPrefix: string): string {
  return lowerBoundPrefix === ""
    ? formatCost(costUsd)
    : `${lowerBoundPrefix}${formatLowerBoundCost(costUsd)}`;
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
export type UsageLine = {
  text: string;
  sections: Array<UsageSection>;
  incompleteNotice?: string;
};
/** Display values shared by the badge and Cost & model section. */
type UsageDisplayContext = {
  modelName: string | undefined;
  effortDisplay: string | undefined;
  totalTokens: number | undefined;
  lowerBoundPrefix: string;
};

function buildUsageDisplayContext(
  usage: TurnUsage,
  models?: ReadonlyArray<AvailableModel>,
): UsageDisplayContext {
  return {
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
    totalTokens:
      usage.totalTokens !== 0 || usage.complete === false
        ? usage.totalTokens
        : undefined,
    lowerBoundPrefix: usage.complete === false ? "≥ " : "",
  };
}

function buildBadgeText(
  usage: TurnUsage,
  label: string | null,
  ctx: UsageDisplayContext,
): string | null {
  const totalTokensText =
    ctx.totalTokens === undefined
      ? null
      : `${ctx.lowerBoundPrefix}${fmtTokens(ctx.totalTokens)} tokens`;
  const costText =
    usage.costUsd === undefined || usage.costUsd === null
      ? null
      : formatDisplayCost(usage.costUsd, ctx.lowerBoundPrefix);
  const badgeCostText =
    ctx.lowerBoundPrefix !== "" && usage.billing !== "subscription"
      ? costText
      : null;

  if (usage.modelId) {
    // The design's badge shape is "model · effort · total time" — complete
    // token/cost values remain in the hover card; incomplete tokens and billed
    // costs repeat their lower-bound marker so it is visible before hover.
    return [
      label,
      ctx.modelName,
      ctx.effortDisplay ?? null,
      usage.latencyMs !== undefined ? formatLatency(usage.latencyMs) : null,
      ctx.lowerBoundPrefix !== "" ? totalTokensText : null,
      badgeCostText,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  }
  if (totalTokensText !== null || badgeCostText !== null) {
    // Older turns without model tracking degrade to a token/cost-only badge.
    return [label, totalTokensText, badgeCostText]
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

function unknownTokenSection(): UsageSection {
  return {
    header: "Tokens",
    rows: [
      { label: "Input", value: "—" },
      { label: "Output", value: "—" },
      { label: "of which reasoning", value: "—" },
    ],
  };
}

function buildInputTokenRows(usage: TurnUsage): Array<UsageRow> {
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
  if (usage.cacheWriteTokens !== undefined) {
    // A sibling subset row of Input, like "of which cached": the adapter's
    // input total already includes these tokens, so showing them as their own
    // row is the only way the largest line of a cached turn stays visible.
    rows.push({
      label: "of which cache write",
      value: fmtTokens(usage.cacheWriteTokens),
    });
  }
  return rows;
}

function buildTokenSection(usage: TurnUsage): UsageSection | null {
  const hasTokenCounts =
    usage.inputTokens !== undefined ||
    usage.cachedInputTokens !== undefined ||
    usage.cacheWriteTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.totalTokens !== undefined ||
    usage.reasoningTokens !== undefined;
  if (!hasTokenCounts) return unknownTokenSection();

  const rows = buildInputTokenRows(usage);
  if (usage.outputTokens !== undefined || usage.reasoningTokens !== undefined) {
    rows.push(
      {
        label: "Output",
        value:
          usage.outputTokens === undefined
            ? "—"
            : fmtTokens(usage.outputTokens),
      },
      {
        label: "of which reasoning",
        value:
          usage.reasoningTokens === undefined
            ? "—"
            : fmtTokens(usage.reasoningTokens),
      },
    );
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
  if (ctx.totalTokens !== undefined) {
    rows.push({
      label: "Total tokens",
      value: `${ctx.lowerBoundPrefix}${fmtTokens(ctx.totalTokens)}`,
    });
  }
  // Omitted entirely when cost is unknown (an unpriced model) — never a fake
  // "$0.00".
  if (usage.costUsd !== undefined && usage.costUsd !== null) {
    rows.push({
      label: usage.billing === "subscription" ? "Notional cost" : "Est. cost",
      value: formatDisplayCost(usage.costUsd, ctx.lowerBoundPrefix),
    });
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
): UsageLine | null {
  if (!usage) return null;

  const ctx = buildUsageDisplayContext(usage, models);
  const text = buildBadgeText(usage, usageStatusLabel(usage.status), ctx);
  if (text === null) return null;

  const sections = [
    buildPerformanceSection(usage),
    buildTokenSection(usage),
    buildCostSection(usage, ctx),
  ].filter((section): section is UsageSection => section !== null);

  if (usage.complete !== false) return { text, sections };
  return {
    text,
    sections,
    incompleteNotice: "Recorded usage may not cover all of this Run's spend",
  };
}

// Shared typography/spacing (matches the design's `.tel-badge`) — the
// negative left margin is an optical alignment trick so the badge's own
// padding doesn't visually indent past the message content's left edge.
// Every value is on the Tailwind scale (the design file's rem values snapped
// to the nearest quarter step).
const badgeTypographyClassName =
  "text-muted-foreground -ml-1.75 mt-1 inline-flex w-fit items-center gap-1.25 rounded-md px-1.75 py-0.75 font-mono text-xs";

/** One Performance/Tokens/Cost & model column of the hover card's breakdown. */
function UsageSectionColumn({ section }: { section: UsageSection }) {
  return (
    <div className="flex min-w-28 flex-col gap-1.25">
      <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {section.header}
      </div>
      {section.rows.map((row) => (
        <div
          key={row.label}
          className={cn(
            "flex items-center justify-between gap-4.5 text-xs",
            // Subset and qualifier rows sit beneath the row they qualify:
            // cached input and cache writes beneath Input, reasoning beneath
            // Output, effort beneath Model.
            (row.label === "of which cached" ||
              row.label === "of which cache write" ||
              row.label === "of which reasoning" ||
              row.label === "at effort") &&
              "pl-3.5",
          )}
        >
          <span className="text-muted-foreground">{row.label}</span>
          <b
            className={cn(
              "font-mono font-medium",
              row.label === "Notional cost"
                ? "text-muted-foreground line-through"
                : "text-foreground",
            )}
          >
            {row.value}
            {row.label === "Notional cost" ? (
              <span className="sr-only">, not billed</span>
            ) : null}
          </b>
        </div>
      ))}
    </div>
  );
}

/** The hover card's per-section columns, side by side on one row. */
function UsageBreakdown({ sections }: { sections: Array<UsageSection> }) {
  return (
    <div className="flex flex-nowrap gap-7.5">
      {sections.map((section) => (
        <UsageSectionColumn key={section.header} section={section} />
      ))}
    </div>
  );
}

function UsageTrigger({ text }: { text: string }) {
  // delay=0/closeDelay=0 (on the trigger, per Base UI): this is a
  // data-disclosure hover, not a "sneak peek" — reveal immediately,
  // matching the design's plain CSS `:hover` (no delay).
  return (
    <HoverCardTrigger
      delay={0}
      closeDelay={0}
      render={
        <button
          type="button"
          aria-label={`Message usage: ${text}`}
          className={cn(
            badgeTypographyClassName,
            "cursor-default transition-colors hover:bg-accent hover:text-foreground",
          )}
        />
      }
    >
      {text}
      <InfoIcon size={12} className="opacity-70" />
    </HoverCardTrigger>
  );
}

function UsageHoverContent({ line }: { line: UsageLine }) {
  // HoverCardContent already ships the popover-surfaced card treatment
  // DESIGN.md specifies for these overlays (bg-popover, border,
  // shadow-md, no arrow) — just widen it past the default w-64 for
  // this card's 3-column table layout. The primitive's own p-2.5 is
  // the padding; the column gap belongs on the plain row below it.
  return (
    <HoverCardContent side="top" align="start" className="w-fit max-w-none">
      <div className="flex flex-col gap-2.5">
        <UsageBreakdown sections={line.sections} />
        {line.incompleteNotice ? (
          <p className="text-xs text-muted-foreground">
            {line.incompleteNotice}
          </p>
        ) : null}
      </div>
    </HoverCardContent>
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
  // contributes at least a "Model" row, while token-only legacy and cost-only
  // incomplete badges carry their own breakdown rows for the hover card.
  if (!line) return null;

  return (
    <HoverCard>
      <UsageTrigger text={line.text} />
      <UsageHoverContent line={line} />
    </HoverCard>
  );
}
