/**
 * The `prompt-imports` producer (prompt-imports D6-D7).
 *
 * One item carries every outcome from the bounded prompt-import pass. Read
 * bodies are model-facing data and are neutralized before they enter a file
 * element; the payload deliberately records metadata only. An image entry's
 * body is its native image result; its payload entry records the `media://`
 * locator the conversion boundary attaches after the item's text
 * (vision-media D8).
 */

import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';
import {
  isBoolean,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { MEDIA_LOCATOR_PATTERN } from '../media/media-locator';

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

/** One bounded prompt marker and the result of its admission/read attempt. */
export type PromptImportOutcome = {
  readonly locator: string;
  readonly resolved?: string;
} & (
  | {
      readonly outcome: 'imported';
      readonly body: string;
      readonly truncated?: boolean;
      /** The `media://` locator of an image read result. */
      readonly media?: string;
    }
  | { readonly outcome: 'denied' | 'failed' }
);

export interface PromptImportsPayloadEntry extends UnknownRecord {
  readonly locator: string;
  readonly resolved?: string;
  readonly outcome: PromptImportOutcomeKind;
  readonly truncated?: boolean;
  /** The `media://` locator of an imported image; only on `imported`. */
  readonly media?: string;
}

/** Private metadata retained for owner disclosure and accepted-turn triggers. */
export interface PromptImportsPayload extends UnknownRecord {
  readonly imports: ReadonlyArray<PromptImportsPayloadEntry>;
  readonly omitted?: ReadonlyArray<string>;
}

function isPromptImportOutcome(
  value: unknown,
): value is PromptImportOutcomeKind {
  return (
    isString(value) &&
    PROMPT_IMPORT_OUTCOMES.some((outcome) => outcome === value)
  );
}

function isPromptImportsPayloadEntry(
  value: unknown,
): value is PromptImportsPayloadEntry {
  const hasResolved = isRecord(value) && Object.hasOwn(value, 'resolved');
  const hasTruncated = isRecord(value) && Object.hasOwn(value, 'truncated');
  const hasMedia = isRecord(value) && Object.hasOwn(value, 'media');
  return (
    isExactRecord(value, [
      'locator',
      'outcome',
      ...(hasResolved ? ['resolved'] : []),
      ...(hasTruncated ? ['truncated'] : []),
      ...(hasMedia ? ['media'] : []),
    ]) &&
    isNonEmptyString(value['locator']) &&
    isPromptImportOutcome(value['outcome']) &&
    (!hasResolved || isNonEmptyString(value['resolved'])) &&
    (!hasTruncated || isBoolean(value['truncated'])) &&
    (!hasMedia ||
      (value['outcome'] === 'imported' &&
        isString(value['media']) &&
        MEDIA_LOCATOR_PATTERN.test(value['media'])))
  );
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
    ...(outcome.outcome === 'imported' &&
      outcome.media !== undefined && { media: outcome.media }),
  };
}

/**
 * The `media://` locators of a `prompt-imports` item's image entries, in entry
 * order; none for another producer's item or a payload this build cannot
 * validate.
 */
export function promptImportMediaLocators(
  part: ContextItemPart,
): Array<string> {
  const { producer, payload } = part.data;
  if (producer !== 'prompt-imports' || !isPromptImportsPayload(payload)) {
    return [];
  }
  return payload.imports.flatMap((entry) =>
    entry.media === undefined ? [] : [entry.media],
  );
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
