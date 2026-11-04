/**
 * The Continue Run's kept-part records (turn-actions D5/D11): which parts of
 * the source reply a Continue Run starts from, the model step each kept part
 * belongs to, and the step offset of the Run's own parts.
 *
 * The request itself is `projectStoredReplyParts` of `context-builder.ts`: a
 * Continue Run sends the same parts through the same projection a later turn
 * and a compaction request use (design D11). This module therefore selects and
 * numbers the kept parts only; it renders no message.
 *
 * A kept part carries the `step` it recorded. A reply stored before parts
 * recorded one keeps its numbers in the `steps` map of its own `run.continued`
 * event, which admission wrote on both sides of this change: continuing such a
 * reply reads that map, and admission numbers the source Run's own calls, after
 * the numbers it inherited, from its `tool.requested` events. Either way the
 * text and reasoning of a step follow its calls, so a continued reply groups
 * the way the source Run's live step sent it.
 */

import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

import { isContextItemPart } from './context-item';
import {
  isReasoningPart,
  isTextPart,
  partStep,
  type MessagePart,
} from './context-builder';
import { TOOL_PART_PREFIX } from './tool-observation-part';

/**
 * The `toolCallId -> stepNumber` map of the kept calls that need a number
 * derived for them: a lookup table, handed from admission to `withKeptSteps`,
 * not a stored wire shape. A call whose part already records its step is not
 * in it.
 */
export type KeptStepNumbers = Record<string, number>;

/**
 * The kept parts of a Continue Run, as its `run.continued` event stores them,
 * each kept call and the text and reasoning of its step numbered. A stored
 * event whose parts predate `step` keeps its numbers in the event's own `steps`
 * map, which `continueStateFromEvents` stamps onto them.
 */
export type ContinueState = { readonly parts: ReadonlyArray<MessagePart> };

/** One model event of the Run a `run.continued` payload names. */
export type ContinuedEvent = {
  readonly eventType: string;
  readonly payload: unknown;
};

/**
 * The Continue state a Run's event log starts from, or undefined for a Run
 * that did not continue one. Stored jsonb is untrusted on the way back in, so
 * an unreadable payload yields no state rather than a mangled request.
 */
export function continueStateFromEvents(
  events: ReadonlyArray<ContinuedEvent>,
): ContinueState | undefined {
  const event = events.find(
    (candidate) => candidate.eventType === 'run.continued',
  );
  const payload = event?.payload;
  if (!isRecord(payload) || !Array.isArray(payload['parts'])) return undefined;
  // SAFETY: `run.continued` stores the reply's own JSONB parts array, written by
  // `createRunForMessage` from `continueKeptParts`; nothing here narrows them,
  // because the projection re-validates every part it reads.
  const parts = payload['parts'] as ReadonlyArray<MessagePart>;
  // An event written before the parts carried their own step records the
  // numbers in its `steps` map — already offset by the chain it inherited — so
  // a Run admitted then keeps its boundaries and its offset after the deploy.
  const numbers = storedStepNumbers(payload['steps']);
  return {
    parts: numbers === undefined ? parts : withKeptSteps(parts, numbers),
  };
}

/** The numbers a stored `steps` map records, or undefined when it has none. */
function storedStepNumbers(value: unknown): KeptStepNumbers | undefined {
  if (!isRecord(value)) return undefined;
  const recorded = Object.entries(value).filter(
    (entry): entry is [string, number] => isNumber(entry[1]),
  );
  return recorded.length === 0 ? undefined : Object.fromEntries(recorded);
}

/**
 * The first step number a Continue Run's own parts use: one after the highest
 * kept step (design D5), so the steps of the continued reply stay separate and
 * in order. A Run that continues nothing, or keeps no numbered part, starts at
 * 0. A kept part carries the step it was stored or stamped with.
 */
export function continueStepOffset(state: ContinueState | undefined): number {
  if (state === undefined) return 0;
  let offset = 0;
  for (const part of state.parts) {
    const step = partStep(part);
    if (step !== undefined) offset = Math.max(offset, step + 1);
  }
  return offset;
}

/** The `toolCallId` a stored part carries, when it is a tool part. */
function storedToolCallId(part: unknown): string | undefined {
  if (!isRecord(part)) return undefined;
  const type = part['type'];
  const toolCallId = part['toolCallId'];
  return isString(type) &&
    type.startsWith(TOOL_PART_PREFIX) &&
    isString(toolCallId)
    ? toolCallId
    : undefined;
}

/** The `toolCallId` of each kept settled tool part, in stored order. */
function keptToolCallIds(parts: ReadonlyArray<MessagePart>): Array<string> {
  return parts.flatMap((part) => storedToolCallId(part) ?? []);
}

/**
 * The step of one kept call: the number its part records, or the number the
 * derived record holds for it. Undefined for a call no record numbers.
 */
function callStep(
  part: MessagePart,
  toolCallId: string | undefined,
  numbers: KeptStepNumbers,
): number | undefined {
  if (toolCallId === undefined) return undefined;
  const recorded = partStep(part);
  if (recorded !== undefined) return recorded;
  if (!Object.hasOwn(numbers, toolCallId)) return undefined;
  const derived = numbers[toolCallId];
  return isNumber(derived) ? derived : undefined;
}

/**
 * The step of the call on each side of each stored index: the nearest call
 * before and after it, with no number reaching across a call no record numbers,
 * so an unnumbered call keeps its parts in the consecutive rule.
 */
function adjacentCallSteps(
  steps: ReadonlyArray<number | undefined>,
  callIds: ReadonlyArray<string | undefined>,
) {
  const before: Array<number | undefined> = [];
  let previous: number | undefined;
  for (const [index, step] of steps.entries()) {
    before.push(previous);
    if (callIds[index] !== undefined) previous = step;
  }
  const after: Array<number | undefined> = steps.map(() => undefined);
  let next: number | undefined;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    after[index] = next;
    if (callIds[index] !== undefined) next = steps[index];
  }
  return { before, after };
}

/**
 * The kept parts with the step number of each part a source reply stored
 * without one (design D5): its calls from the numbers admission derived, and
 * its text and reasoning from the call they lead into or follow, so a continued
 * reply groups the way the source Run's live step sent it. A call directly
 * after a call joins its step, because one response sent them together. A part
 * that already records a step keeps it, a part no record numbers keeps none,
 * and the stored source is never mutated.
 */
export function withKeptSteps(
  parts: ReadonlyArray<MessagePart>,
  numbers: KeptStepNumbers,
): Array<MessagePart> {
  const callIds = parts.map((part) => storedToolCallId(part));
  const calls = parts.map((part, index) =>
    callStep(part, callIds[index], numbers),
  );
  const { before, after } = adjacentCallSteps(calls, callIds);
  return parts.map((part, index) => {
    if (partStep(part) !== undefined) return part;
    const own = calls[index];
    if (own !== undefined) return { ...part, step: own };
    if (!isTextPart(part) && !isReasoningPart(part)) return part;
    const step = after[index] ?? before[index];
    return step === undefined ? part : { ...part, step };
  });
}

/** The kept calls among `parts` whose stored part records a step. */
function recordedCallSteps(
  parts: ReadonlyArray<MessagePart>,
  kept: ReadonlySet<string>,
): Map<string, number> {
  const steps = new Map<string, number>();
  for (const part of parts) {
    const toolCallId = storedToolCallId(part);
    const step = partStep(part);
    if (
      toolCallId !== undefined &&
      step !== undefined &&
      kept.has(toolCallId)
    ) {
      steps.set(toolCallId, step);
    }
  }
  return steps;
}

/**
 * The step number admission derives for each kept call of the source reply:
 * the numbers the source Run inherited from the Run it continued, which only
 * its own `run.continued` event holds, and the numbers its `tool.requested`
 * events recorded for the calls it made itself, after those. A call whose
 * stored part already records a step is not returned, because the part is its
 * number.
 */
export function continuedCallSteps(input: {
  keptParts: ReadonlyArray<MessagePart>;
  /** The source Run's own `run.continued` state, when it continued a Run. */
  sourceContinued?: ContinueState;
  /** The source Run's `tool.requested` events. */
  sourceEvents: ReadonlyArray<ContinuedEvent>;
}): KeptStepNumbers {
  const kept = new Set(keptToolCallIds(input.keptParts));
  const onParts = recordedCallSteps(input.keptParts, kept);
  const inherited = recordedCallSteps(input.sourceContinued?.parts ?? [], kept);
  const steps = new Map<string, number>();
  for (const [toolCallId, step] of inherited) {
    if (!onParts.has(toolCallId)) steps.set(toolCallId, step);
  }
  // A chained Continue renumbers: the steps its source Run itself continued
  // keep their numbering, and the steps that Run made follow them, so two
  // calls from different Runs never share a step.
  const offset = Math.max(
    continueStepOffset({ parts: input.keptParts }),
    continueStepOffset(input.sourceContinued),
  );
  for (const event of input.sourceEvents) {
    if (event.eventType !== 'tool.requested' || !isRecord(event.payload)) {
      continue;
    }
    const toolCallId = event.payload['toolCallId'];
    const stepNumber = event.payload['stepNumber'];
    if (
      !isString(toolCallId) ||
      !isNumber(stepNumber) ||
      !kept.has(toolCallId) ||
      onParts.has(toolCallId) ||
      inherited.has(toolCallId)
    ) {
      continue;
    }
    steps.set(toolCallId, offset + stepNumber);
  }
  return Object.fromEntries(steps);
}

/**
 * The kept parts of `parts`, keeping only the parts a Continue Run's own
 * request names: a kept context item belongs to the earlier Run that authored
 * it, and the finalizer must not place it twice.
 */
export function ownSnapshotParts(
  parts: ReadonlyArray<unknown>,
  runId: string,
): Array<unknown> {
  return parts.filter(
    (part) => !isContextItemPart(part) || part.data.runId === runId,
  );
}
