import { type RecencyDigestEntry } from '../db/schema';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { type UnknownRecord } from '../unknown-record';

type RecencyDigestDeltaEntry = RecencyDigestEntry & { pinned: boolean };

export interface RecencyDigestDeltaPart {
  readonly type: 'data-recency-digest';
  readonly data: {
    readonly kind: 'delta';
    readonly runId: string;
    readonly entries: readonly RecencyDigestDeltaEntry[];
    readonly pinChanges: ReadonlyArray<{
      readonly title: string;
      readonly pinned: boolean;
    }>;
  };
}

export interface RecencyDigestSupersessionPart {
  readonly type: 'data-recency-digest';
  readonly data: {
    readonly kind: 'supersession';
    readonly runId: string;
  };
}

export type RecencyDigestPart =
  | RecencyDigestDeltaPart
  | RecencyDigestSupersessionPart;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is UnknownRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...expectedKeys].sort().join('\0')
  );
}

function isEntry(value: unknown): value is RecencyDigestDeltaEntry {
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
    typeof value['title'] === 'string' &&
    value['title'].trim().length > 0 &&
    typeof value['date'] === 'string' &&
    ISO_DATE_PATTERN.test(value['date']) &&
    typeof value['messageCount'] === 'number' &&
    Number.isSafeInteger(value['messageCount']) &&
    value['messageCount'] >= 0 &&
    typeof value['pinned'] === 'boolean' &&
    (value['excerpt'] === undefined || typeof value['excerpt'] === 'string')
  );
}

/** Strict persisted-shape validation. Authoring remains server-only. */
export function isRecencyDigestPart(
  value: unknown,
): value is RecencyDigestPart {
  if (
    !isExactRecord(value, ['data', 'type']) ||
    value['type'] !== 'data-recency-digest' ||
    (!isExactRecord(value['data'], ['kind', 'runId']) &&
      !isExactRecord(value['data'], ['entries', 'kind', 'pinChanges', 'runId']))
  ) {
    return false;
  }
  const data = value['data'];
  if (typeof data['runId'] !== 'string' || !UUID_PATTERN.test(data['runId'])) {
    return false;
  }
  if (data['kind'] === 'supersession') return true;
  if (
    data['kind'] !== 'delta' ||
    !Array.isArray(data['entries']) ||
    !data['entries'].every(isEntry) ||
    !Array.isArray(data['pinChanges']) ||
    !data['pinChanges'].every(
      (change): change is UnknownRecord & { title: string; pinned: boolean } =>
        isExactRecord(change, ['pinned', 'title']) &&
        typeof change['title'] === 'string' &&
        change['title'].trim().length > 0 &&
        typeof change['pinned'] === 'boolean',
    )
  ) {
    return false;
  }
  return data['entries'].length + data['pinChanges'].length > 0;
}

function assertValidPart<T extends RecencyDigestPart>(part: T): T {
  if (!isRecencyDigestPart(part)) {
    throw new TypeError('Invalid server-authored recency digest metadata');
  }
  return part;
}

export function createRecencyDigestDeltaPart(input: {
  readonly runId: string;
  readonly entries: readonly RecencyDigestDeltaEntry[];
  readonly pinChanges: ReadonlyArray<{
    readonly title: string;
    readonly pinned: boolean;
  }>;
}): RecencyDigestDeltaPart {
  return assertValidPart({
    type: 'data-recency-digest',
    data: { kind: 'delta', ...input },
  });
}

export function createRecencyDigestSupersessionPart(input: {
  readonly runId: string;
}): RecencyDigestSupersessionPart {
  return assertValidPart({
    type: 'data-recency-digest',
    data: { kind: 'supersession', ...input },
  });
}

function renderEntry(entry: RecencyDigestDeltaEntry): string {
  return `- ${sanitizeAuthoredText(entry.title)} — ${entry.pinned ? 'pinned; ' : ''}last activity ${entry.date}; ${entry.messageCount} messages${entry.excerpt ? `; opening: ${sanitizeAuthoredText(entry.excerpt)}` : ''}`;
}

export function renderRecencyDigestReminder(part: RecencyDigestPart): string {
  if (!isRecencyDigestPart(part)) {
    throw new TypeError('Invalid recency digest metadata');
  }
  if (part.data.kind === 'supersession') {
    return [
      '<chat-recency-update>',
      'The chat list was refreshed. Earlier chat-list updates in this conversation are superseded.',
      '</chat-recency-update>',
    ].join('\n');
  }

  const lines = [
    '<chat-recency-update>',
    'The owner has other-chat updates since the prior turn:',
  ];
  if (part.data.entries.length > 0) {
    lines.push(
      '',
      'Newly relevant chats:',
      ...part.data.entries.map(renderEntry),
    );
  }
  for (const { title, pinned } of part.data.pinChanges) {
    lines.push(
      '',
      pinned
        ? `The previously announced chat "${sanitizeAuthoredText(title)}" is now pinned.`
        : `The previously announced chat "${sanitizeAuthoredText(title)}" is no longer pinned.`,
    );
  }
  lines.push('</chat-recency-update>');
  return lines.join('\n');
}
