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

export function skillResultEnvelope(target: ResolvedSkillTarget) {
  return {
    locator: target.locator,
    sourceDirectory: target.sourceDirectory,
    resolvedPath: target.hostPath,
    skillDirectory: target.skillDirectory,
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
    window.offset + (window.limit ?? SKILL_CATALOG_PAGE_SIZE),
  );
  const projections = requested.map(toProjection);

  let skillCount = 0;
  for (let candidate = projections.length; candidate >= 0; candidate -= 1) {
    if (fits(entries.length, window.offset, projections, candidate)) {
      skillCount = candidate;
      break;
    }
  }

  const nextOffset = window.offset + skillCount;
  const listing: CatalogListing = {
    status: 'success',
    locator: 'skill://',
    skillCount: entries.length,
    skills: projections.slice(0, skillCount),
    skillPathInstruction: SKILL_PATH_INSTRUCTION,
  };
  // Absent rather than `undefined`, matching the native reader's own
  // `nextOffset` contract: present only when the listing continues.
  return nextOffset < entries.length ? { ...listing, nextOffset } : listing;
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
