/**
 * Provider-portable replay of persisted tool observations.
 *
 * One stored tool part becomes the call and its matched result, as the live
 * loop sent them (`turn-replay`): the call keeps the stored input and the
 * provider metadata of the live call, and the result is the one rendering that
 * `tool-result-rendering` makes — the live builder's output, or the SDK's own
 * error text for a call that the AI SDK refused before llame ran it (proposal
 * A8). Replay clears no payload and drops no pair, because a checkpoint is the
 * only boundary (`tool-replay` D2).
 */

import type {
  ProviderMetadata,
  ToolCallPart as SdkToolCallPart,
  ToolResultPart as SdkToolResultPart,
} from 'ai';

import { isRejectedHopUrl } from '../tools/permissions/messages';
import { modelToolOutput, renderToolResultForModel } from '../tools/model-text';
import { type ToolResult } from '../tools/types';
import type { SdkRefusal } from '../models/model-client';
import {
  isRecord,
  isString,
  neutralizeReservedDelimiters,
} from '@workspace/runtime-safety';
import type { MessagePart } from './context-builder';
import {
  isUnstoredMedia,
  mediaResultRef,
  submittedLocator,
  toolResultOutput,
  type ToolMediaRef,
  type ToolResultOutput,
} from '../media/epoch-admission';
import { parseRetainedMedia } from '../media/retained-media';
import { retainedEntry, type RetainedMedia } from '../media/attempt-media';

export const TOOL_PART_PREFIX = 'tool-';
export const TOOL_OUTCOME_MAX_LENGTH = 128;

const TOOL_CALL_ID_MAX_LENGTH = 1024;
const TOOL_NAME_MAX_LENGTH = 64;
const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const TOOL_OUTCOME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;

/** The native `read` tool — the one tool whose refused redirect hop reports a
 *  target (tools/web-read/http-client.ts). */
const READ_TOOL_NAME = 'read';

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
  /**
   * What the AI SDK itself put in the live step for a call it refused before
   * llame ran it (design D3, proposal A8): its error text and its form of the
   * input. Present only on a refused call, and the marker of one.
   */
  sdkRefusal?: unknown;
  outcome?: unknown;
  resultProviderMetadata?: unknown;
  /**
   * The opaque provider metadata the adapter attached to the live call (design
   * A7), stored once on the call and copied to the result of a call that ran,
   * as the SDK does.
   */
  providerMetadata?: unknown;
  /**
   * The retained bytes of an unstored `read`, stored beside the result and
   * never in model text (`media-attachments`). A part with no valid record is
   * not a media reference, so it replays as its result text.
   */
  retainedMedia?: unknown;
}

export interface ProjectedToolObservationPair {
  toolCallPart: SdkToolCallPart;
  toolResultPart: SdkToolResultPart;
  /**
   * The opaque provider metadata of the live call, sent back on the call and —
   * for a call that ran — on its result, when the model rule of
   * `reasoning-output` allows it.
   */
  providerMetadata: ProviderMetadata | undefined;
  /**
   * Whether the AI SDK refused the call before llame ran it (proposal A8). A
   * refused call's result is the SDK's error text and carries no provider
   * metadata, because the result the SDK synthesized carried none.
   */
  refused: boolean;
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

/**
 * The SDK's own account of a refused call, re-read from the untrusted part: a
 * record without a string error text, or without an input member at all, is
 * no refusal — the part then keeps llame's own error text alone.
 */
function storedRefusal(value: unknown): SdkRefusal | undefined {
  if (!isRecord(value)) return undefined;
  const errorText = value['errorText'];

  if (!isString(errorText) || !Object.hasOwn(value, 'input')) return undefined;

  return { errorText, input: value['input'] };
}

/**
 * The live call's opaque provider metadata, re-read from the untrusted part.
 * Only a record is accepted; llame never reads inside it.
 */
function storedProviderMetadata(value: unknown): ProviderMetadata | undefined {
  if (!isRecord(value)) return undefined;

  // SAFETY: the value is the adapter's own provider-metadata object as the
  // stored part keeps it; the check above only rules out a malformed or legacy
  // shape, and nothing reads inside it.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as ProviderMetadata;
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

/** The failure object a stored error part rebuilds: its stored outcome, error
 *  text, and — for the native `read` tool's refused hop — the refused locator
 *  it stored beside its error. */
function failureResult(
  part: StoredToolPart,
  outcome: string,
  hopRejection: boolean,
): ToolResult {
  // The fixed hop message points the model at `rejectedUrl`, which the stored
  // part keeps beside its error, so a target refused on an earlier turn stays
  // identifiable on every turn that replays that part. The part must still be
  // the native `read` tool's hop rejection and the stored value the exact
  // locator `rejectedHopUrl` writes, or the rebuilt result carries none.
  const rejectedUrl = part.errorRejectedUrl;

  return {
    status: 'error',
    type: outcome,
    message: part.errorText ?? '',
    ...(hopRejection && isRejectedHopUrl(rejectedUrl) && { rejectedUrl }),
  };
}

/**
 * The output a stored part rebuilds for the live builder: the result its
 * executor settled with, or the failure object that `tool-result-rendering`
 * rebuilds from the stored outcome, error text, and rejected locator. A part
 * that stored no output is a failure too, because no live success existed. A
 * legacy part stored a bare payload instead of a result object; it replays as
 * that text, through the same neutralizer every rendering uses.
 */
function storedOutput(
  part: StoredToolPart,
  toolName: string,
  outcome: string,
  media: ToolMediaRef | undefined,
): ToolResultOutput {
  if (part.state === 'output-available' && part.output !== undefined) {
    if (isRecord(part.output)) {
      return modelToolOutput(
        renderToolResultForModel(toolName, {
          ...part.output,
          status: 'success',
        }),
        media,
      );
    }

    return toolResultOutput(
      neutralizeReservedDelimiters(
        isString(part.output)
          ? part.output
          : (JSON.stringify(part.output) ?? 'null'),
      ),
      media,
    );
  }

  return modelToolOutput(
    renderToolResultForModel(
      toolName,
      failureResult(part, outcome, isHopRejection(toolName, outcome)),
    ),
    media,
  );
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
): Pick<StoredToolObservation, 'media' | 'retained'> {
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

/** One stored tool part as its model-facing call and result pair. */
export interface StoredToolObservation {
  readonly pair: ProjectedToolObservationPair;
  /** The reference its result names, when the part keeps the bytes. */
  readonly media: ToolMediaRef | undefined;
  /** The entry `media` names, under the key of the marker that names it. */
  readonly retained:
    | { readonly key: string; readonly entry: RetainedMedia }
    | undefined;
}

/**
 * One stored tool part as the call and result pair the live loop sent, with
 * the retained entry its media marker names. `mediaKey` is the key the request
 * that replays it loads the part's retained bytes under. Undefined for a part
 * that is not a settled tool part.
 */
export function projectStoredToolPart(
  part: MessagePart,
  mediaKey: string,
): StoredToolObservation | undefined {
  // eslint-disable-next-line anti-slop/no-known-value-widening -- stored parts are the open `MessagePart` union, so the guard must accept it whole and narrow it itself.
  if (!isToolActivityPart(part)) return undefined;
  const toolName = part.type.slice(TOOL_PART_PREFIX.length);

  if (!isToolName(toolName)) return undefined;
  const outcome = resolveOutcome(part);

  const { media, retained } =
    toolName === READ_TOOL_NAME && part.state === 'output-available'
      ? readObservationRef(part, mediaKey)
      : { media: undefined, retained: undefined };

  const refusal = storedRefusal(part.sdkRefusal);

  return {
    pair: {
      toolCallPart: {
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName,
        input: refusal === undefined ? (part.input ?? {}) : refusal.input,
      },
      toolResultPart: {
        type: 'tool-result',
        toolCallId: part.toolCallId,
        toolName,
        output:
          refusal === undefined
            ? storedOutput(part, toolName, outcome, media)
            : { type: 'error-text', value: refusal.errorText },
      },
      providerMetadata: storedProviderMetadata(part.providerMetadata),
      refused: refusal !== undefined,
    },
    media,
    retained,
  };
}
