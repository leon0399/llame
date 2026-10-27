/**
 * The Continue projection (turn-actions D5/D6): the kept parts of a source
 * reply, grouped by the model response that produced them, as the messages a
 * Continue Run's first request carries after the history through its trigger.
 *
 * A kept step is the set of tool calls one model response made, with the
 * reasoning and text parts that preceded them. Each `tool.requested` event
 * carries the AI SDK `stepNumber` and `run.continued` carries the resulting
 * `toolCallId -> stepNumber` map, so two sequential steps with no text between
 * them stay two steps. A Run from before step numbers carries none and falls
 * back to "a run of consecutive tool parts is one step".
 *
 * The projection deliberately bypasses the later-turn replay of
 * `tool-observation-part.ts`: it applies no budget, so every kept result keeps
 * its stored model-facing output, and the results are rebuilt the way the live
 * loop built them. Only tool parts of the source Run's own model calls are
 * here — a cap marker and an unknown part contribute nothing.
 */

import type {
  AssistantContent,
  JSONValue,
  ModelMessage,
  ToolCallPart,
  ToolResultPart,
} from 'ai';

import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import { z } from 'zod';
import { serializeNativeModelOutput } from '@workspace/native-file-tools';

import { isContextItemPart, type ContextItemPart } from './context-item';
import {
  isReasoningPart,
  isTextPart,
  toPromptReasoningPart,
  type MessagePart,
  type PromptReasoningPart,
} from './context-builder';
import {
  mediaResultRef,
  submittedLocator,
  toolResultOutput,
} from '../media/epoch-admission';
import { neutralizeToolResult } from './tool-observation-neutralizer';
import {
  isNativeToolName,
  projectStoredToolPart,
  type ProjectedToolObservationPair,
} from './tool-observation-part';
import type { ToolResult } from '../tools/types';

/**
 * The `toolCallId -> stepNumber` map `run.continued` stores: a wire shape
 * written into JSONB by admission, not a lookup table. A source Run from before
 * step numbers stores an empty one.
 */
export type KeptStepNumbers = Record<string, number>;

/** The JSON value the SDK's tool output accepts, validated at this boundary. */
const jsonSchema = z.json();

/**
 * The kept parts of a Continue Run, as its `run.continued` event stores them,
 * with the step each kept call belongs to.
 */
export type ContinueState = {
  readonly parts: ReadonlyArray<MessagePart>;
  /**
   * `toolCallId -> stepNumber` of the source Run's `tool.requested` events.
   * Empty for a source Run recorded before step numbers existed, which the
   * projection reads as "a run of consecutive tool parts is one step".
   */
  readonly stepNumbers: ReadonlyMap<string, number>;
  /**
   * The model-facing outcome each kept call recorded in the source Run's
   * `tool.completed` events, which is what the live loop sent. Absent for a
   * call whose source Run recorded none, which then rebuilds from its stored
   * part the way a later turn does.
   */
  readonly results: ReadonlyMap<string, ToolResult>;
};

/** One kept step: its reasoning, its text, its calls, and the results after them. */
type AssistantContentPart = Extract<
  Extract<AssistantContent, ReadonlyArray<unknown>>[number],
  { type: 'reasoning' | 'text' | 'tool-call' }
>;

type KeptStep = {
  readonly reasoning: Array<PromptReasoningPart>;
  readonly text: Array<string>;
  readonly calls: Array<ToolCallPart>;
  readonly results: Array<ToolResultPart>;
  /** The kept in-Run items stored after this step's tool parts, in order. */
  readonly items: Array<string>;
};

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
  const steps = payload['steps'];
  const stepNumbers = new Map<string, number>();
  if (isRecord(steps)) {
    for (const [toolCallId, stepNumber] of Object.entries(steps)) {
      if (isNumber(stepNumber)) stepNumbers.set(toolCallId, stepNumber);
    }
  }
  const recorded = payload['results'];
  const results = new Map<string, ToolResult>();
  if (isRecord(recorded)) {
    for (const [toolCallId, result] of Object.entries(recorded)) {
      const parsed = toolResultFromRecord(result);
      if (parsed !== undefined) results.set(toolCallId, parsed);
    }
  }
  // SAFETY: `run.continued` stores the reply's own JSONB parts array, written by
  // `createRunForMessage` from `continueKeptParts`; nothing here narrows them,
  // because the projection re-validates every part it reads.
  return {
    parts: payload['parts'] as ReadonlyArray<MessagePart>,
    stepNumbers,
    results,
  };
}

/**
 * A stored `ToolResult`, re-read from the untrusted `run.continued` payload: a
 * success record as stored, or the exact error shape the live loop sent.
 */
function toolResultFromRecord(value: unknown): ToolResult | undefined {
  if (!isRecord(value)) return undefined;
  const status = value['status'];
  if (status === 'success') return { ...value, status };
  const type = value['type'];
  const message = value['message'];
  if (status !== 'error' || !isString(type) || !isString(message)) {
    return undefined;
  }
  const rejectedUrl = value['rejectedUrl'];
  return {
    status,
    type,
    message,
    ...(isString(rejectedUrl) && { rejectedUrl }),
  };
}

/**
 * The output one kept call replays, built the way the live loop built it: a
 * native file tool sends its serialized result and its media reference; every
 * other tool sends its neutralized result as JSON. No untrusted framing, no
 * budget — the model reads exactly what the source Run sent it.
 */
function keptToolOutput(
  toolName: string,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- the call's stored input, which the media locator reader parses before use.
  input: unknown,
  result: ToolResult,
): ToolResultPart['output'] {
  return isNativeToolName(toolName)
    ? toolResultOutput(
        serializeNativeModelOutput(result),
        mediaResultRef(result, submittedLocator(input)),
      )
    : { type: 'json', value: jsonOutputOf(neutralizeToolResult(result)) };
}

/**
 * A neutralized result as the SDK's json output: the value the live loop handed
 * the SDK, which serializes it the same way.
 */
function jsonOutputOf(result: ToolResult): JSONValue {
  // The SDK serializes the value the live loop returned, so the kept result
  // takes the same JSON form rather than a hand-built one.
  return jsonSchema.parse(result);
}

/** One kept call's pair: its call as stored, its result as the live loop sent it. */
function keptPair(
  part: MessagePart,
  partIndex: number,
  results: ReadonlyMap<string, ToolResult>,
): ProjectedToolObservationPair | undefined {
  const stored = projectStoredToolPart(part, partIndex);
  if (stored === undefined) return undefined;
  const { toolCallPart } = stored;
  const result = results.get(toolCallPart.toolCallId);
  if (result === undefined) return stored;
  return {
    partIndex,
    toolCallPart,
    toolResultPart: {
      type: 'tool-result',
      toolCallId: toolCallPart.toolCallId,
      toolName: toolCallPart.toolName,
      output: keptToolOutput(toolCallPart.toolName, toolCallPart.input, result),
    },
  };
}

function newStep(): KeptStep {
  return { reasoning: [], text: [], calls: [], results: [], items: [] };
}

function stepHasContent(step: KeptStep): boolean {
  return (
    step.reasoning.length > 0 ||
    step.text.length > 0 ||
    step.calls.length > 0 ||
    step.items.length > 0
  );
}

/** Appends a text, reasoning, or item part to `step`, or reports none. */
function appendContent(part: MessagePart, step: KeptStep): boolean {
  if (isReasoningPart(part)) {
    step.reasoning.push(toPromptReasoningPart(part));
    return true;
  }
  if (isTextPart(part)) {
    step.text.push(part.text);
    return true;
  }
  if (!isContextItemPart(part)) return false;
  const text: ContextItemPart['data']['text'] = part.data.text;
  if (text !== undefined && text.length > 0) step.items.push(text);
  return true;
}

/**
 * Whether this call starts a new step. An unnumbered call never does, so a
 * legacy run of consecutive calls stays one step; an item closes its step, and
 * a numbered call starts one when the open step holds calls of another response
 * (or of an unnumbered one).
 */
function startsNewStep(
  step: {
    readonly openStepNumber: number | undefined;
    readonly openCallCount: number;
    readonly openItemCount: number;
  },
  callStepNumber: number | undefined,
): boolean {
  if (step.openItemCount > 0) return true;
  return (
    step.openCallCount > 0 &&
    callStepNumber !== undefined &&
    callStepNumber !== step.openStepNumber
  );
}

/**
 * Groups the kept parts into steps. A text or reasoning part after the open
 * step's calls begins the next response, and so does a call whose recorded step
 * differs from the open one — or one that follows an item, whichever Run
 * recorded it.
 */
function groupSteps(state: ContinueState): Array<KeptStep> {
  const steps: Array<KeptStep> = [];
  let current = newStep();
  let currentStepNumber: number | undefined;

  const flush = (): void => {
    if (stepHasContent(current)) steps.push(current);
    current = newStep();
    currentStepNumber = undefined;
  };

  for (const [index, part] of state.parts.entries()) {
    const pair = keptPair(part, index, state.results);
    if (pair === undefined) {
      if (
        (isTextPart(part) || isReasoningPart(part)) &&
        current.calls.length > 0
      ) {
        flush();
      }
      appendContent(part, current);
      continue;
    }
    const stepNumber = state.stepNumbers.get(pair.toolCallPart.toolCallId);
    const opensNext = startsNewStep(
      {
        openStepNumber: currentStepNumber,
        openCallCount: current.calls.length,
        openItemCount: current.items.length,
      },
      stepNumber,
    );
    if (opensNext) flush();
    if (stepNumber !== undefined) currentStepNumber = stepNumber;
    current.calls.push(pair.toolCallPart);
    current.results.push(pair.toolResultPart);
  }
  flush();
  return steps;
}

/**
 * One assistant message with the step's reasoning, its text, and all its
 * calls, then one message with their results, then the kept in-Run items in
 * their stored positions as user-role text — the shape the live loop sent.
 */
function stepMessages(step: KeptStep): Array<ModelMessage> {
  const content: Array<AssistantContentPart> = [
    ...step.reasoning,
    ...(step.text.length > 0
      ? [{ type: 'text' as const, text: step.text.join('\n') }]
      : []),
    ...step.calls,
  ];
  const messages: Array<ModelMessage> = [
    // A step whose only content is an item carries no assistant turn.
    ...(content.length > 0 ? [{ role: 'assistant' as const, content }] : []),
    ...(step.results.length > 0
      ? [{ role: 'tool' as const, content: step.results }]
      : []),
    ...step.items.map((text): ModelMessage => ({
      role: 'user',
      content: [{ type: 'text', text }],
    })),
  ];
  return messages;
}

/**
 * The kept parts as the messages a Continue Run sends after the history
 * through its trigger. Empty when nothing was kept.
 */
export function projectContinueParts(
  state: ContinueState,
): Array<ModelMessage> {
  return groupSteps(state).flatMap(stepMessages);
}

/**
 * What a Continue Run records about the kept calls of one source reply: the
 * step each call belongs to and the model-facing result the source Run
 * recorded for it.
 *
 * A chained Continue renumbers: the steps its source Run itself continued keep
 * their numbering, and the steps that Run made follow them, so two calls from
 * different Runs never share a step. A source Run from before step numbers
 * recorded none, and the projection takes its consecutive-call fallback.
 */
export type ContinuedRecords = {
  readonly steps: KeptStepNumbers;
  readonly results: Record<string, ToolResult>;
};

/** The `toolCallId` of each kept settled tool part, in stored order. */
function keptToolCallIds(parts: ReadonlyArray<MessagePart>): Array<string> {
  return parts.flatMap((part) => {
    if (!isRecord(part)) return [];
    const type = part['type'];
    const toolCallId = part['toolCallId'];
    return isString(type) && type.startsWith('tool-') && isString(toolCallId)
      ? [toolCallId]
      : [];
  });
}

/** The steps a source reply already numbered, keyed by tool call. */
function chainedSteps(
  sourceContinued: ContinueState | undefined,
  kept: ReadonlySet<string>,
): Map<string, number> {
  const steps = new Map<string, number>();
  for (const [toolCallId, stepNumber] of sourceContinued?.stepNumbers ?? []) {
    if (kept.has(toolCallId)) steps.set(toolCallId, stepNumber);
  }
  return steps;
}

/** The model-facing result recorded for each kept call, from its completion. */
function recordedResults(
  events: ReadonlyArray<ContinuedEvent>,
  kept: ReadonlySet<string>,
): ContinuedRecords['results'] {
  const results: ContinuedRecords['results'] = {};
  for (const event of events) {
    if (event.eventType !== 'tool.completed' || !isRecord(event.payload)) {
      continue;
    }
    const toolCallId = event.payload['toolCallId'];
    if (!isString(toolCallId) || !kept.has(toolCallId)) continue;
    const result = toolResultFromRecord(event.payload['output']);
    if (result !== undefined) results[toolCallId] = result;
  }
  return results;
}

/** The step map of the kept calls the source Run itself made, after its chain. */
function ownSteps(
  events: ReadonlyArray<ContinuedEvent>,
  kept: ReadonlySet<string>,
  chained: ReadonlyMap<string, number>,
): KeptStepNumbers {
  const offset = chained.size === 0 ? 0 : Math.max(...chained.values()) + 1;
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
    steps[toolCallId] = offset + stepNumber;
  }
  return steps;
}

/**
 * The records a Continue Run stores for the kept parts of `input.keptParts`,
 * from the source Run's own events and the records its own admission wrote.
 */
export function continuedRecords(input: {
  keptParts: ReadonlyArray<MessagePart>;
  /** The source Run's `run.continued` state, when it continued a Run itself. */
  sourceContinued?: ContinueState;
  /** The source Run's `tool.requested` and `tool.completed` events. */
  sourceEvents: ReadonlyArray<ContinuedEvent>;
}): ContinuedRecords {
  const kept = new Set(keptToolCallIds(input.keptParts));
  const chained = chainedSteps(input.sourceContinued, kept);
  return {
    steps: ownSteps(input.sourceEvents, kept, chained),
    results: recordedResults(input.sourceEvents, kept),
  };
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
