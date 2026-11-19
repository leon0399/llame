import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import {
  withKeptSteps,
  type ContinueState,
} from '../chats/continue-projection';
import { toMessageParts } from '../chats/chat-message-parts';
import { type QuotaResumeAt, type RunEvent } from '../db/schema';
import { stoppedCallsOf, type StoppedCall } from '../chats/interrupted-notice';

export type QuotaRequestState = {
  readonly resumeAt: QuotaResumeAt;
  readonly waitCount: number;
  readonly generation: number;
  readonly stoppedCalls?: ReadonlyArray<StoppedCall>;
};

/** Restores the first claimed quota wake's checkpoint without inventing a tool result. */
export function quotaWakeStateFromEvents(
  events: ReadonlyArray<RunEvent>,
  attemptId: string,
): ContinueState | undefined {
  const suspension = firstQuotaWakeSuspension(events, attemptId);

  if (suspension === undefined) return undefined;

  return quotaCheckpointState(suspension);
}

/** Preserves stored history before dispatch without authorizing execution. */
export function quotaPendingReplyFromEvents(
  events: ReadonlyArray<RunEvent>,
): { state: ContinueState; events: Array<RunEvent> } | undefined {
  const request = quotaRequestFromEvents(events);

  if (request?.resumeAt !== 'request') return undefined;

  const index = events.findLastIndex(
    (event) =>
      event.eventType === 'run.suspended' &&
      isRecord(event.payload) &&
      parseQuotaRequest(event.payload)?.generation === request.generation,
  );

  const suspension = events[index]?.payload;

  if (!isRecord(suspension)) return undefined;

  const after = events.slice(index + 1);

  if (after.some((event) => event.eventType === 'model.requested'))
    return undefined;

  const state = quotaCheckpointState(suspension);

  return state === undefined ? undefined : { state, events: after };
}

/** An open summary still owns its saved reply after its first wake claim dies. */
export function quotaCompactionStateFromEvents(
  events: ReadonlyArray<RunEvent>,
  request: QuotaRequestState | undefined,
): ContinueState | undefined {
  if (
    request === undefined ||
    request.resumeAt === 'request' ||
    request.resumeAt === 'compactionRun'
  )
    return undefined;

  const suspension = events.findLast(
    (event) =>
      event.eventType === 'run.suspended' &&
      isRecord(event.payload) &&
      event.payload['generation'] === request.generation &&
      event.payload['resumeAt'] === request.resumeAt,
  )?.payload;

  if (!isRecord(suspension) || parseQuotaRequest(suspension) === undefined)
    return undefined;

  return quotaCheckpointState(suspension);
}

function quotaCheckpointState(
  suspension: UnknownRecord,
): ContinueState | undefined {
  const parts = suspension['parts'];

  if (!Array.isArray(parts) || !parts.every(isRecord)) return undefined;

  const restoredParts = toMessageParts(parts);
  const steps = numericSteps(suspension['steps']);

  return {
    parts:
      steps === undefined ? restoredParts : withKeptSteps(restoredParts, steps),
  };
}

function firstQuotaWakeSuspension(
  events: ReadonlyArray<RunEvent>,
  attemptId: string,
): UnknownRecord | undefined {
  const segment = events.slice(
    events.findLastIndex((event) => event.eventType === 'run.delivered') + 1,
  );

  const resumedIndex = segment.findLastIndex(
    (event) => event.eventType === 'run.resumed',
  );

  const resumed = segment[resumedIndex]?.payload;

  if (
    !isRecord(resumed) ||
    !isNumber(resumed['generation']) ||
    resumed['kind'] !== 'quota' ||
    resumed['attemptId'] !== attemptId ||
    !hasMatchingWakeStart(segment, resumedIndex, attemptId)
  )
    return undefined;

  const suspensionIndex = segment.findLastIndex(
    (event, index) =>
      index < resumedIndex && event.eventType === 'run.suspended',
  );

  const suspension = segment[suspensionIndex]?.payload;

  if (
    !isRecord(suspension) ||
    suspension['generation'] !== resumed['generation'] ||
    parseQuotaRequest(suspension) === undefined
  )
    return undefined;

  return suspension;
}

function hasMatchingWakeStart(
  segment: ReadonlyArray<RunEvent>,
  resumedIndex: number,
  attemptId: string,
): boolean {
  const startedIndex = segment.findIndex(
    (event, index) => index > resumedIndex && event.eventType === 'run.started',
  );

  const started = segment[startedIndex]?.payload;

  return (
    startedIndex !== -1 &&
    isRecord(started) &&
    started['attemptId'] === attemptId &&
    !segment.some(
      (event, index) =>
        index > startedIndex && event.eventType === 'run.started',
    )
  );
}

/** Returns the latest still-open quota request, including after awaiting was cleared. */
export function quotaRequestFromEvents(
  events: ReadonlyArray<RunEvent>,
): QuotaRequestState | undefined {
  const recovered = new Set<string>();

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event?.eventType === 'run.delivered') return undefined;

    if (event?.eventType === 'run.quota_recovered' && isRecord(event.payload)) {
      const generation = event.payload['generation'];
      const resumeAt = event.payload['resumeAt'];

      if (isNumber(generation) && isQuotaResumeAt(resumeAt))
        recovered.add(`${generation}\0${resumeAt}`);

      continue;
    }

    if (event?.eventType !== 'run.suspended' || !isRecord(event.payload))
      continue;

    const request = parseQuotaRequest(event.payload);

    if (request === undefined) continue;

    return recovered.has(`${request.generation}\0${request.resumeAt}`)
      ? undefined
      : request;
  }

  return undefined;
}

/** Returns the unconsumed quota wake claim attempt, before a later claim invalidates reuse. */
export function quotaResumeAttemptId(
  events: ReadonlyArray<RunEvent>,
  generation: number,
): string | undefined {
  const latestRelevantIndex = events.findLastIndex(
    (event) =>
      event.eventType === 'run.resumed' ||
      event.eventType === 'run.started' ||
      event.eventType === 'run.delivered',
  );

  const resumed = events[latestRelevantIndex]?.payload;

  if (
    latestRelevantIndex === -1 ||
    events[latestRelevantIndex]?.eventType !== 'run.resumed' ||
    !isRecord(resumed) ||
    resumed['kind'] !== 'quota' ||
    resumed['generation'] !== generation ||
    !isString(resumed['attemptId'])
  )
    return undefined;

  return resumed['attemptId'];
}

function parseQuotaRequest(
  payload: UnknownRecord,
): QuotaRequestState | undefined {
  if (
    payload['kind'] !== 'quota' ||
    !isNumber(payload['generation']) ||
    !Number.isInteger(payload['generation']) ||
    payload['generation'] < 1 ||
    !isNumber(payload['waitCount']) ||
    !Number.isInteger(payload['waitCount']) ||
    payload['waitCount'] < 1 ||
    !isQuotaResumeAt(payload['resumeAt']) ||
    (payload['failureClass'] !== 'quota_exhausted' &&
      payload['failureClass'] !== 'rate_limited') ||
    !isString(payload['attemptId']) ||
    !isString(payload['resetsAt']) ||
    !Number.isFinite(Date.parse(payload['resetsAt'])) ||
    !isString(payload['wakeAt']) ||
    !Number.isFinite(Date.parse(payload['wakeAt'])) ||
    !Array.isArray(payload['parts']) ||
    !payload['parts'].every(isRecord) ||
    !isRecord(payload['steps']) ||
    !Object.values(payload['steps']).every(
      (step) => isNumber(step) && Number.isInteger(step) && step >= 0,
    )
  ) {
    return undefined;
  }

  return {
    resumeAt: payload['resumeAt'],
    waitCount: payload['waitCount'],
    generation: payload['generation'],
    ...(payload['resumeAt'] === 'boundary' &&
      Array.isArray(payload['stoppedCalls']) && {
        stoppedCalls: stoppedCallsOf(payload),
      }),
  };
}

function isQuotaResumeAt(value: unknown): value is QuotaResumeAt {
  return (
    value === 'request' ||
    value === 'preDispatch' ||
    value === 'boundary' ||
    value === 'finalAnswer' ||
    value === 'compactionRun'
  );
}

function numericSteps(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] =>
      isNumber(entry[1]),
    ),
  );
}
