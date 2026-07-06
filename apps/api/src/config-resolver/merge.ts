/**
 * Layered config merge with provenance (#46, SPEC §6.3).
 *
 * Layers arrive in inheritance order (instance → org path root-first → user →
 * chat); later layers win. Merge semantics for the setting classes that exist
 * today (scalars and nested objects): objects merge key-by-key, everything
 * else — scalars and arrays — is replaced whole by the later layer. Arrays
 * deliberately do NOT concat (unlike opencode/claude-code, which dedupe-concat
 * by default): additive arrays are exactly how a lower scope could smuggle a
 * capability past a higher one, so replacement is the fail-closed default.
 * The SPEC §6.3 array strategies (additive_with_deny, override_by_id,
 * most_restrictive) land WITH their setting classes (MCP servers v0.7,
 * providers v0.4, …) — encoding them now would be dead code with no consumer
 * to prove them against.
 *
 * Provenance records, per leaf path, which scope supplied the winning value
 * and at what version — the raw material for the explain endpoint and the
 * run snapshot's auditability (SPEC §6.4).
 */

export type ConfigScopeRef = {
  scopeType: 'instance' | 'org_unit' | 'user' | 'chat';
  /** Null for the instance layer (it has no row — env-derived). */
  scopeId: string | null;
  /** Row version for table-backed scopes; 0 for the env-derived instance layer. */
  version: number;
};

export type ConfigLayer = {
  scope: ConfigScopeRef;
  config: Record<string, unknown>;
};

/** Dot-joined leaf path → the scope that set the winning value. */
export type ConfigProvenance = Record<string, ConfigScopeRef>;

export type ResolvedConfig = {
  effective: Record<string, unknown>;
  provenance: ConfigProvenance;
  /**
   * The ordered layer chain the resolution consumed (scope + version each) —
   * SPEC §6.4's `config_version_ids`. Includes layers that set nothing, so a
   * snapshot also proves which scopes were CONSULTED, not just which won.
   */
  layers: ConfigScopeRef[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  // Object.prototype.toString is realm-independent — a constructor identity
  // check (proto.constructor === Object) breaks under jest's VM sandbox,
  // where structuredClone returns host-realm objects.
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

function mergeInto(
  target: Record<string, unknown>,
  layer: Record<string, unknown>,
  scope: ConfigScopeRef,
  provenance: ConfigProvenance,
  prefix: string,
): void {
  for (const [key, value] of Object.entries(layer)) {
    if (value === undefined) {
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    const existing = target[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      mergeInto(existing, value, scope, provenance, path);
      continue;
    }
    if (isPlainObject(value)) {
      // A subtree replacing a scalar/array/null: the replaced value's own
      // provenance entry (recorded at exactly `path`) is now stale — `path`
      // becomes a parent, not a leaf, so a lingering provenance[path] would
      // wrongly claim a scope "set" a non-leaf path.
      delete provenance[path];
      const fresh: Record<string, unknown> = {};
      target[key] = fresh;
      mergeInto(fresh, value, scope, provenance, path);
      continue;
    }
    // Scalar / array / null: later layer replaces whole. A replaced subtree's
    // stale leaf provenance is dropped so the map never claims paths that no
    // longer exist in the effective config.
    if (isPlainObject(existing)) {
      for (const stale of Object.keys(provenance)) {
        if (stale === path || stale.startsWith(`${path}.`)) {
          delete provenance[stale];
        }
      }
    }
    target[key] = value;
    provenance[path] = scope;
  }
}

/** Merge layers in order; later layers win. Inputs are not mutated. */
export function resolveLayers(layers: ConfigLayer[]): ResolvedConfig {
  const effective: Record<string, unknown> = {};
  const provenance: ConfigProvenance = {};
  for (const layer of layers) {
    mergeInto(
      effective,
      structuredClone(layer.config),
      layer.scope,
      provenance,
      '',
    );
  }
  return { effective, provenance, layers: layers.map((l) => l.scope) };
}
