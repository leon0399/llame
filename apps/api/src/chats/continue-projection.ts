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
 * A kept call carries the `step` its part recorded. A source reply stored
 * before parts recorded one has its kept calls numbered from the Run's
 * `tool.requested` events at admission, and the text and reasoning of those
 * steps numbered with them, so the continued reply keeps its boundaries.
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
 * The `toolCallId -> stepNumber` map admission stamps onto the kept parts of a
 * Continue Run: a wire shape, not a lookup table.
 */
export type KeptStepNumbers = Record<string, number>;

/**
 * The kept parts of a Continue Run, as its `run.continued` event stores them.
 * Older events also hold `steps` and `results` maps written before the parts
 * carried both; nothing reads them, and `parts` is the one source.
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
  return { parts: payload['parts'] as ReadonlyArray<MessagePart> };
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

/** The nearest numbered call on each side of each stored index. */
type CallStepsAround = {
  readonly before: ReadonlyArray<number | undefined>;
  readonly after: ReadonlyArray<number | undefined>;
};

/** The step of one kept call: the number its part records, or the number the
 * source Run's events recorded for it. Undefined for a call no record numbers. */
function callStep(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- a stored part is untrusted jsonb; `storedToolCallId` and `partStep` parse it.
  part: unknown,
  steps: KeptStepNumbers,
): number | undefined {
  const toolCallId = storedToolCallId(part);
  if (toolCallId === undefined || !isRecord(part)) return undefined;
  return partStep(part) ?? steps[toolCallId];
}

function adjacentCallSteps(
  calls: ReadonlyArray<number | undefined>,
): CallStepsAround {
  const before: Array<number | undefined> = [];
  let previous: number | undefined;
  for (const step of calls) {
    before.push(previous);
    previous = step ?? previous;
  }
  const after: Array<number | undefined> = calls.map(() => undefined);
  let next: number | undefined;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    after[index] = next;
    next = calls[index] ?? next;
  }
  return { before, after };
}

/**
 * The step an unnumbered text or reasoning part belongs to: the step of the
 * calls around it. A part between calls of the same step stays in that step;
 * a part between steps leads into the next one, as the consecutive rule places
 * text after a step's calls. With no following call, the preceding step holds
 * it.
 */
function keptContentStep(
  before: number | undefined,
  after: number | undefined,
): number | undefined {
  return before !== undefined && before === after ? before : (after ?? before);
}

/**
 * The kept parts with the step number of each part a source reply stored
 * without one (design D5): its calls from the source Run's `tool.requested`
 * events, and its text and reasoning from the calls of their step, so a
 * continued reply groups the way the source Run's live step sent it. A part
 * that already records a step keeps it, a part no record numbers keeps none,
 * and the stored source is never mutated.
 */
export function withKeptSteps(
  parts: ReadonlyArray<unknown>,
  steps: KeptStepNumbers,
): Array<unknown> {
  const calls = parts.map((part) => callStep(part, steps));
  const { before, after } = adjacentCallSteps(calls);
  return parts.map((part, index) => {
    if (!isRecord(part) || partStep(part) !== undefined) return part;
    const own = calls[index];
    if (own !== undefined) return { ...part, step: own };
    if (!isTextPart(part) && !isReasoningPart(part)) return part;
    const step = keptContentStep(before[index], after[index]);
    return step === undefined ? part : { ...part, step };
  });
}

/** The steps a source reply already numbered, keyed by tool call. */
function chainedSteps(
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

/** One after the highest number in `steps`, or 0 when there is none. */
function nextStep(steps: Iterable<number>): number {
  let highest = -1;
  for (const step of steps) highest = Math.max(highest, step);
  return highest + 1;
}

/** The step map of the kept calls the source Run itself made, after its chain. */
function ownSteps(
  events: ReadonlyArray<ContinuedEvent>,
  kept: ReadonlySet<string>,
  chained: ReadonlyMap<string, number>,
): KeptStepNumbers {
  const offset = nextStep(chained.values());
  const steps: KeptStepNumbers = Object.fromEntries(chained);
  for (const event of events) {
    if (event.eventType !== 'tool.requested' || !isRecord(event.payload)) {
      continue;
    }
    const toolCallId = event.payload['toolCallId'];
    const stepNumber = event.payload['stepNumber'];
    if (
      !isString(toolCallId) ||
      !isNumber(stepNumber) ||
      !kept.has(toolCallId) ||
      chained.has(toolCallId)
    ) {
      continue;
    }
    // A chained Continue renumbers: the steps its source Run itself continued
    // keep their numbering, and the steps that Run made follow them, so two
    // calls from different Runs never share a step.
    steps[toolCallId] = offset + stepNumber;
  }
  return steps;
}

/**
 * The step number of each kept call, from the steps the kept parts already
 * record and the source Run's own `tool.requested` events. Admission stamps
 * returned numbers onto the kept parts, then the projection groups by them.
 */
export function continuedRecords(input: {
  keptParts: ReadonlyArray<MessagePart>;
  /** The source Run's `tool.requested` events. */
  sourceEvents: ReadonlyArray<ContinuedEvent>;
}): KeptStepNumbers {
  const kept = new Set(keptToolCallIds(input.keptParts));
  return ownSteps(
    input.sourceEvents,
    kept,
    chainedSteps(input.keptParts, kept),
  );
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
