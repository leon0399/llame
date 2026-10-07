/**
 * The producers that author context items, and the bodies they render.
 *
 * Each producer owns two things and nothing else: the payload it persists
 * (semantics — identifiers, closed reason codes, validated values — never
 * literal prose, remote-authored text, or raw errors) and the body text it
 * renders. The envelope, its provenance framing, attribute escaping, and the
 * order items appear in belong to `context-item.ts`, so a producer cannot
 * forget any of them.
 *
 * A compaction checkpoint is persisted as an ordinary `data-context` part on
 * its own `checkpoint` message row. Its complete rendered text is the replay
 * authority; the payload is only the structured owner-facing summary.
 */

import type { ContextCheckpoint } from './context-builder';
import type { CheckpointMessage } from './messages-repository';
import {
  isContextItemPart,
  type AuthoredContextItemPart,
  type ContextItemForm,
  type ContextItemPart,
} from './context-item';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';
import {
  formatTemporalAnchor,
  isIanaTimeZone,
} from '../prompts/temporal-anchor';
import { type Message, type RecencyDigestEntry } from '../db/schema';
import {
  isBoolean,
  isNumber,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { ModelContextExecutionError } from '../runs/model-context-errors';
import {
  createRenderedContextItem,
  isExactRecord,
} from './context-item-shared';
import {
  createToolAvailabilityItem,
  deriveToolAvailabilityPayload,
  deriveToolAvailabilityPayloadFromStates,
  isToolAvailabilityPayload,
  RECOVERY_REASON_BY_UNAVAILABLE_REASON,
  TOOL_RECOVERY_REASON_LABELS,
  TOOL_RECOVERY_REASONS,
} from './tool-availability-context-item';
import {
  WORKSPACE_DETACH_REASONS,
  type WorkspaceDetachReason,
} from './workspace-binding';

/* ------------------------------------------------------------------ *
 * workspace
 * ------------------------------------------------------------------ */

export interface WorkspaceSnapshotPayload extends UnknownRecord {
  readonly root: string | null;
}

export interface WorkspaceDetachPayload extends UnknownRecord {
  readonly reason: WorkspaceDetachReason;
}

function isWorkspaceRoot(value: unknown): value is string {
  return (
    isString(value) &&
    value.length > 0 &&
    value.startsWith('/') &&
    !value.includes('\0')
  );
}

export function isWorkspaceSnapshotPayload(
  value: WorkspaceSnapshotPayload,
): value is WorkspaceSnapshotPayload;
export function isWorkspaceSnapshotPayload(
  value: unknown,
): value is WorkspaceSnapshotPayload;
export function isWorkspaceSnapshotPayload(
  value: unknown,
): value is WorkspaceSnapshotPayload {
  if (!isExactRecord(value, ['root'])) return false;
  return value['root'] === null || isWorkspaceRoot(value['root']);
}

export function isWorkspaceDetachPayload(
  value: WorkspaceDetachPayload,
): value is WorkspaceDetachPayload;
export function isWorkspaceDetachPayload(
  value: unknown,
): value is WorkspaceDetachPayload;
export function isWorkspaceDetachPayload(
  value: unknown,
): value is WorkspaceDetachPayload {
  if (!isExactRecord(value, ['reason'])) return false;
  return WORKSPACE_DETACH_REASONS.some((reason) => reason === value['reason']);
}

const renderWorkspaceSnapshotTemplate = loadPackagedTemplate<{
  readonly hasWorkspace: boolean;
  readonly root?: string;
}>(__dirname, 'workspace-snapshot');

const renderWorkspaceDetachTemplate = loadPackagedTemplate<{
  readonly reason: WorkspaceDetachReason;
}>(__dirname, 'workspace-detach');

function renderWorkspaceSnapshot(root: string | null): string {
  return renderWorkspaceSnapshotTemplate({
    hasWorkspace: root !== null,
    ...(root !== null && { root }),
  });
}

export function createWorkspaceSnapshotItem(input: {
  readonly runId: string;
  readonly root: string | null;
}): AuthoredContextItemPart {
  const payload: WorkspaceSnapshotPayload = { root: input.root };
  if (!isWorkspaceSnapshotPayload(payload)) {
    throw new TypeError('Invalid server-authored Workspace snapshot metadata');
  }
  return createRenderedContextItem({
    producer: 'workspace',
    form: 'snapshot',
    runId: input.runId,
    payload,
    body: renderWorkspaceSnapshot(input.root),
  });
}

export function createWorkspaceDetachNoticeItem(input: {
  readonly runId: string;
  readonly reason: WorkspaceDetachReason;
}): AuthoredContextItemPart {
  const payload: WorkspaceDetachPayload = { reason: input.reason };
  if (!isWorkspaceDetachPayload(payload)) {
    throw new TypeError('Invalid server-authored Workspace detach metadata');
  }
  return createRenderedContextItem({
    producer: 'workspace',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderWorkspaceDetachTemplate({ reason: input.reason }),
  });
}

// Re-exported: this producer used to live inline here; every existing
// importer of it still resolves through this module.
export {
  createToolAvailabilityItem,
  deriveToolAvailabilityPayload,
  deriveToolAvailabilityPayloadFromStates,
  isToolAvailabilityPayload,
  RECOVERY_REASON_BY_UNAVAILABLE_REASON,
  TOOL_RECOVERY_REASON_LABELS,
  TOOL_RECOVERY_REASONS,
};

/* ------------------------------------------------------------------ *
 * effective-context-change
 * ------------------------------------------------------------------ */

/**
 * A model change, the one cause of an effective-context change with a shipped
 * detector.
 *
 * The cause set is closed and carries **one cause per item**: when several
 * occur on the same turn each becomes its own item, because a notice that
 * enumerates dimensions is nearly always a single word and every future
 * dimension would need enumeration support.
 *
 * The remaining snapshot inputs — an operator prompt reload, a personalization
 * edit — are disclosed separately (#466), because they cannot be inferred from
 * a hash: `promptHash` also moves on a routine digest re-bake and on every
 * temporal-anchor refresh, so only the binder knows why it minted a new
 * snapshot.
 */
export interface ModelChangePayload extends UnknownRecord {
  readonly cause: 'model';
  readonly fromModelId: string;
  readonly toModelId: string;
}

export function isModelChangePayload(
  value: unknown,
): value is ModelChangePayload {
  if (!isExactRecord(value, ['cause', 'fromModelId', 'toModelId'])) {
    return false;
  }
  const { cause, fromModelId, toModelId } = value;
  return (
    cause === 'model' &&
    isString(fromModelId) &&
    fromModelId.trim().length > 0 &&
    isString(toModelId) &&
    toModelId.trim().length > 0 &&
    fromModelId !== toModelId
  );
}

/**
 * One side of a model change, as the model-facing body names it.
 *
 * A producer-derived view value, never persisted state: `ModelChangePayload`
 * keeps the two ids exactly as it always has, so an item written when the body
 * named only the destination still validates and never depends on the catalog
 * that authored its prose.
 *
 * `name` and `providerModelId` are read from the operator model catalog when
 * the body is authored. Both are operator-authored, so both are neutralized
 * before they reach the template; a model the catalog no longer carries
 * degrades to its id alone.
 */
export type ModelChangeModel = {
  readonly id: string;
  readonly name?: string;
  readonly providerModelId?: string;
};

export function createModelChangeItem(input: {
  readonly oldModel: ModelChangeModel;
  readonly newModel: ModelChangeModel;
  readonly runId: string;
}): AuthoredContextItemPart {
  const payload: ModelChangePayload = {
    cause: 'model',
    fromModelId: input.oldModel.id,
    toModelId: input.newModel.id,
  };
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the declared type cannot express the non-empty and distinct-id invariants this guard enforces, so it is an assertion about the value, not a redundant re-parse of a type we already trust.
  if (!isModelChangePayload(payload)) {
    throw new TypeError('Invalid server-authored model change metadata');
  }
  return createRenderedContextItem({
    producer: 'effective-context-change',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderModelChange(input.oldModel, input.newModel),
  });
}

/** One model as the template sees it: neutralized name, raw id, optional provider id. */
type ModelChangeModelView = {
  readonly name: string;
  readonly id: string;
  readonly providerId?: string;
};

const renderModelChangeTemplate = loadPackagedTemplate<{
  readonly oldModel: ModelChangeModelView;
  readonly newModel: ModelChangeModelView;
}>(__dirname, 'effective-context-change');

/**
 * A model name and a provider model id are operator-authored catalog text, so
 * each is neutralized exactly as the skill catalog neutralizes an
 * operator-authored description. The llame-internal id is llame's own opaque
 * identifier and passes through raw, as it always has.
 *
 * A model the catalog does not carry, or carries without a usable name, keeps
 * its id in the name slot: deterministic and never ungrammatical, at the cost
 * of one conditional per model rather than two.
 */
function toModelChangeModelView(model: ModelChangeModel): ModelChangeModelView {
  const name = model.name?.trim() ?? '';
  const providerModelId = model.providerModelId?.trim() ?? '';
  return {
    name: name.length > 0 ? sanitizeAuthoredText(name) : model.id,
    id: model.id,
    ...(providerModelId.length > 0 && {
      providerId: sanitizeAuthoredText(providerModelId),
    }),
  };
}

/**
 * The prose names both models, the one the turn left included: the change IS
 * the transition, and naming only the destination would leave the model to
 * infer what it had been running as.
 *
 * The persisted payload still carries the two ids alone. The names are read
 * from the operator catalog when the body is authored, and recording them
 * would let a later catalog edit rewrite what a historical turn rendered.
 */
function renderModelChange(
  oldModel: ModelChangeModel,
  newModel: ModelChangeModel,
): string {
  return renderModelChangeTemplate({
    oldModel: toModelChangeModelView(oldModel),
    newModel: toModelChangeModelView(newModel),
  });
}

/* ------------------------------------------------------------------ *
 * recency-digest
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * temporal
 * ------------------------------------------------------------------ */

/**
 * When a turn was received, stored with the turn it annotates.
 *
 * The zone is stored ALONGSIDE the instant rather than resolved at render:
 * rendering then consults neither the clock nor the process environment, so a
 * worker cannot disagree with the api that accepted the turn, and an instance
 * that later moves timezone does not rewrite what it already told the model.
 *
 * Scalar, not a list of readings. #454's reading of the same instant in the
 * owner's timezone is computed at render from THIS instant — storing it would
 * freeze a preference the owner can change and would need rewriting across
 * history when they do.
 */
export interface TemporalPayload extends UnknownRecord {
  /** `Date.prototype.toISOString()` output — UTC, millisecond precision. */
  readonly instant: string;
  readonly timeZone: string;
}

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * A zone is known when it names an IANA identifier `Intl` accepts; there is no
 * allowlist to drift from the runtime's own tz database. `Intl` throws
 * `RangeError` for an unknown identifier, which is the second check.
 *
 * The identifier test is not redundant with `Intl` acceptance — ECMA-402 also
 * accepts a bare UTC offset — and it stays here as defense in depth even now
 * that `resolveInstanceTimezone` rejects an offset at the source: a persisted
 * row revalidates on every replay, where the value's provenance is whatever
 * the column holds.
 */
const knownTimeZones = new Set<string>();

function isKnownTimeZone(value: string): boolean {
  if (knownTimeZones.has(value)) return true;
  if (!isIanaTimeZone(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    return false;
  }
  // Every persisted row revalidates on every request, so remember the answer:
  // the set of zones a deployment ever sees is small and never shrinks.
  knownTimeZones.add(value);
  return true;
}

export function isTemporalPayload(value: unknown): value is TemporalPayload {
  if (!isExactRecord(value, ['instant', 'timeZone'])) return false;
  const { instant, timeZone } = value;
  if (!isString(instant) || !ISO_INSTANT_PATTERN.test(instant)) return false;
  // Round-trip rather than `Date.parse`, which silently rolls a calendar-
  // invalid date forward: `2026-02-30T…` parses to March 2, so a corrupted row
  // would render a plausible wrong date instead of nothing at all. The NaN
  // guard comes first because `toISOString` THROWS on an invalid date rather
  // than returning something that fails the comparison.
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== instant) {
    return false;
  }
  return isString(timeZone) && isKnownTimeZone(timeZone);
}

export function createTemporalItem(input: {
  readonly runId: string;
  readonly instant: Date;
  readonly timeZone: string;
}): AuthoredContextItemPart {
  const payload: TemporalPayload = {
    instant: input.instant.toISOString(),
    timeZone: input.timeZone,
  };
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the declared type cannot express the round-tripping instant and known-IANA-zone invariants this guard enforces, so it is an assertion about the value, not a redundant re-parse of a type we already trust.
  if (!isTemporalPayload(payload)) {
    throw new TypeError('Invalid server-authored temporal metadata');
  }
  return createRenderedContextItem({
    producer: 'temporal',
    // `snapshot`: state as of the moment it was taken, not an event report.
    // Supersession never arises — each turn's row describes its own turn — but
    // the form classifies the content, and that is what the vocabulary is for.
    form: 'snapshot',
    runId: input.runId,
    payload,
    body: renderTemporal(payload),
  });
}

/** The temporal receipt body. The producer formats the stored instant and
 *  zone into the anchor's two strings; the template renders them as received,
 *  never from a prefix anchor. */
const renderTemporalTemplate = loadPackagedTemplate<{
  readonly systemTime: string;
  readonly systemTimezone: string;
}>(__dirname, 'temporal');

/**
 * Receipt, never the present instant, and worded identically on the newest
 * turn and the oldest.
 *
 * A row that claimed "now" would be false the moment it is replayed, and a row
 * whose wording changed once its turn stopped being the newest would mutate a
 * persisted message's rendering — forfeiting the byte-identity that is the
 * whole reason this row is stored rather than computed per request.
 *
 * One line: the rail's per-item framing is paid for on every item, and a
 * second sentence here would be paid for on every turn of every conversation.
 */
function renderTemporal(payload: TemporalPayload): string {
  const { systemTime, systemTimezone } = formatTemporalAnchor(
    new Date(payload.instant),
    payload.timeZone,
  );
  return renderTemporalTemplate({ systemTime, systemTimezone });
}

/* ------------------------------------------------------------------ *
 * compaction
 * ------------------------------------------------------------------ */

/** The checkpoint body: three framing sentences, then the neutralized summary. */
const renderCompactionCheckpointTemplate = loadPackagedTemplate<{
  readonly summary: string;
}>(__dirname, 'compaction-checkpoint');

/**
 * A checkpoint stands in for history it superseded, so it states that it is
 * historical context rather than a new request — which is already a precedence
 * statement, and deliberately the only rank-setting language it carries.
 *
 * Unlike a one-off notice, a checkpoint is replayed on EVERY turn for the life
 * of the chat, so prose added here is paid for indefinitely. The third sentence
 * is the justified addition: it tells the model that session state may already
 * reflect the described work and not to repeat it.
 */
export function renderCompactionCheckpoint(summary: string): string {
  // The summary is written by the summarizing model over conversation
  // content, so it can carry a reserved delimiter copied out of a turn that
  // legitimately discussed one — llame's own users do exactly that. Without
  // this it would close the checkpoint envelope early.
  return renderCompactionCheckpointTemplate({
    summary: sanitizeAuthoredText(summary),
  });
}

export const COMPACTION_CHECKPOINT_FORM: ContextItemForm = 'checkpoint';

// Checkpoints are authored outside the attached-to-turn context-item path, so
// they do not have a Run id of their own. Keep the existing context-item wire
// shape valid with one stable sentinel; replay treats the persisted text as the
// authority and never uses this identifier.
const CHECKPOINT_PART_RUN_ID = '00000000-0000-4000-8000-000000000000';

export function createCompactionCheckpointPart(
  summary: string,
): ContextItemPart {
  if (summary.trim().length === 0) {
    throw new TypeError('Invalid compaction checkpoint summary');
  }
  return createRenderedContextItem({
    producer: 'compaction',
    form: COMPACTION_CHECKPOINT_FORM,
    runId: CHECKPOINT_PART_RUN_ID,
    payload: { v: 1, summary },
    body: renderCompactionCheckpoint(summary),
  });
}

function checkpointPartOrThrow(row: Message) {
  if (
    row.role !== 'checkpoint' ||
    !Array.isArray(row.parts) ||
    row.parts.length !== 1
  ) {
    throw new ModelContextExecutionError(
      `Checkpoint ${row.id} must contain exactly one context part.`,
    );
  }
  const [part] = row.parts;
  if (
    !isContextItemPart(part) ||
    part.data.producer !== 'compaction' ||
    part.data.form !== COMPACTION_CHECKPOINT_FORM ||
    !isString(part.data.text) ||
    part.data.text.trim().length === 0
  ) {
    throw new ModelContextExecutionError(
      `Checkpoint ${row.id} has an invalid or empty context part.`,
    );
  }
  return { part, text: part.data.text };
}

export function readCheckpointText(row: Message): string {
  return checkpointPartOrThrow(row).text;
}

/** The replay selection for a stored checkpoint row. */
export function toContextCheckpoint(row: CheckpointMessage): ContextCheckpoint {
  return {
    text: readCheckpointText(row),
    absorbedThroughSeq: row.absorbedThroughSeq,
  };
}

export function checkpointSummary(row: Message): string {
  const { part } = checkpointPartOrThrow(row);
  const payload = part.data.payload;
  if (
    !isExactRecord(payload, ['summary', 'v']) ||
    payload['v'] !== 1 ||
    !isString(payload['summary']) ||
    payload['summary'].trim().length === 0
  ) {
    throw new ModelContextExecutionError(
      `Checkpoint ${row.id} has invalid summary metadata.`,
    );
  }
  return payload['summary'];
}

/** Does this part carry a recency-digest delta or supersession? */
export function isRecencyDigestItem(value: unknown): value is ContextItemPart {
  if (!isContextItemPart(value) || value.data.producer !== 'recency-digest') {
    return false;
  }
  return (
    value.data.form === 'snapshot' ||
    isRecencyDigestDeltaPayload(value.data.payload)
  );
}
