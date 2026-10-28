/**
 * Provider-portable replay of persisted tool observations.
 *
 * Budgets are measured in JavaScript UTF-16 code units over the exact
 * `JSON.stringify([assistantToolCallMessage, toolResultMessage])` envelope.
 * Pairing wins over payload retention: payloads clear oldest-first, then whole
 * oldest pairs are omitted when their irreducible envelopes still do not fit.
 */

import type {
  ModelMessage,
  ToolCallPart as SdkToolCallPart,
  ToolResultPart as SdkToolResultPart,
} from 'ai';

import { serializeNativeModelOutput } from '@workspace/native-file-tools';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { isRejectedHopUrl } from '../tools/permissions/messages';
import { isRecord, isString } from '@workspace/runtime-safety';
import { loadPackagedTemplate } from '../prompts/template-engine';
import type { MessagePart } from './context-builder';
import {
  isUnstoredMedia,
  mediaResultRef,
  submittedLocator,
  toolResultOutput,
  type ToolMediaRef,
} from '../media/epoch-admission';
import {
  parseRetainedMedia,
  storedToolPartMediaKey,
} from '../media/retained-media';
import { retainedEntry, type RetainedMedia } from '../media/attempt-media';

export const TOOL_PART_PREFIX = 'tool-';
export const TOOL_REPLAY_CALL_LIMIT = 8000;
export const TOOL_REPLAY_TURN_LIMIT = 32_000;
export const TOOL_OUTCOME_MAX_LENGTH = 128;
export function renderToolObservationOmission(count: number): string {
  return `[${count} earlier tool observations omitted to fit replay budget.]`;
}

/**
 * The untrusted-output framing rendered around every tool result, packaged as
 * `prompts/tool-output-untrusted.md` and loaded once at module initialization.
 * The whole composition — label, `Outcome:` line, and the optional `Payload:`
 * block — is template text, so no llame-authored label stays behind as
 * concatenation. The block is gated on `hasPayload`, derived from
 * `body !== null` by the producer, because an empty-string body still renders a
 * `Payload:` line while a null body omits it entirely.
 */
const renderToolOutputUntrusted = loadPackagedTemplate<{
  outcome: string;
  payload: string | null;
  hasPayload: boolean;
}>(__dirname, 'tool-output-untrusted');

const TOOL_CALL_ID_MAX_LENGTH = 1024;
const TOOL_NAME_MAX_LENGTH = 64;
const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const TOOL_OUTCOME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;

/** The native `read` tool — the one tool whose refused redirect hop reports a
 *  target (tools/web-read/http-client.ts). */
const READ_TOOL_NAME = 'read';

/**
 * The tools whose `complete: false` result means the payload is partial: a
 * cleared pair replays as `incomplete`, not as a success, so the model never
 * reads a stopped page as the whole answer.
 */
const PARTIAL_RESULT_TOOL_PARTS = {
  'tool-knowledge_search': true,
  'tool-grep': true,
} satisfies Record<string, true>;

/** The error type a refused redirect hop reports. */
const HOP_REJECTION_OUTCOME = 'permission_denied';

/**
 * Whether an observation is the native `read` tool's refused redirect hop —
 * the only record that carries a `rejectedUrl`, on the way in as well as on
 * the way back out. Any other tool or error type stores and replays the
 * observation without it, whatever a stored part holds; a target that is
 * carried is still validated by `isRejectedHopUrl` before it is rendered.
 */
export function isHopRejection(toolName: string, errorType: string): boolean {
  return toolName === READ_TOOL_NAME && errorType === HOP_REJECTION_OUTCOME;
}

interface StoredToolPart {
  type: `tool-${string}`;
  toolCallId: string;
  state: 'output-available' | 'output-error';
  input: unknown;
  output?: unknown;
  errorText?: string;
  /**
   * The refused redirect target a hop rejection stored beside its error, part
   * of the model-visible result rather than the excluded decision metadata;
   * `isRejectedHopUrl` validates it and `isHopRejection` proves the record is
   * a hop rejection before either reader renders it.
   */
  errorRejectedUrl?: unknown;
  outcome?: unknown;
  resultProviderMetadata?: unknown;
  /**
   * The retained bytes of an unstored `read`, stored beside the result and
   * never in model text (`media-attachments`). A part with no valid record is
   * not a media reference, so it replays as its result text.
   */
  retainedMedia?: unknown;
}

export interface ProjectedToolObservationPair {
  partIndex: number;
  toolCallPart: SdkToolCallPart;
  toolResultPart: SdkToolResultPart;
}

export interface ToolObservationProjection {
  pairs: Array<ProjectedToolObservationPair>;
  toolCallParts: Array<SdkToolCallPart>;
  toolResultParts: Array<SdkToolResultPart>;
  omittedCount: number;
  omissionPartIndex: number | null;
  /**
   * The retained entry behind each media marker in `pairs`, keyed by the
   * marker's key, so the caller merges them into the attempt's map before
   * sizing or composing the request. A cleared or omitted pair emits no
   * marker, so the entry its part keeps stays unused.
   */
  retainedMedia: ReadonlyMap<string, RetainedMedia>;
}

interface ObservationPayload {
  toolCallId: string;
  toolName: string;
  outcome: string;
  partIndex: number;
  input: unknown;
  resultBody: string | null;
  clearedOutcome: string;
  /**
   * The image or PDF a `read` result names: its media id, or for an unstored
   * file its submitted locator, dimensions or page count, and marker key. It
   * replays only beside the retained payload, as a reference the step composer
   * projects, so the budgets measure the text without the `thumbnail` and never
   * the bytes (vision-media D6).
   */
  media: ToolMediaRef | undefined;
  /** The entry `media` names, when the reference is retained. */
  retained: { readonly key: string; readonly entry: RetainedMedia } | undefined;
}

interface PairCandidate {
  observation: ObservationPayload;
  cleared: ProjectedToolObservationPair;
  clearedSize: number;
  selected: ProjectedToolObservationPair;
  selectedSize: number;
}

export function normalizeToolObservationOutcome(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by `isBoundedToken(value, ...)` as a ternary test below (`isBoundedToken(...) ? value : fallback`); the validating call sits inside a conditional expression, a shape the structural exemption's `if`/`return` guard parse doesn't unwrap.
  value: unknown,
  fallback: string,
): string {
  return isBoundedToken(value, TOOL_OUTCOME_MAX_LENGTH, TOOL_OUTCOME_PATTERN)
    ? value
    : fallback;
}

function isBoundedToken(
  value: unknown,
  maxLength: number,
  pattern: RegExp,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    pattern.test(value)
  );
}

function isToolCallId(value: unknown): value is string {
  return isBoundedToken(value, TOOL_CALL_ID_MAX_LENGTH, TOOL_CALL_ID_PATTERN);
}

function isToolName(value: unknown): value is string {
  return isBoundedToken(value, TOOL_NAME_MAX_LENGTH, TOOL_NAME_PATTERN);
}

function isToolActivityPart(part: unknown): part is StoredToolPart {
  if (!isRecord(part)) return false;
  const value = part;
  return (
    typeof value.type === 'string' &&
    value.type.startsWith(TOOL_PART_PREFIX) &&
    isToolCallId(value.toolCallId) &&
    (value.state === 'output-available' || value.state === 'output-error')
  );
}

/** Whether a stored result's metadata marks it as terminated, not failed. */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- stored result metadata is untyped jsonb, and the two `isRecord` guards inside parse each level before it is read.
export function isCancelledMetadata(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.llame)) return false;
  return value.llame.cancelled === true;
}

function resolveOutcome(part: StoredToolPart): string {
  const fallback =
    part.state === 'output-available'
      ? 'success'
      : isCancelledMetadata(part.resultProviderMetadata)
        ? 'cancelled'
        : 'error';
  return normalizeToolObservationOutcome(part.outcome, fallback);
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- native payloads are persisted as unknown tool-part output; the native branch delegates to its JSON serializer and the legacy branch preserves the existing string/JSON handling.
function serializePayload(value: unknown, native: boolean): string {
  if (native) return serializeNativeModelOutput(value);
  if (isString(value)) return value;
  return JSON.stringify(value ?? null) ?? 'null';
}

/** The tools whose model output is their own serialization, not JSON. */
export function isNativeToolName(toolName: string): boolean {
  return toolName === 'read' || toolName === 'edit' || toolName === 'write';
}

function resolveResultBody(
  part: StoredToolPart,
  native: boolean,
  hopRejection: boolean,
): string | null {
  if (part.state === 'output-available' && part.output !== undefined) {
    return serializePayload(part.output, native);
  }
  if (!isString(part.errorText) || part.errorText.length === 0) return null;
  const body = native
    ? serializeNativeModelOutput(part.errorText)
    : part.errorText;
  // The fixed hop message points the model at `rejectedUrl`, which the stored
  // part keeps beside its error: re-attach the stored locator to the body the
  // model reads — never to the message itself — so a target refused on an
  // earlier turn stays identifiable on every turn that replays that part. The
  // part must still be the native `read` tool's hop rejection and the stored
  // value the exact locator `rejectedHopUrl` writes, or nothing is attached.
  const rejectedUrl = part.errorRejectedUrl;
  return hopRejection && isRejectedHopUrl(rejectedUrl)
    ? `${body}\nrejectedUrl: ${rejectedUrl}`
    : body;
}

function resultText(outcome: string, body: string | null): string {
  return sanitizeAuthoredText(
    renderToolOutputUntrusted({
      outcome,
      payload: body,
      hasPayload: body !== null,
    }),
  );
}

function pairEnvelope(pair: ProjectedToolObservationPair): Array<ModelMessage> {
  return [
    { role: 'assistant', content: [pair.toolCallPart] },
    { role: 'tool', content: [pair.toolResultPart] },
  ];
}

function measureToolObservationPair(
  pair: ProjectedToolObservationPair,
): number {
  return JSON.stringify(pairEnvelope(pair)).length;
}

function makePair(
  observation: ObservationPayload,
  cleared: boolean,
): ProjectedToolObservationPair {
  return {
    partIndex: observation.partIndex,
    toolCallPart: {
      type: 'tool-call',
      toolCallId: observation.toolCallId,
      toolName: observation.toolName,
      input: cleared ? {} : (observation.input ?? {}),
    },
    toolResultPart: {
      type: 'tool-result',
      toolCallId: observation.toolCallId,
      toolName: observation.toolName,
      output: toolResultOutput(
        resultText(
          cleared ? observation.clearedOutcome : observation.outcome,
          cleared ? null : observation.resultBody,
        ),
        cleared ? undefined : observation.media,
      ),
    },
  };
}

function measureProjection(
  pairCount: number,
  pairSizeTotal: number,
  omittedCount: number,
): number {
  // Flattening `[assistant,tool]` pairs into one message array removes one
  // framing code unit per pair; outer framing and the omission marker add back.
  const pairMessagesSize = pairSizeTotal - pairCount;
  if (omittedCount > 0) {
    const omissionMessageSize = JSON.stringify({
      role: 'assistant',
      content: renderToolObservationOmission(omittedCount),
    }).length;
    return 2 + omissionMessageSize + pairMessagesSize;
  }
  return pairCount === 0 ? 2 : 1 + pairMessagesSize;
}

function incrementOmittedCount(count: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, count + 1);
}

type BoundingState = {
  omittedCount: number;
  omittedPartIndexes: Array<number>;
};

function recordOmission(state: BoundingState, partIndex: number): void {
  state.omittedCount = incrementOmittedCount(state.omittedCount);
  state.omittedPartIndexes.push(partIndex);
}

/** Pass 1: clear any candidate whose full call already exceeds the per-call limit. */
function clearOversizedCandidates(
  candidates: Array<PairCandidate>,
  state: BoundingState,
): void {
  for (const candidate of candidates) {
    if (candidate.selectedSize <= TOOL_REPLAY_CALL_LIMIT) {
      continue;
    }
    candidate.selected = candidate.cleared;
    candidate.selectedSize = candidate.clearedSize;
    if (candidate.selectedSize > TOOL_REPLAY_CALL_LIMIT) {
      recordOmission(state, candidate.observation.partIndex);
    }
  }
}

/** Pass 2: clear retained candidates (front to back) until the turn projection fits. */
function clearCandidatesUntilWithinLimit(
  retained: Array<PairCandidate>,
  retainedSize: number,
  state: BoundingState,
): number {
  let size = retainedSize;
  if (
    measureProjection(retained.length, size, state.omittedCount) <=
    TOOL_REPLAY_TURN_LIMIT
  ) {
    return size;
  }
  for (const candidate of retained) {
    if (candidate.selected === candidate.cleared) continue;
    if (candidate.clearedSize < candidate.selectedSize) {
      size -= candidate.selectedSize - candidate.clearedSize;
      candidate.selected = candidate.cleared;
      candidate.selectedSize = candidate.clearedSize;
    }
    if (
      measureProjection(retained.length, size, state.omittedCount) <=
      TOOL_REPLAY_TURN_LIMIT
    ) {
      break;
    }
  }
  return size;
}

/** Pass 3: drop retained candidates from the front until the turn projection fits. */
function dropCandidatesUntilWithinLimit(
  retained: Array<PairCandidate>,
  retainedSize: number,
  state: BoundingState,
) {
  let start = 0;
  let size = retainedSize;
  while (
    start < retained.length &&
    measureProjection(retained.length - start, size, state.omittedCount) >
      TOOL_REPLAY_TURN_LIMIT
  ) {
    const dropped = retained[start];
    start += 1;
    size -= dropped.selectedSize;
    recordOmission(state, dropped.observation.partIndex);
  }
  return { retained: retained.slice(start), retainedSize: size };
}

function boundCandidates(
  candidates: Array<PairCandidate>,
  inheritedOmittedCount = 0,
) {
  const state: BoundingState = {
    omittedCount: inheritedOmittedCount,
    omittedPartIndexes: [],
  };
  clearOversizedCandidates(candidates, state);

  const withinCallLimit = candidates.filter(
    (candidate) => candidate.selectedSize <= TOOL_REPLAY_CALL_LIMIT,
  );
  const withinCallLimitSize = withinCallLimit.reduce(
    (total, candidate) => total + candidate.selectedSize,
    0,
  );

  const clearedSize = clearCandidatesUntilWithinLimit(
    withinCallLimit,
    withinCallLimitSize,
    state,
  );
  const { retained } = dropCandidatesUntilWithinLimit(
    withinCallLimit,
    clearedSize,
    state,
  );

  return {
    pairs: retained.map(({ selected }) => selected),
    omittedCount: state.omittedCount,
    omittedPartIndexes: state.omittedPartIndexes,
  };
}

function candidatesFromObservations(
  observations: Array<ObservationPayload>,
): Array<PairCandidate> {
  return observations.map((observation) => {
    const full = makePair(observation, false);
    const cleared = makePair(observation, true);
    const fullSize = measureToolObservationPair(full);
    const clearedSize = measureToolObservationPair(cleared);
    return {
      observation,
      cleared,
      clearedSize,
      selected: full,
      selectedSize: fullSize,
    };
  });
}

function projectionFromBounded(input: {
  pairs: Array<ProjectedToolObservationPair>;
  omittedCount: number;
  omittedPartIndexes: Array<number>;
  retainedMedia: ReadonlyMap<string, RetainedMedia>;
}): ToolObservationProjection {
  return {
    pairs: input.pairs,
    toolCallParts: input.pairs.map(({ toolCallPart }) => toolCallPart),
    toolResultParts: input.pairs.map(({ toolResultPart }) => toolResultPart),
    omittedCount: input.omittedCount,
    omissionPartIndex:
      input.omittedPartIndexes.length > 0
        ? Math.min(...input.omittedPartIndexes)
        : input.omittedCount > 0
          ? -1
          : null,
    retainedMedia: input.retainedMedia,
  };
}

/**
 * The media reference a settled `read` part replays, with the entry it names.
 * A `media://` result names the store; any other image or PDF result names its
 * retained bytes, and only when the part keeps a valid record — a legacy result
 * is not a reference at all.
 */
function readObservationRef(
  part: StoredToolPart,
  mediaKey: string,
): Pick<ObservationPayload, 'media' | 'retained'> {
  const named = mediaResultRef(part.output, submittedLocator(part.input));
  if (!isUnstoredMedia(named)) return { media: named, retained: undefined };
  const record = parseRetainedMedia(part.retainedMedia);
  const entry = record === undefined ? undefined : retainedEntry(record, named);
  return entry === undefined
    ? { media: undefined, retained: undefined }
    : {
        media: { ...named, key: mediaKey },
        retained: { key: mediaKey, entry },
      };
}

/** One stored tool part as the observation the projection works from. */
function storedObservation(
  part: MessagePart,
  partIndex: number,
  mediaKey: string,
): ObservationPayload | undefined {
  // eslint-disable-next-line anti-slop/no-known-value-widening -- stored parts are the open `MessagePart` union, so the guard must accept it whole and narrow it itself.
  if (!isToolActivityPart(part)) return undefined;
  const toolName = part.type.slice(TOOL_PART_PREFIX.length);
  if (!isToolName(toolName)) return undefined;
  const outcome = resolveOutcome(part);
  return {
    partIndex,
    toolCallId: part.toolCallId,
    toolName,
    outcome,
    clearedOutcome:
      Object.hasOwn(PARTIAL_RESULT_TOOL_PARTS, part.type) &&
      part.state === 'output-available' &&
      outcome === 'success' &&
      isRecord(part.output) &&
      part.output.status === 'success' &&
      part.output.complete === false
        ? 'incomplete'
        : outcome,
    input: part.input,
    resultBody: resolveResultBody(
      part,
      isNativeToolName(toolName),
      isHopRejection(toolName, outcome),
    ),
    ...(toolName === READ_TOOL_NAME && part.state === 'output-available'
      ? readObservationRef(part, mediaKey)
      : { media: undefined, retained: undefined }),
  };
}

/** The retained entries the given observations name, keyed by marker. */
function retainedEntriesOf(
  observations: ReadonlyArray<ObservationPayload>,
): ReadonlyMap<string, RetainedMedia> {
  return new Map(
    observations.flatMap(({ retained }) =>
      retained === undefined ? [] : [[retained.key, retained.entry] as const],
    ),
  );
}

/** A kept part as its unbudgeted call and result pair, with its media. */
type StoredToolObservation = {
  readonly pair: ProjectedToolObservationPair;
  /** The reference its result names, when the part keeps the bytes. */
  readonly media: ToolMediaRef | undefined;
  /** The entry `media` names, under the key of the marker that names it. */
  readonly retained:
    | { readonly key: string; readonly entry: RetainedMedia }
    | undefined;
};

/**
 * One stored tool part as its model-facing call and result pair, unbudgeted:
 * the Continue projection sends every kept result the way the live loop sent
 * it (turn-actions D6), so it shares this file's serialization instead of the
 * later-turn projection's clearing and omission. `mediaKey` is the marker key
 * the Continue projection loads the part's retained bytes under. Undefined for
 * a part that is not a settled tool part.
 */
export function projectStoredToolPart(
  part: MessagePart,
  partIndex: number,
  mediaKey: string,
): StoredToolObservation | undefined {
  const observation = storedObservation(part, partIndex, mediaKey);
  if (observation === undefined) return undefined;
  return {
    pair: makePair(observation, false),
    media: observation.media,
    retained: observation.retained,
  };
}

/**
 * `parts` as the later-turn projection, with `messageId` naming the row its
 * retained markers load their bytes under.
 */
export function projectToolObservations(
  parts: Array<MessagePart>,
  messageId: string,
): ToolObservationProjection | null {
  const observations = parts.flatMap((part, partIndex) => {
    const observation = storedObservation(
      part,
      partIndex,
      storedToolPartMediaKey(messageId, partIndex),
    );
    return observation === undefined ? [] : [observation];
  });
  if (observations.length === 0) return null;
  return projectionFromBounded({
    ...boundCandidates(candidatesFromObservations(observations)),
    retainedMedia: retainedEntriesOf(observations),
  });
}

export { neutralizeToolResult } from './tool-observation-neutralizer';
