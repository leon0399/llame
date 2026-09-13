/**
 * Catalog notices for added and removed skills (system-provided-skills D6).
 *
 * The advertised set is a complete statement of current state, so the notice
 * rail carries only its DELTA against what the chat was last told. Everything
 * here is pure: the caller owns the transaction and the persisted told state.
 */

import {
  SKILL_BASELINE_MAX_BYTES,
  SKILL_BASELINE_MAX_ENTRIES,
} from './skill-prompt-baseline';
import {
  type SkillCatalogBaseline,
  type SkillCatalogBaselineEntry,
} from '../db/schema/chats';

export type SkillCatalogDelta = {
  /** Entries added since the told state, with their CURRENT descriptions. */
  readonly added: ReadonlyArray<SkillCatalogBaselineEntry>;
  /** Names removed since the told state, names only. */
  readonly removed: ReadonlyArray<string>;
  /** The told state after this notice. */
  readonly told: ReadonlyArray<string>;
};

/**
 * The added/removed delta against the told state, by NAME only.
 *
 * Membership is the whole comparison: a description or instruction-content
 * change of a still-advertised entry produces no notice in this change, because
 * the told state stores names and an addition renders whatever description the
 * entry has now. Reads are live, so the next `skill://` load returns current
 * content regardless.
 */
export function deriveSkillCatalogDelta(input: {
  readonly advertised: ReadonlyArray<SkillCatalogBaselineEntry>;
  readonly told: ReadonlyArray<string>;
}): SkillCatalogDelta | null {
  const toldNames = new Set(input.told);
  const advertisedNames = new Set(input.advertised.map((entry) => entry.name));
  const added = input.advertised.filter((entry) => !toldNames.has(entry.name));
  const removed = input.told.filter((name) => !advertisedNames.has(name));
  if (added.length === 0 && removed.length === 0) return null;
  return {
    added,
    removed,
    told: input.advertised.map((entry) => entry.name),
  };
}

/**
 * Whether a delta can be rendered within the baseline bound.
 *
 * The bound is the same whole-entry, count-and-byte rule the prompt uses, for
 * the same reason: the template owns per-entry markup, so a byte bound on
 * content alone would let many tiny entries render far past it. A delta that
 * cannot fit is replaced by a supersession snapshot rather than silently
 * truncated — a partial list of removals would leave the model applying skills
 * the notice did not mention dropping.
 */
export function skillCatalogDeltaFits(delta: SkillCatalogDelta): boolean {
  if (delta.added.length + delta.removed.length > SKILL_BASELINE_MAX_ENTRIES) {
    return false;
  }
  const bytes = [
    ...delta.added,
    ...delta.removed.map((name) => ({ name, description: '' })),
  ].reduce(
    (total, entry) =>
      total +
      Buffer.byteLength(entry.name, 'utf8') +
      Buffer.byteLength(entry.description, 'utf8'),
    0,
  );
  return bytes <= SKILL_BASELINE_MAX_BYTES;
}

/** The told state a fresh baseline establishes: its admitted names, in order. */
export function toldFromBaseline(
  baseline: SkillCatalogBaseline,
): ReadonlyArray<string> {
  return baseline.entries.map((entry) => entry.name);
}
