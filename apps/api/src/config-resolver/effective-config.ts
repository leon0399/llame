import type { ConfigProvenance, ConfigScopeRef } from './merge';

/**
 * The consumed slice of effective config (#46). Unknown keys flow through the
 * resolver untouched (forward compatibility); these readers narrow only what
 * the platform actually consumes today:
 *  - `run.maxOutputTokens` — the per-run output-token budget cap (#91)
 *  - `run.maxRunTokens` — the per-run CUMULATIVE token cap across tool-loop steps (#91)
 *  - `run.maxSteps` — the tool-loop's hard step cap
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

/** runs.config_snapshot → the per-run tool-loop step cap, if any. */
export function snapshotMaxSteps(snapshot: unknown): number | undefined {
  return positiveInt(section(snapshot, 'run')?.maxSteps);
}

/**
 * runs.config_snapshot → the CUMULATIVE total-token cap across the tool
 * loop's steps, if any (#91). Opt-in; bounds the run's real spend since each
 * step re-sends the growing context, so `maxSteps × maxOutputTokens` badly
 * under-counts it.
 */
export function snapshotMaxRunTokens(snapshot: unknown): number | undefined {
  return positiveInt(section(snapshot, 'run')?.maxRunTokens);
}
