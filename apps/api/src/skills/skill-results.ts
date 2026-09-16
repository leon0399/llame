/**
 * The response-time attribution and trust framing every `skill://` result
 * adds, in one place so the catalog listing and the resource reader cannot
 * drift apart on what the model is told.
 *
 * Operator skill packages are intentionally published: unlike Knowledge, the
 * real package and file paths are part of the model-facing contract, because a
 * skill's script and reference instructions are only usable once the agent can
 * construct absolute paths from them.
 */

import { measureNativeModelOutput } from '@workspace/native-file-tools';
import { RESULT_TRUNCATE_CHARS } from '@workspace/runtime-safety';

import { type SkillCatalogEntry } from './skill-catalog';
import {
  SKILL_PATH_INSTRUCTION,
  type ResolvedSkillTarget,
} from './skill-target';

/**
 * Entries one unpaged catalog listing returns. Larger requests use the native
 * line selector (`skill://:1-200`), exactly as a directory listing does.
 */
export const SKILL_CATALOG_PAGE_SIZE = 100;

/**
 * Hardest bound on the page the fitting search will consider. A minimal entry
 * serializes to about 80 characters against a 16,000-character result cap, so
 * at most ~200 entries can ever fit; this bound is comfortably above that and
 * exists only to keep one call's work independent of how large a catalog the
 * operator has installed.
 */
const MAX_CATALOG_SEARCH_ENTRIES = 500;

export function skillResultEnvelope(target: ResolvedSkillTarget) {
  return {
    locator: target.locator,
    sourceDirectory: target.sourceDirectory,
    resolvedPath: target.hostPath,
    skillDirectory: target.skillDirectory,
    ...(target.realSkillDirectory !== undefined &&
      target.realSkillDirectory !== target.skillDirectory && {
        realSkillDirectory: target.realSkillDirectory,
      }),
    skillPathInstruction: SKILL_PATH_INSTRUCTION,
  };
}

export type CatalogListing = {
  readonly status: 'success';
  readonly locator: 'skill://';
  readonly skillCount: number;
  readonly skills: ReadonlyArray<CatalogEntryProjection>;
  readonly skillPathInstruction: string;
  readonly nextOffset?: number;
};

type CatalogEntryProjection = {
  readonly name: string;
  readonly description: string | null;
  readonly proactive: boolean;
  readonly available: boolean;
  readonly diagnostics: ReadonlyArray<string>;
};

/**
 * The bounded catalog representation. `entries` are already selection-filtered
 * and name-ordered; this applies the requested window, then shrinks it until
 * the assembled result fits the shared tool-result cap.
 *
 * Fitting here rather than at the runner's generic truncation is what keeps
 * `nextOffset` honest: a later shrink would drop entries the listing had
 * already counted as shown, silently skipping them on the next page.
 */
export function skillCatalogEnvelope(
  entries: ReadonlyArray<SkillCatalogEntry>,
  window: { readonly offset: number; readonly limit?: number },
): CatalogListing {
  const requested = entries.slice(
    window.offset,
    window.offset +
      Math.min(
        window.limit ?? SKILL_CATALOG_PAGE_SIZE,
        MAX_CATALOG_SEARCH_ENTRIES,
      ),
  );
  const projections = requested.map(toProjection);

  // The window is model-reachable and a source may hold thousands of entries,
  // so the fitting search must not be linear per candidate: `fits` is
  // monotonic in the entry count, and a bisection finds the largest fitting
  // page in O(log n) probes instead of O(n).
  const shown = largestFittingCount(entries.length, window.offset, projections);

  const nextOffset = window.offset + shown;
  const listing: CatalogListing = {
    status: 'success',
    locator: 'skill://',
    skillCount: entries.length,
    skills: projections.slice(0, shown),
    skillPathInstruction: SKILL_PATH_INSTRUCTION,
  };
  // Absent rather than `undefined`, matching the native reader's own
  // `nextOffset` contract: present only when the listing continues.
  return nextOffset < entries.length ? { ...listing, nextOffset } : listing;
}

/**
 * The largest count of leading projections whose listing fits the shared cap.
 * Zero is always a candidate: the envelope alone is far inside the cap, so the
 * bisection never falls off the low end.
 */
function largestFittingCount(
  total: number,
  offset: number,
  projections: ReadonlyArray<CatalogEntryProjection>,
): number {
  let low = 0;
  let high = projections.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(total, offset, projections, middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/** Whether a listing of `shown` entries, with a continuation when one is
 *  needed, stays inside the shared cap. */
function fits(
  total: number,
  offset: number,
  projections: ReadonlyArray<CatalogEntryProjection>,
  shown: number,
): boolean {
  const listing: CatalogListing = {
    status: 'success',
    locator: 'skill://',
    skillCount: total,
    skills: projections.slice(0, shown),
    skillPathInstruction: SKILL_PATH_INSTRUCTION,
    ...(offset + shown < total && { nextOffset: offset + shown }),
  };
  return measureNativeModelOutput(listing) <= RESULT_TRUNCATE_CHARS;
}

function toProjection(entry: SkillCatalogEntry): CatalogEntryProjection {
  return {
    name: entry.name,
    description: entry.description,
    proactive: entry.proactive,
    available: entry.available,
    diagnostics: [...entry.diagnostics],
  };
}
