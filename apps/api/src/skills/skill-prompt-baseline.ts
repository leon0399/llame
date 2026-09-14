/**
 * The frozen skill-catalog baseline (system-provided-skills D4).
 *
 * The proactively eligible catalog changes more often than compaction, so it is
 * frozen per compaction epoch the way the recency digest is: resolved once,
 * stored on the chat row, and re-resolved at the next accepted turn after a new
 * compaction. Everything here is pure — the caller owns the transaction.
 */

import {
  compareSkillNames,
  type SkillCatalogPort,
  type SkillCatalogEntry,
} from './skill-catalog';
import {
  type SkillCatalogBaseline,
  type SkillCatalogBaselineEntry,
} from '../db/schema/chats';

/**
 * Most entries one baseline admits. Paired with the byte bound because the
 * TEMPLATE owns per-entry markup: a byte bound on names and descriptions alone
 * would let thousands of one-character entries render many times its size,
 * while the count cap fixes that multiplier.
 */
export const SKILL_BASELINE_MAX_ENTRIES = 256;

/** Cumulative UTF-8 bytes of admitted names and descriptions. */
export const SKILL_BASELINE_MAX_BYTES = 16 * 1024;

/**
 * The advertised set: a package is eligible when its invocation control permits
 * proactive use AND it is currently readable. An invalid package has no
 * instructions to advertise, and counting one as eligible-but-omitted would make
 * the `skills.omitted` line claim that unreadable skills are "available".
 *
 * `undefined` means discovery itself could not run — an unreadable, missing, or
 * oversized source. That is NOT the same as an empty catalog, and the caller
 * must not freeze it: freezing would bind an empty advertisement to the chat for
 * the whole compaction epoch and never self-heal, turning a transient `readdir`
 * failure into a silently absent skill section.
 */
export function proactivelyEligible(
  catalog: SkillCatalogPort,
): ReadonlyArray<SkillCatalogEntry> | undefined {
  const snapshot = catalog.getSnapshot();
  if (!snapshot.available) return undefined;
  return snapshot.entries.filter((entry) => entry.proactive && entry.available);
}

/**
 * Apply the admission bound: admit entries in code-point name order, retaining
 * only whole entries, while the count and the cumulative byte length stay
 * within their caps. `omitted` counts the eligible entries the caps left out.
 *
 * Entries arrive name-ordered from the catalog, but the order is re-established
 * here so the bound is defined by this function rather than by a property of
 * its input.
 */
export function boundSkillCatalog(
  eligible: ReadonlyArray<SkillCatalogEntry>,
): SkillCatalogBaseline {
  const ordered = [...eligible].sort((left, right) =>
    compareSkillNames(left.name, right.name),
  );
  const entries: Array<SkillCatalogBaselineEntry> = [];
  let bytes = 0;
  for (const entry of ordered) {
    if (entries.length >= SKILL_BASELINE_MAX_ENTRIES) break;
    const description = entry.description ?? '';
    const entryBytes =
      Buffer.byteLength(entry.name, 'utf8') +
      Buffer.byteLength(description, 'utf8');
    if (bytes + entryBytes > SKILL_BASELINE_MAX_BYTES) break;
    bytes += entryBytes;
    entries.push({ name: entry.name, description });
  }
  return { entries, omitted: ordered.length - entries.length };
}

/**
 * Resolve the current catalog into a fresh baseline, or `undefined` when
 * discovery could not run. A caller that sees `undefined` must leave the chat's
 * existing state alone and retry on the next turn rather than freezing an
 * outage into the prompt.
 */
export function resolveSkillCatalogBaseline(
  catalog: SkillCatalogPort,
): SkillCatalogBaseline | undefined {
  const eligible = proactivelyEligible(catalog);
  return eligible === undefined ? undefined : boundSkillCatalog(eligible);
}

/**
 * Whether a stored baseline still belongs to `latestCompactionId`. A chat that
 * has never been compacted pairs `null` with `null`, so its first baseline is
 * reused until the first compaction starts a new epoch.
 */
export function baselineMatchesEpoch(
  baseline: SkillCatalogBaseline | null,
  rebakedFrom: string | null,
  latestCompactionId: string | null,
): boolean {
  return baseline !== null && rebakedFrom === latestCompactionId;
}
