import type { ConfigProvenance, ConfigScopeRef } from './merge';

/**
 * The consumed slice of effective config (#46). Unknown keys flow through the
 * resolver untouched (forward compatibility); these readers narrow only what
 * the platform actually consumes today:
 *  - `run.maxOutputTokens` — the per-run budget cap (#91)
 *  - `compaction.tokenThreshold` — when a chat compacts (#57)
 */
export type EffectiveConfig = Record<string, unknown>;

/** The durable shape stored in runs.config_snapshot (SPEC §6.4). */
export type RunConfigSnapshot = {
  effective: EffectiveConfig;
  provenance: ConfigProvenance;
  layers: ConfigScopeRef[];
  computedAt: string;
};

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function section(
  snapshot: unknown,
  name: string,
): Record<string, unknown> | undefined {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return undefined;
  }
  const effective = (snapshot as { effective?: unknown }).effective;
  if (typeof effective !== 'object' || effective === null) {
    return undefined;
  }
  const value = (effective as Record<string, unknown>)[name];
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** runs.config_snapshot → the run's output-token cap, if any. */
export function snapshotMaxOutputTokens(snapshot: unknown): number | undefined {
  return positiveInt(section(snapshot, 'run')?.maxOutputTokens);
}

/** runs.config_snapshot → the compaction threshold override, if any. */
export function snapshotCompactionThreshold(
  snapshot: unknown,
): number | undefined {
  return positiveInt(section(snapshot, 'compaction')?.tokenThreshold);
}

/** runs.config_snapshot → the per-run tool-loop step cap, if any (#91 step budget). */
export function snapshotMaxSteps(snapshot: unknown): number | undefined {
  return positiveInt(section(snapshot, 'run')?.maxSteps);
}

/** Hard cap on custom-instruction length — it rides every completion's system
 *  prompt (cost/context budget). Enforced at write (DTO) AND read (below). */
export const INSTRUCTIONS_MAX = 4000;

/**
 * runs.config_snapshot → the user's resolved custom instructions, if any.
 * Trimmed and truncated to INSTRUCTIONS_MAX (defense-in-depth — a stale/oversized
 * row can never blow the budget regardless of the write-time cap).
 */
export function snapshotInstructions(snapshot: unknown): string | undefined {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return undefined;
  }
  const effective = (snapshot as { effective?: unknown }).effective;
  if (typeof effective !== 'object' || effective === null) {
    return undefined;
  }
  const value = (effective as Record<string, unknown>).instructions;
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.slice(0, INSTRUCTIONS_MAX);
}
