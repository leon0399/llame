/**
 * The recency-digest context items: the delta produced when another chat enters
 * or leaves the digest, and the supersession marker that makes a later
 * snapshot's silence meaningful. The payload is the structured state (titles,
 * counts, the pin flag); the prose is the packaged template's.
 */

import { type RecencyDigestEntry } from '../db/schema';
import {
  isBoolean,
  isNumber,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { type AuthoredContextItemPart } from './context-item';
import {
  createRenderedContextItem,
  isExactRecord,
} from './context-item-shared';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';

type RecencyDigestDeltaEntry = RecencyDigestEntry & { pinned: boolean };

export interface RecencyDigestDeltaPayload extends UnknownRecord {
  readonly entries: ReadonlyArray<RecencyDigestDeltaEntry>;
  readonly pinChanges: ReadonlyArray<{
    readonly title: string;
    readonly pinned: boolean;
  }>;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDigestEntry(value: unknown): value is RecencyDigestDeltaEntry {
  if (
    !isExactRecord(value, [
      'date',
      'excerpt',
      'messageCount',
      'pinned',
      'title',
    ]) &&
    !isExactRecord(value, ['date', 'messageCount', 'pinned', 'title'])
  ) {
    return false;
  }

  return (
    isString(value['title']) &&
    value['title'].trim().length > 0 &&
    isString(value['date']) &&
    ISO_DATE_PATTERN.test(value['date']) &&
    isNumber(value['messageCount']) &&
    Number.isSafeInteger(value['messageCount']) &&
    value['messageCount'] >= 0 &&
    isBoolean(value['pinned']) &&
    (value['excerpt'] === undefined || isString(value['excerpt']))
  );
}

export function isRecencyDigestDeltaPayload(
  value: unknown,
): value is RecencyDigestDeltaPayload {
  if (!isExactRecord(value, ['entries', 'pinChanges'])) return false;
  const { entries, pinChanges } = value;

  if (!Array.isArray(entries) || !entries.every(isDigestEntry)) return false;

  if (
    !Array.isArray(pinChanges) ||
    !pinChanges.every(
      (change) =>
        isExactRecord(change, ['pinned', 'title']) &&
        isString(change['title']) &&
        change['title'].trim().length > 0 &&
        isBoolean(change['pinned']),
    )
  ) {
    return false;
  }

  return entries.length + pinChanges.length > 0;
}

export function createRecencyDigestDeltaItem(input: {
  readonly runId: string;
  readonly payload: RecencyDigestDeltaPayload;
}): AuthoredContextItemPart {
  if (!isRecencyDigestDeltaPayload(input.payload)) {
    throw new TypeError('Invalid server-authored recency digest metadata');
  }

  return createRenderedContextItem({
    producer: 'recency-digest',
    form: 'notice',
    runId: input.runId,
    payload: input.payload,
    body: renderRecencyDigestDelta(input.payload),
  });
}

/**
 * The supersession marker is a `snapshot`, whose defined meaning already is
 * that a later snapshot from the same producer supersedes an earlier one — so
 * it needs no marker shape of its own.
 */
export function createRecencyDigestSupersessionItem(input: {
  readonly runId: string;
}): AuthoredContextItemPart {
  return createRenderedContextItem({
    producer: 'recency-digest',
    form: 'snapshot',
    runId: input.runId,
    payload: {},
    body: renderRecencyDigestSupersession(),
  });
}

/** One digest entry as the template sees it: the title and excerpt the
 *  producer neutralizes, and the pin flag the template branches on. */
type RecencyDigestDeltaEntryView = {
  readonly title: string;
  readonly date: string;
  readonly messageCount: number;
  readonly pinned: boolean;
  readonly excerpt?: string;
};

/** One pin change as the template sees it. */
type RecencyDigestDeltaPinChangeView = {
  readonly title: string;
  readonly pinned: boolean;
};

/**
 * The digest carries another chat's title and excerpt — content llame did not
 * author — so this item states its own precedence rather than relying on the
 * packaged prompt, which an operator may replace wholesale.
 *
 * The engine has no comparison helper and neutralizes nothing, so the entry
 * heading and every pin sentence branch on values derived here, and both
 * untrusted fields arrive already neutralized.
 */
const renderRecencyDigestDeltaTemplate = loadPackagedTemplate<{
  readonly hasEntries: boolean;
  readonly entries: ReadonlyArray<RecencyDigestDeltaEntryView>;
  readonly pinChanges: ReadonlyArray<RecencyDigestDeltaPinChangeView>;
}>(__dirname, 'recency-digest-delta');

/** The supersession marker body: fixed text, no values. */
const renderRecencyDigestSupersessionTemplate = loadPackagedTemplate<
  Record<string, never>
>(__dirname, 'recency-digest-supersession');

function renderRecencyDigestDelta(payload: RecencyDigestDeltaPayload): string {
  return renderRecencyDigestDeltaTemplate({
    hasEntries: payload.entries.length > 0,
    entries: payload.entries.map((entry) => ({
      title: sanitizeAuthoredText(entry.title),
      date: entry.date,
      messageCount: entry.messageCount,
      pinned: entry.pinned,
      excerpt: entry.excerpt ? sanitizeAuthoredText(entry.excerpt) : undefined,
    })),
    pinChanges: payload.pinChanges.map((change) => ({
      title: sanitizeAuthoredText(change.title),
      pinned: change.pinned,
    })),
  });
}

function renderRecencyDigestSupersession(): string {
  return renderRecencyDigestSupersessionTemplate({});
}
