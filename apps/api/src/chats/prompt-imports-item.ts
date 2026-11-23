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
  canonicalSelector,
  parsePathScheme,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { z } from 'zod';

import {
  KNOWLEDGE_LOCATOR_SCHEME,
  parseKnowledgeLocator,
} from '../knowledge/knowledge-locator';
import {
  boundRetained,
  retainedEntry,
  type RetainedMedia,
  type RetainedSettlement,
  type UnstoredMedia,
} from '../media/attempt-media';
import { userImagePart, type MediaRef } from '../media/epoch-admission';
import {
  isThumbnailDataUrl,
  ORIGINAL_MEDIA_TYPES,
} from '../media/media-ingest';
import {
  MEDIA_LOCATOR_PATTERN,
  parseMediaLocator,
} from '../media/media-locator';
import {
  type RetainedMediaJson,
  retainedImageRecordSchema,
  retainedPdfRecordSchema,
} from '../media/retained-media';
import {
  parseSkillLocator,
  SKILL_LOCATOR_SCHEME,
} from '../skills/skill-locator';
import { parseSshLocator, SSH_SCHEME } from '../ssh/ssh-locator';
import { decodeFileAlias, isFileAlias } from '../tools/permissions/file-alias';
import { splitWebSelector, stripFragment } from '../tools/web-read/locator';

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
  /**
   * The probe found a file whose whole name is the target, so its selector is
   * file-name text and the label prints the target as written. Unstored: it
   * describes the probe, not the import, and never reaches the payload.
   */
  readonly literal?: true;
} & (
  | {
      readonly outcome: 'imported';
      readonly body: string;
      readonly truncated?: boolean;
      readonly attachment?: PromptImportMedia;
    }
  | { readonly outcome: 'denied' | 'failed' }
);

/**
 * One target a bound cut off before its read. `target` is the target as
 * written, which is also its stored payload entry; `literal` carries the probe
 * that found a file whose whole name is the target, so the notice prints it as
 * written. The bit stays in memory: the payload keeps only the target text.
 */
export type PromptImportOmission = {
  readonly target: string;
  readonly literal?: true;
};

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
  const { kind, media, mediaType, pages, byteSize, display, width, height } =
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
  // The read result keeps its thumbnail as display data, which no rendering
  // shows; this payload copies it into its own model-free entry key.
  const thumbnail = isRecord(display) ? display['thumbnail'] : undefined;

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

/** Keep imported content from closing its file block or forging another one.
 *  Exported so the import bound counts the body as it is rendered. */
export function neutralizeImportBody(body: string): string {
  return sanitizeAuthoredText(body).replaceAll(
    /<(\s*\/?\s*file)(?=\s*\/?\s*>|[\s/]+[\w-]+\s*=|$)/giu,
    '&lt;$1',
  );
}

/** The path and selector as written that the `read` of one scheme splits. */
type ImportLabelSplit = {
  readonly path: string;
  readonly selector: string;
};

/**
 * The label of one target: its path plus the canonical spelling of its
 * selector. The path and the split come from the locator parser of the
 * target's own scheme, so the label names the resource that scheme's `read`
 * opens. A target prints as written when a Machine probe resolved the whole
 * name as one file, when it names no selector, or when the grammar refuses its
 * selector, because no read of the canonical spelling would name it.
 */
function importLabel(locator: string, literal = false): string {
  if (literal) return locator;

  const split = splitImportTarget(locator);

  if (split === undefined) return locator;
  const canonical = canonicalSelector(split.selector);

  return canonical === undefined ? locator : `${split.path}:${canonical}`;
}

/** Split one target the way its scheme's `read` locator does. */
function splitImportTarget(locator: string): ImportLabelSplit | undefined {
  if (isFileAlias(locator)) return fileAliasSplit(locator);

  const scheme = parsePathScheme(locator);

  if (scheme === undefined) return localSplit(locator);

  const parse =
    scheme.scheme === KNOWLEDGE_LOCATOR_SCHEME
      ? parseKnowledgeLocator
      : scheme.scheme === SKILL_LOCATOR_SCHEME
        ? parseSkillLocator
        : undefined;

  if (parse !== undefined) {
    const parsed = parse(scheme.rest);

    return 'type' in parsed ? undefined : tailSplit(locator, parsed.selector);
  }

  switch (scheme.scheme) {
    case SSH_SCHEME: {
      const parsed = parseSshLocator(locator);

      return parsed.kind === 'path'
        ? tailSplit(locator, parsed.selector)
        : undefined;
    }

    case 'http':
    case 'https':
      return webSplit(locator);
    default:
      return localSplit(locator);
  }
}

/** A host, media, Project, or relative target's own split. */
function localSplit(locator: string): ImportLabelSplit | undefined {
  const { path, selector } = splitSelectorSuffix(locator);

  return selector === undefined ? undefined : { path, selector };
}

/**
 * A `file:` alias splits its decoded host path, as `resolveMachinePath` does,
 * so a percent-encoded colon stays path text. The label keeps the submitted
 * path text as written, so its escapes stay re-readable, and canonicalizes
 * only the selector. An alias whose selector boundary came from a decoded
 * escape (`%3A`) prints as written, because no literal colon in the submitted
 * text separates the path from its selector.
 */
function fileAliasSplit(locator: string): ImportLabelSplit | undefined {
  const alias = decodeFileAlias(locator);

  if (!alias.ok) return undefined;

  const { path, selector } = splitSelectorSuffix(alias.hostPath);

  if (selector === undefined) return undefined;

  const written = writtenAliasPath(locator, path);

  return written === undefined ? undefined : { path: written, selector };
}

/**
 * The submitted text of `locator` before the literal colon that ends its
 * decoded path, or undefined when the decoded path's boundary colon is not
 * literal in the submitted text. The submitted text after the scheme is
 * scanned because a selector may hold its own literal colon (`:5:6`), while a
 * `%3A` boundary leaves no literal colon to split at.
 */
function writtenAliasPath(
  locator: string,
  decodedPath: string,
): string | undefined {
  for (
    let colon = locator.indexOf(':', 5);
    colon >= 0;
    colon = locator.indexOf(':', colon + 1)
  ) {
    const written = locator.slice(0, colon);
    const decoded = decodeFileAlias(written);

    if (decoded.ok && decoded.hostPath === decodedPath) return written;
  }

  return undefined;
}

/**
 * The split the Knowledge, skill, and `ssh://` parsers report: each separates
 * the selector at a colon, so the selector they return is a tail of the text
 * and the path is what precedes its colon.
 */
function tailSplit(
  locator: string,
  selector: string | undefined,
): ImportLabelSplit | undefined {
  if (selector === undefined) return undefined;
  const at = locator.length - selector.length - 1;

  return { path: locator.slice(0, at), selector };
}

/** A web target splits after its fragment, which the request never sends. */
function webSplit(locator: string): ImportLabelSplit | undefined {
  const { url, selector } = splitWebSelector(stripFragment(locator));

  return selector === undefined ? undefined : { path: url, selector };
}

function renderPromptImports(
  outcomes: ReadonlyArray<PromptImportOutcome>,
  omitted: ReadonlyArray<PromptImportOmission>,
): string {
  const imports: Array<{ locator: string; body: string }> = [];
  const notImported: Array<{ locator: string }> = [];

  for (const outcome of outcomes) {
    const label = importLabel(outcome.locator, outcome.literal === true);

    if (outcome.outcome === 'imported') {
      imports.push({
        locator: escapeXmlAttribute(label),
        body: neutralizeImportBody(outcome.body),
      });
    } else {
      notImported.push({ locator: sanitizeAuthoredText(label) });
    }
  }

  const omittedLabel =
    omitted.length === 0
      ? undefined
      : omitted
          .map(
            ({ target, literal }) =>
              `\`${sanitizeAuthoredText(importLabel(target, literal === true))}\``,
          )
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
  readonly omitted: ReadonlyArray<PromptImportOmission>;
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
    ...(input.omitted.length > 0 && {
      omitted: input.omitted.map(({ target }) => target),
    }),
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
