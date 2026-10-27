/**
 * The Continue projection (turn-actions D5/D6): the kept parts of a source
 * reply, grouped by the model response that produced them, as the messages a
 * Continue Run's first request carries after the history through its trigger.
 *
 * A kept step is the set of tool calls one model response made, with the
 * reasoning and text parts that preceded them. From `api-continue` on, each
 * `tool.requested` event carries the AI SDK `stepNumber` and `run.continued`
 * carries the resulting `toolCallId -> stepNumber` map, so two sequential steps
 * with no text between them stay two steps. A source Run from before that
 * change carries no step numbers and falls back to "a run of consecutive tool
 * parts is one step".
 *
 * The projection deliberately bypasses the later-turn replay of
 * `tool-observation-part.ts`: it applies no budget, so every kept result keeps
 * its stored model-facing output, and the results are rebuilt the way the live
 * loop built them. Only tool parts of the source Run's own model calls are
 * here — a cap marker and an unknown part contribute nothing.
 */

import type {
  AssistantContent,
  ModelMessage,
  ToolCallPart,
  ToolResultPart,
} from 'ai';
import type { ProviderMetadata } from 'ai';

import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

import { isContextItemPart, type ContextItemPart } from './context-item';
import {
  isReasoningPart,
  isTextPart,
  type MessagePart,
} from './context-builder';
import { projectStoredToolPart } from './tool-observation-part';

/**
 * The `toolCallId -> stepNumber` map `run.continued` stores. It is a wire
 * shape written into JSONB by admission, not a lookup table: a source Run from
 * before `api-continue` stores an empty one.
 */
export type KeptStepNumbers = Record<string, number>;

/**
 * The kept parts of a Continue Run, as its `run.continued` event stores them,
 * with the step each kept call belongs to.
 */
export type ContinueState = {
  readonly parts: ReadonlyArray<MessagePart>;
  /**
   * `toolCallId -> stepNumber` of the source Run's `tool.requested` events.
   * Empty for a source Run from before `api-continue`, which the projection
   * reads as "a run of consecutive tool parts is one step".
   */
  readonly stepNumbers: ReadonlyMap<string, number>;
};

/** One kept step: its reasoning, its text, its calls, and the results after them. */
type AssistantContentPart = Extract<
  Extract<AssistantContent, ReadonlyArray<unknown>>[number],
  { type: 'reasoning' | 'text' | 'tool-call' }
>;

type KeptStep = {
  readonly reasoning: Array<
    Extract<AssistantContentPart, { type: 'reasoning' }>
  >;
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
  // SAFETY: `run.continued` stores the reply's own JSONB parts array, written by
  // `createRunForMessage` from `continueKeptParts`; nothing here narrows them,
  // because the projection re-validates every part it reads.
  return { parts: payload['parts'] as ReadonlyArray<MessagePart>, stepNumbers };
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

/**
 * Whether this call starts a new step. An unnumbered call never does, so a
 * legacy run of consecutive calls stays one step; a numbered call starts one
 * when the open step holds calls of another response (or of an unnumbered one).
 */
function startsNewStep(
  openStepNumber: number | undefined,
  openCallCount: number,
  callStepNumber: number | undefined,
): boolean {
  return (
    openCallCount > 0 &&
    callStepNumber !== undefined &&
    callStepNumber !== openStepNumber
  );
}

function reasoningContent(
  part: MessagePart,
): Extract<AssistantContentPart, { type: 'reasoning' }> | undefined {
  if (!isReasoningPart(part)) return undefined;
  const providerOptions: ProviderMetadata | undefined = part.providerMetadata;
  return {
    type: 'reasoning',
    text: part.text,
    ...(providerOptions !== undefined && { providerOptions }),
  };
}

/**
 * Groups the kept parts into steps. A text or reasoning part after an open
 * step's calls begins the next response; a call whose recorded step differs
 * from the open one does too.
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
    const reasoning = reasoningContent(part);
    if (reasoning !== undefined) {
      if (current.calls.length > 0) flush();
      current.reasoning.push(reasoning);
      continue;
    }
    if (isTextPart(part)) {
      if (current.calls.length > 0) flush();
      current.text.push(part.text);
      continue;
    }
    if (isContextItemPart(part)) {
      const text: ContextItemPart['data']['text'] = part.data.text;
      if (text !== undefined && text.length > 0) current.items.push(text);
      continue;
    }
    const pair = projectStoredToolPart(part, index);
    if (pair === undefined) continue;
    const stepNumber = state.stepNumbers.get(pair.toolCallPart.toolCallId);
    if (startsNewStep(currentStepNumber, current.calls.length, stepNumber)) {
      flush();
    }
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
    { role: 'assistant', content },
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

/**
 * The `toolCallId -> stepNumber` map a Continue Run's `run.continued` stores:
 * the step the source Run recorded for each kept call. A source Run from
 * before `api-continue` recorded no step number, so the map is empty and the
 * projection takes its consecutive-call fallback.
 */
export function keptStepNumbers(
  events: ReadonlyArray<ContinuedEvent>,
  parts: ReadonlyArray<MessagePart>,
): KeptStepNumbers {
  const kept = new Set(
    parts.flatMap((part, index) => {
      const pair = projectStoredToolPart(part, index);
      return pair === undefined ? [] : [pair.toolCallPart.toolCallId];
    }),
  );
  const steps: Array<[string, number]> = [];
  for (const event of events) {
    if (event.eventType !== 'tool.requested' || !isRecord(event.payload)) {
      continue;
    }
    const toolCallId = event.payload['toolCallId'];
    const stepNumber = event.payload['stepNumber'];
    if (isString(toolCallId) && isNumber(stepNumber) && kept.has(toolCallId)) {
      steps.push([toolCallId, stepNumber]);
    }
  }
  return Object.fromEntries(steps);
}
