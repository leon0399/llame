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

/**
 * Effective config → the model visibility allowlist (#85), if any. Accepted ONLY
 * as a NON-EMPTY array of non-empty strings; anything else → undefined (no
 * restriction). The asymmetry is deliberate: a set allowlist is fail-CLOSED (the
 * list strictly limits), but an absent/malformed one is fail-OPEN (never hide a
 * user's models on a bad config).
 */
export function snapshotModelAllowlist(
  snapshot: unknown,
): string[] | undefined {
  const raw = section(snapshot, 'models')?.allowlist;
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const ids = raw.filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  return ids.length > 0 ? ids : undefined;
}

/**
 * Clamp a resolved snapshot's model allowlist so it can never exceed the
 * operator's INSTANCE-layer allowlist (#85 security hardening). `resolveLayers`
 * merges arrays whole — later (more-specific) scopes replace, they don't
 * intersect — so a user/org/chat-scope config that also sets `models.allowlist`
 * would otherwise silently REPLACE the operator's restriction, letting a
 * lower-scope write WIDEN visibility past what the instance permits. A
 * lower scope may still narrow the operator's list further; it can never
 * exceed it. No-op when the operator (instance layer) set no restriction —
 * there is nothing to act as a ceiling.
 *
 * A fully-disjoint lower-scope list (zero overlap with the ceiling) falls back
 * to the ceiling itself rather than an empty array: `snapshotModelAllowlist`
 * treats an empty array as "no restriction" (fail-OPEN, by design, for the
 * blank-env-var case) — returning one here would let a broken lower-scope
 * config accidentally unlock every model. Falling back to the ceiling keeps
 * the result always a subset of what the operator permits.
 */
export function clampModelAllowlistToInstanceCeiling(
  snapshot: RunConfigSnapshot,
  instanceConfig: EffectiveConfig,
): RunConfigSnapshot {
  const ceiling = snapshotModelAllowlist({ effective: instanceConfig });
  if (!ceiling) {
    return snapshot;
  }
  const merged = snapshotModelAllowlist(snapshot) ?? ceiling;
  const clamped = merged.filter((id) => ceiling.includes(id));
  return {
    ...snapshot,
    effective: {
      ...snapshot.effective,
      models: { allowlist: clamped.length > 0 ? clamped : ceiling },
    },
  };
}
