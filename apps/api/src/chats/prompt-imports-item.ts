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

import type { MediaRef } from '../media/epoch-admission';
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
  }),
  z.strictObject({
    ...entryFields,
    outcome: z.literal('imported'),
    ...pdfFields,
  }),
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
): PromptImportsPayloadEntry {
  return {
    locator: outcome.locator,
    ...(outcome.resolved !== undefined && { resolved: outcome.resolved }),
    outcome: outcome.outcome,
    ...(outcome.outcome === 'imported' &&
      outcome.truncated !== undefined && { truncated: outcome.truncated }),
    ...(outcome.outcome === 'imported' && outcome.attachment),
  };
}

/**
 * The attempt-memory key of an unstored import: the importing Run and its
 * entry's locator, which is unique among the item's entries. No tool call id
 * has this form.
 */
export function promptImportMediaKey(runId: string, locator: string): string {
  return `prompt-import:${runId}:${locator}`;
}

/**
 * Media references in entry order: stored ids or unstored references keyed by
 * `promptImportMediaKey`; none for another producer or an invalid payload.
 */
export function promptImportMediaRefs(part: ContextItemPart): Array<MediaRef> {
  const { producer, payload, runId } = part.data;
  if (producer !== 'prompt-imports' || !isPromptImportsPayload(payload)) {
    return [];
  }
  return payload.imports.flatMap((entry): Array<MediaRef> => {
    const id =
      'media' in entry && entry.media !== undefined
        ? parseMediaLocator(entry.media)
        : undefined;
    if (id !== undefined) return [id];
    const { locator } = entry;
    if ('kind' in entry) {
      return [
        {
          locator,
          pages: entry.pages,
          key: promptImportMediaKey(runId, locator),
        },
      ];
    }
    if ('width' in entry) {
      return [
        {
          locator,
          width: entry.width,
          height: entry.height,
          key: promptImportMediaKey(runId, locator),
        },
      ];
    }
    return [];
  });
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

/** Creates the single persisted prompt-imports notice for one accepted turn. */
export function createPromptImportsItem(input: {
  readonly runId: string;
  readonly outcomes: ReadonlyArray<PromptImportOutcome>;
  readonly omitted: ReadonlyArray<string>;
}): AuthoredContextItemPart {
  const payload: PromptImportsPayload = {
    imports: input.outcomes.map(toPayloadEntry),
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
