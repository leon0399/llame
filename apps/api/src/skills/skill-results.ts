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

/**
 * The bounded catalog representation. `entries` are already selection-filtered
 * and name-ordered; this applies the requested window and discloses what
 * remains rather than truncating silently.
 */
export function skillCatalogEnvelope(
  entries: ReadonlyArray<SkillCatalogEntry>,
  window: { readonly offset: number; readonly limit?: number },
) {
  const limit = window.limit ?? SKILL_CATALOG_PAGE_SIZE;
  const shown = entries.slice(window.offset, window.offset + limit);
  const nextOffset = window.offset + shown.length;
  const listing = {
    locator: 'skill://',
    skillCount: entries.length,
    skills: shown.map((entry) => ({
      name: entry.name,
      description: entry.description,
      proactive: entry.proactive,
      available: entry.available,
      diagnostics: [...entry.diagnostics],
    })),
    skillPathInstruction: SKILL_PATH_INSTRUCTION,
  };
  // Absent rather than `undefined`, matching the native reader's own
  // `nextOffset` contract: present only when the listing continues.
  return nextOffset < entries.length ? { ...listing, nextOffset } : listing;
}
