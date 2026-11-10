/**
 * The `interrupted` context-item producer (run-steering D7): the notice that
 * opens the delivered message of an interrupt. It tells the model that the
 * owner stopped its previous step, and which `bash` and MCP calls the stop
 * killed after they had started, because their effects are unknown.
 *
 * The notice is an accepted-turn item: it lives on the delivered user message,
 * so every later request of the Run and of the Chat carries it, first among
 * the items of that message.
 */

import { isRecord } from '@workspace/runtime-safety';

import { loadPackagedTemplate } from '../prompts/template-engine';
import { type AuthoredContextItemPart } from './context-item';
import {
  createRenderedContextItem,
  isExactRecord,
  isNonEmptyString,
} from './context-item-shared';

/** A call that started and that an interrupt stopped. */
export type StoppedCall = {
  readonly toolName: string;
  readonly toolCallId: string;
};

export interface InterruptedPayload extends Record<string, unknown> {
  readonly stoppedCalls: ReadonlyArray<StoppedCall>;
}

function isStoppedCall(value: unknown): value is StoppedCall {
  return (
    isExactRecord(value, ['toolCallId', 'toolName']) &&
    isNonEmptyString(value['toolName']) &&
    isNonEmptyString(value['toolCallId'])
  );
}

/** The `stoppedCalls` a `run.delivered` payload records, as far as it is valid. */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- the raw `run_events.payload` JSONB value; the `isRecord` and `isStoppedCall` guards are its validation.
export function stoppedCallsOf(payload: unknown): ReadonlyArray<StoppedCall> {
  const calls = isRecord(payload) ? payload['stoppedCalls'] : undefined;

  return Array.isArray(calls) ? calls.filter(isStoppedCall) : [];
}

export function isInterruptedPayload(
  value: unknown,
): value is InterruptedPayload {
  if (!isExactRecord(value, ['stoppedCalls'])) return false;
  const calls = value['stoppedCalls'];

  return Array.isArray(calls) && calls.every(isStoppedCall);
}

const renderInterruptedNotice = loadPackagedTemplate<{
  readonly stoppedCalls: ReadonlyArray<{
    readonly toolName: string;
    readonly callId: string;
  }>;
}>(__dirname, 'interrupted-notice');

/**
 * A call id is provider-chosen text inside a model-facing envelope, so it is
 * quoted as a JSON string with the angle brackets escaped: it cannot close the
 * envelope or start a line of its own.
 */
function quotedCallId(toolCallId: string): string {
  return JSON.stringify(toolCallId)
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('>', String.raw`\u003e`);
}

export function createInterruptedItem(input: {
  readonly runId: string;
  readonly stoppedCalls: ReadonlyArray<StoppedCall>;
}): AuthoredContextItemPart {
  const payload: InterruptedPayload = {
    stoppedCalls: input.stoppedCalls.map(({ toolName, toolCallId }) => ({
      toolName,
      toolCallId,
    })),
  };

  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the declared type cannot express the non-empty-name invariant this guard enforces, so it is an assertion about the value, not a redundant re-parse of a type we already trust.
  if (!isInterruptedPayload(payload)) {
    throw new TypeError('Invalid server-authored interrupted notice metadata');
  }

  return createRenderedContextItem({
    producer: 'interrupted',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderInterruptedNotice({
      stoppedCalls: payload.stoppedCalls.map(({ toolName, toolCallId }) => ({
        toolName,
        callId: quotedCallId(toolCallId),
      })),
    }),
  });
}
