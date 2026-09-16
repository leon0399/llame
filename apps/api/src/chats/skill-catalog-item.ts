/**
 * The `skill-catalog` producer (system-provided-skills D6).
 *
 * Two forms, mirroring the recency digest's:
 *
 * - `notice`: the added/removed delta since the chat was last told.
 * - `snapshot`: a bounded statement of the current advertised set that
 *   SUPERSEDES earlier catalog items, used when a delta cannot be rendered
 *   within the bound. Its form is the whole marker — a `snapshot` already means
 *   "a later one from this producer replaces earlier ones", so it needs no
 *   marker shape of its own.
 *
 * Descriptions are operator-authored, so they are neutralized here with the
 * same sanitizer the prompt and activation use; a description therefore cannot
 * close an element or forge an envelope.
 */

import { z } from 'zod';

import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';

import { createRenderedContextItem } from './context-item-shared';
import { type AuthoredContextItemPart } from './context-item';

/** One advertised entry: a name and the description it currently carries. */
const entrySchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
});

/**
 * The delta payload. `z.strictObject` is what makes this an exact-key-set
 * check: a future edit that widens a payload fails here rather than at replay,
 * which is the same posture `isExactRecord` gives the other producers.
 */
const noticePayloadSchema = z.strictObject({
  kind: z.literal('delta'),
  added: z.array(entrySchema),
  removed: z.array(z.string().min(1)),
});

/** The bounded current set that supersedes earlier catalog items. */
const snapshotPayloadSchema = z.strictObject({
  kind: z.literal('snapshot'),
  skills: z.array(entrySchema),
  omitted: z.number().int().min(0),
});

export type SkillCatalogNoticePayload = z.infer<typeof noticePayloadSchema>;
export type SkillCatalogSnapshotPayload = z.infer<typeof snapshotPayloadSchema>;

/** The added/removed delta. At least one side is non-empty by construction. */
export function createSkillCatalogNoticeItem(input: {
  readonly runId: string;
  readonly payload: SkillCatalogNoticePayload;
}): AuthoredContextItemPart {
  noticePayloadSchema.parse(input.payload);
  return createRenderedContextItem({
    producer: 'skill-catalog',
    form: 'notice',
    runId: input.runId,
    payload: input.payload,
    body: renderDelta(input.payload),
  });
}

/**
 * The bounded current set, replacing earlier catalog items in this
 * conversation. Carries the omitted count so the model knows the list is
 * partial rather than complete.
 */
export function createSkillCatalogSnapshotItem(input: {
  readonly runId: string;
  readonly payload: SkillCatalogSnapshotPayload;
}): AuthoredContextItemPart {
  snapshotPayloadSchema.parse(input.payload);
  return createRenderedContextItem({
    producer: 'skill-catalog',
    form: 'snapshot',
    runId: input.runId,
    payload: input.payload,
    body: renderSnapshot(input.payload),
  });
}

/**
 * The delta body. The precedence line is template text gated on the added
 * side — a removals-only delta carries no operator text, so the disclaimer
 * would disclaim nothing.
 */
const renderCatalogNoticeTemplate = loadPackagedTemplate<{
  readonly hasAdded: boolean;
  readonly hasRemoved: boolean;
  readonly added: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
  }>;
  readonly removed: ReadonlyArray<string>;
}>(__dirname, 'skill-catalog-notice');

function renderDelta(payload: SkillCatalogNoticePayload): string {
  return renderCatalogNoticeTemplate({
    hasAdded: payload.added.length > 0,
    hasRemoved: payload.removed.length > 0,
    added: payload.added.map((entry) => ({
      name: entry.name,
      description: sanitizeAuthoredText(entry.description),
    })),
    removed: payload.removed,
  });
}

/**
 * The snapshot body. An empty catalog says so in the template's `{{else}}`
 * branch — "Current skills:" followed by nothing is indistinguishable from a
 * truncated render — and that branch carries no precedence line, which would
 * disclaim content that is not there.
 */
const renderCatalogSnapshotTemplate = loadPackagedTemplate<{
  readonly hasEntries: boolean;
  readonly entries: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
  }>;
  readonly hasOmitted: boolean;
  readonly remainder: string;
}>(__dirname, 'skill-catalog-snapshot');

function renderSnapshot(payload: SkillCatalogSnapshotPayload): string {
  return renderCatalogSnapshotTemplate({
    hasEntries: payload.skills.length > 0,
    entries: payload.skills.map((entry) => ({
      name: entry.name,
      description: sanitizeAuthoredText(entry.description),
    })),
    // `omitted` is a number: zero must gate explicitly rather than riding
    // Handlebars truthiness.
    hasOmitted: payload.omitted > 0,
    remainder:
      payload.omitted === 1
        ? '1 more skill is available'
        : `${payload.omitted} more skills are available`,
  });
}
