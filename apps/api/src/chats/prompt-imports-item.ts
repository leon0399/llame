/**
 * The `prompt-imports` producer (prompt-imports D6-D7).
 *
 * One item carries every outcome from the bounded prompt-import pass. Read
 * bodies are model-facing data and are neutralized before they enter a file
 * element; the payload deliberately records metadata only. An image entry's
 * body is its native image result; its payload entry records either the
 * `media://` locator of a stored image or the display-only thumbnail and the
 * original's size and type of an unstored one, from which the conversion
 * boundary attaches the image after the item's text (vision-media D8).
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
  type OriginalMediaType,
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

type PromptImportOutcomeKind = (typeof PROMPT_IMPORT_OUTCOMES)[number];

/**
 * The private record of an imported image (vision-media D8): the `media://`
 * locator of a stored image alone, or, for an image imported without being
 * stored, its display-only `thumbnail` with the original's size and type.
 */
export type PromptImportImage =
  | { readonly media: string }
  | {
      readonly thumbnail: string;
      readonly width: number;
      readonly height: number;
      readonly mediaType: OriginalMediaType;
    };

/** One bounded prompt marker and the result of its admission/read attempt. */
export type PromptImportOutcome = {
  readonly locator: string;
  readonly resolved?: string;
} & (
  | {
      readonly outcome: 'imported';
      readonly body: string;
      readonly truncated?: boolean;
      readonly image?: PromptImportImage;
    }
  | { readonly outcome: 'denied' | 'failed' }
);

export interface PromptImportsPayloadEntry extends UnknownRecord {
  readonly locator: string;
  readonly resolved?: string;
  readonly outcome: PromptImportOutcomeKind;
  readonly truncated?: boolean;
  /** An imported image's record (see `PromptImportImage`); only on `imported`. */
  readonly media?: string;
  readonly thumbnail?: string;
  readonly width?: number;
  readonly height?: number;
  readonly mediaType?: OriginalMediaType;
}

/** Private metadata retained for owner disclosure and accepted-turn triggers. */
export interface PromptImportsPayload extends UnknownRecord {
  readonly imports: ReadonlyArray<PromptImportsPayloadEntry>;
  readonly omitted?: ReadonlyArray<string>;
}

/** The two exact forms of `PromptImportImage`. */
const storedImageFields = { media: z.string().regex(MEDIA_LOCATOR_PATTERN) };
const unstoredImageFields = {
  thumbnail: z.string().refine(isThumbnailDataUrl),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mediaType: z.enum(ORIGINAL_MEDIA_TYPES),
};

const promptImportImageSchema = z.union([
  z.strictObject(storedImageFields),
  z.strictObject(unstoredImageFields),
]);

const entryFields = {
  locator: z.string().refine(isNonEmptyString),
  resolved: z.string().refine(isNonEmptyString).exactOptional(),
  truncated: z.boolean().exactOptional(),
};

/**
 * One payload entry, exactly: an outcome with the optional `resolved` and
 * `truncated` fields, and on an `imported` entry at most one image form.
 */
const payloadEntrySchema = z.union([
  z.strictObject({ ...entryFields, outcome: z.enum(PROMPT_IMPORT_OUTCOMES) }),
  z.strictObject({
    ...entryFields,
    outcome: z.literal('imported'),
    ...storedImageFields,
  }),
  z.strictObject({
    ...entryFields,
    outcome: z.literal('imported'),
    ...unstoredImageFields,
  }),
]);

/**
 * The private record of a native image read result, or undefined for any
 * other result.
 */
export function promptImportImage(
  result: UnknownRecord,
): PromptImportImage | undefined {
  if (result['kind'] !== 'image') return undefined;
  const { media, thumbnail, width, height, mediaType } = result;
  const image = isString(media)
    ? { media }
    : { thumbnail, width, height, mediaType };
  return promptImportImageSchema.safeParse(image).data;
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
    ...(outcome.outcome === 'imported' && outcome.image),
  };
}

/**
 * The attempt-memory key of an unstored prompt-import image (vision-media
 * R1.4): the importing Run and the entry's locator, which is unique among its
 * item's entries. No tool call id has this form.
 */
export function promptImportImageKey(runId: string, locator: string): string {
  return `prompt-import:${runId}:${locator}`;
}

/**
 * The image references of a `prompt-imports` item's image entries, in entry
 * order: a stored entry's media id, or an unstored entry keyed by
 * `promptImportImageKey`; none for another producer's item or a payload this
 * build cannot validate.
 */
export function promptImportImageRefs(part: ContextItemPart): Array<MediaRef> {
  const { producer, payload, runId } = part.data;
  if (producer !== 'prompt-imports' || !isPromptImportsPayload(payload)) {
    return [];
  }
  return payload.imports.flatMap((entry): Array<MediaRef> => {
    const id =
      entry.media === undefined ? undefined : parseMediaLocator(entry.media);
    if (id !== undefined) return [id];
    const { locator, width, height } = entry;
    if (width === undefined || height === undefined) return [];
    return [
      { locator, width, height, key: promptImportImageKey(runId, locator) },
    ];
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
