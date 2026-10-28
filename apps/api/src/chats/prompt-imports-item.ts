/**
 * The `prompt-imports` producer (prompt-imports D6-D7).
 *
 * One item carries every outcome from the bounded prompt-import pass. Read
 * bodies are model-facing data and are neutralized before they enter a file
 * element; the payload deliberately records metadata only. Images record a
 * stored locator or dimensions with a display-only thumbnail; PDFs record
 * pages, byte size, and an optional stored locator. Request assembly attaches
 * the media after the item's text, without persisting bytes in the item.
 */

import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { z } from 'zod';

import { userImagePart, type MediaRef } from '../media/epoch-admission';
import {
  boundRetained,
  retainedEntry,
  type RetainedMedia,
  type RetainedSettlement,
  type UnstoredMedia,
} from '../media/attempt-media';
import {
  type RetainedMediaJson,
  retainedImageRecordSchema,
  retainedPdfRecordSchema,
} from '../media/retained-media';
import {
  isThumbnailDataUrl,
  ORIGINAL_MEDIA_TYPES,
} from '../media/media-ingest';
import {
  MEDIA_LOCATOR_PATTERN,
  parseMediaLocator,
} from '../media/media-locator';

import {
  escapeXmlAttribute,
  type AuthoredContextItemPart,
  type ContextItemPart,
} from './context-item';
import {
  createRenderedContextItem,
  isExactRecord,
  isNonEmptyString,
} from './context-item-shared';
import type { ImagePart } from 'ai';

const PROMPT_IMPORT_OUTCOMES = ['imported', 'denied', 'failed'] as const;

/** The private attachment metadata of a native image or PDF read. */
export type PromptImportMedia = z.infer<typeof promptImportMediaSchema>;

/** One bounded prompt marker and the result of its admission/read attempt. */
export type PromptImportOutcome = {
  readonly locator: string;
  readonly resolved?: string;
} & (
  | {
      readonly outcome: 'imported';
      readonly body: string;
      readonly truncated?: boolean;
      readonly attachment?: PromptImportMedia;
    }
  | { readonly outcome: 'denied' | 'failed' }
);

export type PromptImportsPayloadEntry = z.infer<typeof payloadEntrySchema>;

/** Private metadata retained for owner disclosure and accepted-turn triggers. */
export interface PromptImportsPayload extends UnknownRecord {
  readonly imports: ReadonlyArray<PromptImportsPayloadEntry>;
  readonly omitted?: ReadonlyArray<string>;
}

const storedImageFields = { media: z.string().regex(MEDIA_LOCATOR_PATTERN) };
const unstoredImageFields = {
  thumbnail: z.string().refine(isThumbnailDataUrl).exactOptional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mediaType: z.enum(ORIGINAL_MEDIA_TYPES),
};
const pdfFields = {
  kind: z.literal('pdf'),
  mediaType: z.literal('application/pdf'),
  pages: z.number().int().min(1).max(100),
  byteSize: z.number().int().positive(),
  media: storedImageFields.media.exactOptional(),
};
const promptImportPdfSchema = z.strictObject(pdfFields);

const promptImportMediaSchema = z.union([
  z.strictObject(storedImageFields),
  z.strictObject(unstoredImageFields),
  promptImportPdfSchema,
]);

const entryFields = {
  locator: z.string().refine(isNonEmptyString),
  resolved: z.string().refine(isNonEmptyString).exactOptional(),
};
const textEntryFields = {
  ...entryFields,
  truncated: z.boolean().exactOptional(),
};

/**
 * A PDF entry names the store or keeps the original's bytes, never both, and
 * carries no image field.
 */
const payloadPdfEntrySchema = z
  .strictObject({
    ...entryFields,
    outcome: z.literal('imported'),
    ...pdfFields,
    retainedMedia: retainedPdfRecordSchema.exactOptional(),
  })
  .refine(
    (entry) =>
      !(entry.media !== undefined && entry.retainedMedia !== undefined),
  );

/** Exact persisted text, image, and PDF entry forms. */
const payloadEntrySchema = z.union([
  z.strictObject({
    ...textEntryFields,
    outcome: z.enum(PROMPT_IMPORT_OUTCOMES),
  }),
  z.strictObject({
    ...textEntryFields,
    outcome: z.literal('imported'),
    ...storedImageFields,
  }),
  z.strictObject({
    ...textEntryFields,
    outcome: z.literal('imported'),
    ...unstoredImageFields,
    retainedMedia: retainedImageRecordSchema.exactOptional(),
  }),
  payloadPdfEntrySchema,
]);

/** Projects native read metadata without copying binary or source fields. */
export function promptImportMedia(
  result: UnknownRecord,
): PromptImportMedia | undefined {
  const { kind, media, mediaType, pages, byteSize, thumbnail, width, height } =
    result;
  if (kind === 'pdf') {
    return promptImportPdfSchema.safeParse({
      kind,
      mediaType,
      pages,
      byteSize,
      ...(media !== undefined && { media }),
    }).data;
  }
  if (kind !== 'image') return undefined;
  const image = isString(media)
    ? { media }
    : {
        ...(thumbnail !== undefined && { thumbnail }),
        width,
        height,
        mediaType,
      };
  return promptImportMediaSchema.safeParse(image).data;
}

function isPromptImportsPayloadEntry(
  value: unknown,
): value is PromptImportsPayloadEntry {
  return payloadEntrySchema.safeParse(value).success;
}

/** Validates the exact metadata shape persisted with a prompt-import item. */
export function isPromptImportsPayload(
  value: PromptImportsPayload,
): value is PromptImportsPayload;
export function isPromptImportsPayload(
  value: unknown,
): value is PromptImportsPayload;
export function isPromptImportsPayload(
  value: unknown,
): value is PromptImportsPayload {
  const hasOmitted = isRecord(value) && Object.hasOwn(value, 'omitted');
  if (!isExactRecord(value, ['imports', ...(hasOmitted ? ['omitted'] : [])])) {
    return false;
  }
  const imports = value['imports'];
  const omitted = value['omitted'];
  const hasNonEmptyOmitted =
    Array.isArray(omitted) &&
    omitted.length > 0 &&
    omitted.every(isNonEmptyString);
  return (
    Array.isArray(imports) &&
    imports.every(isPromptImportsPayloadEntry) &&
    (!hasOmitted || hasNonEmptyOmitted) &&
    (imports.length > 0 || hasNonEmptyOmitted)
  );
}

function toPayloadEntry(
  outcome: PromptImportOutcome,
  retainedMedia: RetainedMediaJson | undefined,
): PromptImportsPayloadEntry {
  return {
    locator: outcome.locator,
    ...(outcome.resolved !== undefined && { resolved: outcome.resolved }),
    outcome: outcome.outcome,
    ...(outcome.outcome === 'imported' &&
      outcome.truncated !== undefined && { truncated: outcome.truncated }),
    ...(outcome.outcome === 'imported' && outcome.attachment),
    ...(retainedMedia !== undefined && { retainedMedia }),
  };
}

/**
 * The retained record an unstored import entry keeps, under the item's own
 * bound: the entries share one stored message, so their bytes are summed in
 * entry order and an entry past the bound records `{ exceeded: true }` and
 * keeps none. A stored locator names the store, and an entry without a kept
 * entry has no bytes, so neither takes a record.
 */
function importRetainedMedia(
  importStep: {
    readonly runId: string;
    readonly retained: ReadonlyMap<string, RetainedMedia>;
  },
  outcome: PromptImportOutcome,
  used: number,
): RetainedSettlement {
  if (outcome.outcome !== 'imported') return { used };
  const { attachment } = outcome;
  if (attachment === undefined || 'media' in attachment) return { used };
  const entry = importStep.retained.get(
    promptImportMediaKey(importStep.runId, outcome.locator),
  );
  return entry === undefined ? { used } : boundRetained(entry, used);
}

/**
 * The marker key of an unstored import: the importing Run and its entry's
 * locator, which is unique among the item's entries. No tool call id has this
 * form.
 */
export function promptImportMediaKey(runId: string, locator: string): string {
  return `prompt-import:${runId}:${locator}`;
}

/** The reference markers of one item, with the entry each one names. */
type PromptImportMediaParts = {
  readonly parts: Array<ImagePart>;
  readonly retainedMedia: ReadonlyMap<string, RetainedMedia>;
};

/**
 * Reference markers in entry order, retaining a PDF's media type even if its
 * stored descriptor disappears, with the entry each marker names; none for
 * another producer or invalid payload, and none for an entry without a locator
 * or retained bytes — such an entry replays as the item's text alone.
 */
export function promptImportMediaParts(
  part: ContextItemPart,
): PromptImportMediaParts {
  const { producer, payload, runId } = part.data;
  if (producer !== 'prompt-imports' || !isPromptImportsPayload(payload)) {
    return { parts: [], retainedMedia: new Map() };
  }
  const parts: Array<ImagePart> = [];
  const retainedMedia = new Map<string, RetainedMedia>();
  for (const entry of payload.imports) {
    const ref =
      'media' in entry && entry.media !== undefined
        ? parseMediaLocator(entry.media)
        : unstoredEntryRef(entry, runId, retainedMedia);
    if (ref === undefined) continue;
    const marker = userImagePart(ref);
    if ('kind' in entry) marker.mediaType = entry.mediaType;
    parts.push(marker);
  }
  return { parts, retainedMedia };
}

/**
 * How many media markers `part` names, without building them: one per import
 * entry that names a stored locator or keeps retained bytes. The request's
 * reference counts read this instead of the markers themselves.
 */
export function promptImportMarkerCount(part: ContextItemPart): number {
  const { producer, payload } = part.data;
  if (producer !== 'prompt-imports' || !isPromptImportsPayload(payload)) {
    return 0;
  }
  return payload.imports.filter(
    (entry) =>
      ('media' in entry && entry.media !== undefined) ||
      'retainedMedia' in entry,
  ).length;
}

/**
 * The marker reference an unstored entry names, adding its retained entry to
 * `retainedMedia`; undefined for an entry whose record names no bytes.
 */
function unstoredEntryRef(
  entry: PromptImportsPayloadEntry,
  runId: string,
  retainedMedia: Map<string, RetainedMedia>,
): MediaRef | undefined {
  const subject: UnstoredMedia | undefined =
    'kind' in entry
      ? { locator: entry.locator, pages: entry.pages }
      : 'width' in entry
        ? {
            locator: entry.locator,
            width: entry.width,
            height: entry.height,
          }
        : undefined;
  if (subject === undefined) return undefined;
  const record = 'retainedMedia' in entry ? entry.retainedMedia : undefined;
  const retained =
    record === undefined ? undefined : retainedEntry(record, subject);
  if (retained === undefined) return undefined;
  const key = promptImportMediaKey(runId, entry.locator);
  retainedMedia.set(key, retained);
  return { ...subject, key };
}

type PromptImportsTemplateValues = {
  readonly hasImports: boolean;
  readonly imports: ReadonlyArray<{
    readonly locator: string;
    readonly body: string;
  }>;
  readonly notImported: ReadonlyArray<{ readonly locator: string }>;
  readonly omitted: string | undefined;
};

const renderPromptImportsTemplate =
  loadPackagedTemplate<PromptImportsTemplateValues>(
    __dirname,
    'prompt-imports',
  );

/** Keep imported content from closing its file block or forging another one. */
function neutralizeImportBody(body: string): string {
  return sanitizeAuthoredText(body).replaceAll(
    /<(\s*\/?\s*file)(?=\s*\/?\s*>|[\s/]+[\w-]+\s*=|$)/giu,
    '&lt;$1',
  );
}

function renderPromptImports(
  outcomes: ReadonlyArray<PromptImportOutcome>,
  omitted: ReadonlyArray<string>,
): string {
  const imports: Array<{ locator: string; body: string }> = [];
  const notImported: Array<{ locator: string }> = [];
  for (const outcome of outcomes) {
    const locator = sanitizeAuthoredText(outcome.locator);
    if (outcome.outcome === 'imported') {
      imports.push({
        locator: escapeXmlAttribute(outcome.locator),
        body: neutralizeImportBody(outcome.body),
      });
    } else {
      notImported.push({ locator });
    }
  }
  const omittedLabel =
    omitted.length === 0
      ? undefined
      : omitted
          .map((locator) => `\`${sanitizeAuthoredText(locator)}\``)
          .join(', ');
  return renderPromptImportsTemplate({
    hasImports: imports.length > 0,
    imports,
    notImported,
    omitted: omittedLabel,
  });
}

/**
 * Creates the single persisted prompt-imports notice for one accepted turn,
 * recording each unstored entry's retained bytes from the attempt's map under
 * what `retainedBefore`, the base64 the message already holds, leaves of the
 * per-message bound.
 */
export function createPromptImportsItem(input: {
  readonly runId: string;
  readonly outcomes: ReadonlyArray<PromptImportOutcome>;
  readonly omitted: ReadonlyArray<string>;
  readonly retained: ReadonlyMap<string, RetainedMedia>;
  readonly retainedBefore: number;
}): AuthoredContextItemPart {
  let used = input.retainedBefore;
  const imports = input.outcomes.map((outcome) => {
    const bounded = importRetainedMedia(input, outcome, used);
    used = bounded.used;
    return toPayloadEntry(outcome, bounded.record);
  });
  const payload: PromptImportsPayload = {
    imports,
    ...(input.omitted.length > 0 && { omitted: [...input.omitted] }),
  };
  if (!isPromptImportsPayload(payload)) {
    throw new TypeError('Invalid server-authored prompt imports metadata');
  }
  return createRenderedContextItem({
    producer: 'prompt-imports',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderPromptImports(input.outcomes, input.omitted),
  });
}
