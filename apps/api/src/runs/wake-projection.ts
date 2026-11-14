import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import {
  continueStepOffset,
  withKeptSteps,
  type ContinueState,
} from '../chats/continue-projection';
import { toMessageParts } from '../chats/chat-message-parts';
import { type MessagePart } from '../chats/context-builder';
import { type AwaitingJobs, type RunEvent } from '../db/schema';
import {
  type ToolClassification,
  type ToolResult,
  isToolClassification,
} from '../tools/types';
import { toolActivityPart } from './assistant-transcript';
import {
  eventProviderMetadata,
  permissionFromPayload,
  toolResultFromPayload,
} from './run-event-payload';

/** The kept reply prefix restored by the first successful wait wake. */
export type WakeState = ContinueState & { readonly toolCallId: string };

type WakeCheckpoint = {
  readonly toolCallId: string;
  readonly awaiting: { readonly toolInput: AwaitingJobs['toolInput'] };
  readonly parts: Array<MessagePart>;
  readonly steps?: Record<string, number>;
};

type WakeWindow = {
  readonly suspension: UnknownRecord;
  readonly suspensionIndex: number;
  readonly attemptStart: number;
  readonly attemptEnd: number;
};

/**
 * Restore the checkpoint and the one wait result claimed by this attempt.
 * Retries after that first claim deliberately return no prefix: their current
 * attempt is an ordinary model attempt, not another delivery of the wait.
 */
export function wakeStateFromEvents(
  events: ReadonlyArray<RunEvent>,
  attemptId: string,
): WakeState | undefined {
  const segment = events.slice(
    events.findLastIndex((event) => event.eventType === 'run.delivered') + 1,
  );

  const resumedIndex = segment.findLastIndex(
    (event) => event.eventType === 'run.resumed',
  );

  const resumedPayload = segment[resumedIndex]?.payload;

  if (resumedIndex === -1 || !isRecord(resumedPayload)) return undefined;

  const generation = resumedPayload['generation'];

  if (!isNumber(generation)) return undefined;

  const window = firstWakeAttemptWindow(
    segment,
    resumedIndex,
    generation,
    attemptId,
  );

  if (window === undefined) return undefined;

  const checkpoint = parseWakeCheckpoint(window.suspension);

  if (checkpoint === undefined) return undefined;

  const result = firstWaitResult(segment, window, checkpoint.toolCallId);

  if (result === undefined) return undefined;

  return assembleWakeState(segment, window, checkpoint, result);
}

function firstWakeAttemptWindow(
  segment: ReadonlyArray<RunEvent>,
  resumedIndex: number,
  generation: number,
  attemptId: string,
): WakeWindow | undefined {
  const suspensionIndex = findSuspensionIndex(
    segment,
    resumedIndex,
    generation,
  );

  if (suspensionIndex === -1) return undefined;

  const suspension = segment[suspensionIndex]?.payload;

  if (!isRecord(suspension)) return undefined;

  const attemptStart = segment.findIndex(
    (event, index) => index > resumedIndex && event.eventType === 'run.started',
  );

  const started = segment[attemptStart]?.payload;

  if (
    attemptStart === -1 ||
    !isRecord(started) ||
    started['attemptId'] !== attemptId
  ) {
    return undefined;
  }

  const nextAttempt = segment.findIndex(
    (event, index) => index > attemptStart && event.eventType === 'run.started',
  );

  return {
    suspension,
    suspensionIndex,
    attemptStart,
    attemptEnd: nextAttempt === -1 ? segment.length : nextAttempt,
  };
}

function findSuspensionIndex(
  segment: ReadonlyArray<RunEvent>,
  resumedIndex: number,
  generation: number,
): number {
  for (let index = resumedIndex - 1; index >= 0; index -= 1) {
    const event = segment[index];

    if (
      event?.eventType === 'run.suspended' &&
      isRecord(event.payload) &&
      event.payload['generation'] === generation
    ) {
      return index;
    }
  }

  return -1;
}

function parseWakeCheckpoint(
  suspension: UnknownRecord,
): WakeCheckpoint | undefined {
  const toolCallId = suspension['toolCallId'];

  if (!isString(toolCallId)) return undefined;

  const toolInput = parseAwaitingToolInput(suspension['awaiting'], toolCallId);

  if (toolInput === undefined) return undefined;

  if (
    !Array.isArray(suspension['parts']) ||
    !suspension['parts'].every(isRecord)
  ) {
    return undefined;
  }

  const { parts, steps } = checkpointParts(
    suspension['parts'],
    suspension['steps'],
  );

  return {
    toolCallId,
    awaiting: { toolInput },
    parts,
    ...(steps !== undefined && { steps }),
  };
}

function parseAwaitingToolInput(
  value: RunEvent['payload'],
  toolCallId: string,
): AwaitingJobs['toolInput'] | undefined {
  if (
    !isRecord(value) ||
    value['toolCallId'] !== toolCallId ||
    !isRecord(value['toolInput']) ||
    !Array.isArray(value['toolInput']['jobs']) ||
    !value['toolInput']['jobs'].every(isString) ||
    (value['toolInput']['timeout'] !== undefined &&
      !isNumber(value['toolInput']['timeout'])) ||
    !Array.isArray(value['jobIds']) ||
    !value['jobIds'].every(isString) ||
    !isString(value['deadline'])
  ) {
    return undefined;
  }

  const input: AwaitingJobs['toolInput'] = { jobs: value['toolInput']['jobs'] };
  const timeout = value['toolInput']['timeout'];

  if (isNumber(timeout)) input.timeout = timeout;

  return input;
}

function checkpointParts(
  value: ReadonlyArray<unknown>,
  stepsValue: RunEvent['payload'],
): Pick<WakeCheckpoint, 'parts' | 'steps'> {
  const steps = isRecord(stepsValue)
    ? Object.fromEntries(
        Object.entries(stepsValue).filter((entry): entry is [string, number] =>
          isNumber(entry[1]),
        ),
      )
    : undefined;

  const parts = toMessageParts(value);

  return {
    parts: steps === undefined ? parts : withKeptSteps(parts, steps),
    ...(steps !== undefined && { steps }),
  };
}

function firstWaitResult(
  segment: ReadonlyArray<RunEvent>,
  window: WakeWindow,
  toolCallId: string,
): ToolResult | undefined {
  const completion = segment.find(
    (event, index) =>
      index > window.attemptStart &&
      index < window.attemptEnd &&
      event.eventType === 'tool.completed' &&
      isRecord(event.payload) &&
      event.payload['toolCallId'] === toolCallId &&
      event.payload['toolName'] === 'wait',
  );

  if (!isRecord(completion?.payload)) return undefined;

  return toolResultFromPayload(completion.payload['output'], 'wait');
}

function assembleWakeState(
  segment: ReadonlyArray<RunEvent>,
  window: WakeWindow,
  checkpoint: WakeCheckpoint,
  result: ToolResult,
): WakeState {
  const metadata = wakeActivityMetadata(
    segment,
    window.suspensionIndex,
    checkpoint.toolCallId,
  );

  const storedStep =
    checkpoint.steps !== undefined &&
    Object.hasOwn(checkpoint.steps, checkpoint.toolCallId)
      ? checkpoint.steps[checkpoint.toolCallId]
      : undefined;

  const step = storedStep ?? continueStepOffset({ parts: checkpoint.parts });

  const part = toolActivityPart({
    toolCallId: checkpoint.toolCallId,
    toolName: 'wait',
    input: checkpoint.awaiting.toolInput,
    result,
    ...(step !== undefined && { step }),
    ...metadata,
  });

  return {
    parts: [...checkpoint.parts, part],
    toolCallId: checkpoint.toolCallId,
  };
}

function wakeActivityMetadata(
  segment: ReadonlyArray<RunEvent>,
  suspensionIndex: number,
  toolCallId: string,
) {
  const requestPayload = requestedWaitPayload(
    segment,
    suspensionIndex,
    toolCallId,
  );

  const providerMetadata = eventProviderMetadata(requestPayload);

  const classification = classificationBeforeSuspension(
    segment,
    suspensionIndex,
    toolCallId,
  );

  const permission = permissionFromPayload(requestPayload);

  return {
    ...(providerMetadata !== undefined && { providerMetadata }),
    ...(permission !== undefined && { permission }),
    ...(classification !== undefined && { classification }),
  };
}

function classificationBeforeSuspension(
  segment: ReadonlyArray<RunEvent>,
  suspensionIndex: number,
  toolCallId: string,
): ToolClassification | null | undefined {
  const started = segment.find(
    (event, index) =>
      event.eventType === 'tool.started' &&
      isRecord(event.payload) &&
      event.payload['toolCallId'] === toolCallId &&
      index < suspensionIndex,
  );

  if (started === undefined) return null;

  const classification = isRecord(started.payload)
    ? started.payload['classification']
    : undefined;

  return isToolClassification(classification) ? classification : undefined;
}

function requestedWaitPayload(
  segment: ReadonlyArray<RunEvent>,
  suspensionIndex: number,
  toolCallId: string,
): RunEvent['payload'] {
  return segment.find(
    (event, index) =>
      index < suspensionIndex &&
      event.eventType === 'tool.requested' &&
      isRecord(event.payload) &&
      event.payload['toolCallId'] === toolCallId &&
      event.payload['toolName'] === 'wait',
  )?.payload;
}
