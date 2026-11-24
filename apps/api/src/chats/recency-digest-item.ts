import { sanitizeAuthoredText } from '../instance-config/authored-text';
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import {
  CONTEXT_ITEM_PROVENANCE,
  createContextItemPart,
  isContextItemPart,
  renderContextItem,
  type AuthoredContextItemPart,
  type ContextItemPart,
} from './context-item';
import { renderChatRow, type ChatRow } from './chat-row';
import { loadPackagedTemplate } from '../prompts/template-engine';

const renderBaselineTemplate = loadPackagedTemplate<{
  compiledOn: string;
  pinnedShown: number;
  pinnedTotal: number;
  pinnedRows: string;
  recentShown: number;
  recentTotal: number;
  recentRows: string;
}>(__dirname, 'recency-digest-baseline');

const renderNoticeTemplate = loadPackagedTemplate<{
  hasAdditions: boolean;
  additions: string;
  hasCorrections: boolean;
  corrections: string;
}>(__dirname, 'recency-digest-notice');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASELINE_FIELDS = [
  'announced',
  'association',
  'kind',
  'version',
] as const;

const NOTICE_FIELDS = [
  'announced',
  'importedCutoff',
  'kind',
  'version',
] as const;

const ASSOCIATED_NOTICE_FIELDS = [
  'announced',
  'association',
  'importedCutoff',
  'kind',
  'version',
] as const;

export type DigestAnnouncedEntry = {
  readonly chatId: string;
  readonly pinned: boolean;
  readonly title?: string;
  readonly workspace?: string;
};

export type DigestAssociation =
  | { readonly kind: 'checkpoint'; readonly checkpointId: string }
  | { readonly kind: 'origin'; readonly chatId: string };

export type DigestPayload = {
  readonly version: 1;
  readonly kind: 'baseline' | 'notice';
  readonly announced: ReadonlyArray<DigestAnnouncedEntry>;
  readonly association?: DigestAssociation;
  readonly importedCutoff?: {
    readonly latestTurnSeq: number;
    readonly lastOriginalSeq: number;
  };
};

export type DigestState = {
  readonly baseline?: ContextItemPart;
  readonly announced: ReadonlyArray<DigestAnnouncedEntry>;
};

function exact(
  value: unknown,
  keys: ReadonlyArray<string>,
): value is UnknownRecord {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function safeSequence(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function association(value: unknown): value is DigestAssociation {
  if (!isRecord(value)) return false;

  if (value.kind === 'checkpoint')
    return (
      exact(value, ['kind', 'checkpointId']) &&
      isString(value.checkpointId) &&
      UUID.test(value.checkpointId)
    );

  return (
    value.kind === 'origin' &&
    exact(value, ['kind', 'chatId']) &&
    isString(value.chatId) &&
    UUID.test(value.chatId)
  );
}

function announced(
  value: unknown,
): value is ReadonlyArray<DigestAnnouncedEntry> {
  if (!Array.isArray(value)) return false;

  const seen = new Set<string>();

  for (const item of value) {
    if (
      !isRecord(item) ||
      !isString(item.chatId) ||
      !UUID.test(item.chatId) ||
      !isBoolean(item.pinned) ||
      seen.has(item.chatId)
    )
      return false;

    const allowed = Object.keys(item).every((key) =>
      ['chatId', 'pinned', 'title', 'workspace'].includes(key),
    );

    if (
      !allowed ||
      ('title' in item && !isString(item.title)) ||
      ('workspace' in item && !isString(item.workspace))
    )
      return false;

    seen.add(item.chatId);
  }

  return true;
}

function validPayload(value: unknown): value is DigestPayload {
  if (!isRecord(value) || value.version !== 1 || !announced(value.announced))
    return false;

  if (value.kind === 'baseline') {
    return (
      (exact(value, ['announced', 'kind', 'version']) ||
        exact(value, BASELINE_FIELDS)) &&
      (value.association === undefined || association(value.association))
    );
  }

  if (
    value.kind !== 'notice' ||
    !(
      exact(value, ['announced', 'kind', 'version']) ||
      exact(value, BASELINE_FIELDS) ||
      exact(value, NOTICE_FIELDS) ||
      exact(value, ASSOCIATED_NOTICE_FIELDS)
    )
  )
    return false;

  if (value.association !== undefined && !association(value.association))
    return false;

  if (value.importedCutoff === undefined) return true;

  return (
    exact(value.importedCutoff, ['latestTurnSeq', 'lastOriginalSeq']) &&
    safeSequence(value.importedCutoff.latestTurnSeq) &&
    safeSequence(value.importedCutoff.lastOriginalSeq)
  );
}

function bodyOf(text: string): string | undefined {
  const prefix = `<system-reminder producer="recency-digest" form="snapshot">\n${CONTEXT_ITEM_PROVENANCE}\n`;
  const suffix = '\n</system-reminder>';

  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return undefined;

  const body = text.slice(prefix.length, -suffix.length);

  return body.length > 0 ? body : undefined;
}

export function readDigestPayload(
  part: ContextItemPart,
): DigestPayload | undefined {
  if (!isContextItemPart(part) || part.data.producer !== 'recency-digest')
    return undefined;

  const value = part.data.payload;

  if (!isRecord(value) || value.version !== 1) return undefined;

  if (!validPayload(value))
    throw new TypeError('Invalid recency digest payload');

  const expectedForm = value.kind === 'baseline' ? 'snapshot' : 'notice';

  if (
    part.data.form !== expectedForm ||
    !isString(part.data.text) ||
    part.data.text.trim().length === 0
  )
    return undefined;

  return value;
}

export function createRecencyDigestItem(input: {
  readonly runId: string;
  readonly payload: DigestPayload;
  readonly body: string;
}): AuthoredContextItemPart {
  if (!validPayload(input.payload) || input.body.trim().length === 0)
    throw new TypeError('Invalid recency digest item');

  const form = input.payload.kind === 'baseline' ? 'snapshot' : 'notice';

  const text = renderContextItem({
    producer: 'recency-digest',
    form,
    body: input.body,
  });

  if (text === null) throw new TypeError('Invalid recency digest item');

  const payload: UnknownRecord = { ...input.payload };

  return createContextItemPart({
    producer: 'recency-digest',
    form,
    runId: input.runId,
    payload,
    text,
  });
}

export function deriveRecencyDigestState(
  parts: ReadonlyArray<unknown>,
): DigestState {
  let baseline: ContextItemPart | undefined;
  let state: ReadonlyArray<DigestAnnouncedEntry> = [];

  for (const value of parts) {
    if (!isContextItemPart(value)) continue;

    const payload = readDigestPayload(value);

    if (payload === undefined) continue;

    if (payload.kind === 'baseline') baseline = value;
    state = payload.announced;
  }

  return Object.freeze({
    ...(baseline !== undefined && { baseline }),
    announced: Object.freeze([...state]),
  });
}

export function recencyDigestBaselineBody(part: ContextItemPart): string {
  const payload = readDigestPayload(part);

  if (payload?.kind !== 'baseline' || !isString(part.data.text))
    throw new TypeError('Invalid recency digest baseline');

  const body = bodyOf(part.data.text);

  if (body === undefined)
    throw new TypeError('Invalid recency digest baseline envelope');

  return body;
}

export function renderRecencyDigestBaseline(
  rows: ReadonlyArray<ChatRow>,
  input: {
    readonly compiledOn: string;
    readonly pinnedShown: number;
    readonly pinnedTotal: number;
    readonly recentShown: number;
    readonly recentTotal: number;
  },
): string {
  return renderBaselineTemplate({
    compiledOn: sanitizeAuthoredText(input.compiledOn),
    pinnedShown: input.pinnedShown,
    pinnedTotal: input.pinnedTotal,
    pinnedRows: rows.slice(0, input.pinnedShown).map(renderChatRow).join('\n'),
    recentShown: input.recentShown,
    recentTotal: input.recentTotal,
    recentRows: rows.slice(input.pinnedShown).map(renderChatRow).join('\n'),
  });
}

export function renderRecencyDigestNotice(input: {
  readonly additions: ReadonlyArray<ChatRow>;
  readonly corrections: ReadonlyArray<{
    readonly chatId: string;
    readonly title: string;
    readonly field: 'pinned' | 'workspace';
    readonly value: string;
  }>;
}): string {
  const corrections = input.corrections.map(
    (correction) =>
      `${sanitizeAuthoredText(correction.title)} (${sanitizeAuthoredText(correction.chatId)}): ${correction.field} is now ${sanitizeAuthoredText(correction.value)}.`,
  );

  return renderNoticeTemplate({
    hasAdditions: input.additions.length > 0,
    additions: input.additions.map(renderChatRow).join('\n'),
    hasCorrections: corrections.length > 0,
    corrections: corrections.join('\n'),
  });
}
