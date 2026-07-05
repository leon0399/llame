"use client";

/**
 * Per-turn usage/cost for an assistant message — a discreet footer showing
 * total tokens, cost (when known), and latency, with the full token breakdown
 * on hover. The data is the persisted turn telemetry, carried on
 * `message.metadata.usage` both live (a run-bridge message-metadata chunk) and
 * from history. BYOK cost transparency (#91/telemetry).
 */

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

function formatCost(costUsd: number): string {
  // Sub-cent turns are common with cheap models — show enough precision. The
  // leading "~" signals an ESTIMATE: costUsd comes from a small built-in price
  // map keyed by model id, not the user's actual BYOK billing.
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

export function MessageUsage({ metadata }: { metadata: unknown }) {
  const usage = parseTurnUsage(metadata);
  // Only render when there is real token data (legacy rows carry only status).
  if (!usage || usage.totalTokens === undefined || usage.totalTokens === 0) {
    return null;
  }

  const parts: string[] = [];
  const label = usageStatusLabel(usage.status);
  if (label) parts.push(label);
  parts.push(`${nf.format(usage.totalTokens)} tokens`);
  if (usage.costUsd !== undefined && usage.costUsd !== null) {
    parts.push(formatCost(usage.costUsd));
  }
  if (usage.latencyMs !== undefined) {
    parts.push(formatLatency(usage.latencyMs));
  }

  const breakdown = [
    usage.inputTokens !== undefined
      ? `${nf.format(usage.inputTokens)} in`
      : null,
    usage.cachedInputTokens
      ? `${nf.format(usage.cachedInputTokens)} cached`
      : null,
    usage.outputTokens !== undefined
      ? `${nf.format(usage.outputTokens)} out`
      : null,
    usage.reasoningTokens
      ? `${nf.format(usage.reasoningTokens)} reasoning`
      : null,
    usage.model ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <p
      className="text-muted-foreground mt-1 text-xs tabular-nums"
      title={breakdown}
    >
      {parts.join(" · ")}
    </p>
  );
}
