import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { z } from 'zod';
import {
  withKeptSteps,
  type ContinueState,
} from '../chats/continue-projection';
import { toMessageParts } from '../chats/chat-message-parts';
import { type QuotaResumeAt, type RunEvent } from '../db/schema';
import { stoppedCallsOf, type StoppedCall } from '../chats/interrupted-notice';
import type { FirstEpochBaselines } from './segment-delivery';

/** The boundary mode a boundary summary was requested in, frozen across waits. */
export type QuotaBoundaryMode = 'automatic' | 'owner';

export type QuotaRequestState = {
  readonly resumeAt: QuotaResumeAt;
  readonly waitCount: number;
  readonly generation: number;
  /**
   * The mode the suspended boundary summary was requested in. Present only for
   * a boundary checkpoint of this shape; a later /compact delivery must not
   * flip the original request's failure class.
   */
  readonly boundaryMode?: QuotaBoundaryMode;
  /**
   * Step budget this Run had already charged before the wait, across every
   * segment. It excludes a Continue Run's inherited display numbering, and it
   * includes any compaction delivery's own charge.
   */
  readonly stepBudgetUsed?: number;
  /**
   * The attempt whose immutable prompt receipt owns the suspended boundary or
   * final-answer summary's system prompt. Carried across re-waits so the
   * resumed summary continues the original rendered prefix.
   */
  readonly summaryAttemptId?: string;
  /**
   * SHA-256 of that receipt's system prompt with the tool declarations the
   * suspended summary would have sent. A resumed summary whose current
   * declarations no longer reproduce it never substitutes them.
   */
  readonly summaryPrefixFingerprint?: string;
  /**
   * The first-epoch baselines the suspended attempt actually rendered for its
   * target request. Present only when that attempt rendered one; absence means
   * it rendered none.
   */
  readonly baselines?: FirstEpochBaselines;
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

export function quotaSummaryWakeFromEvents(
  events: ReadonlyArray<RunEvent>,
  attemptId: string,
): boolean {
  if (
    events.some(
      (event) =>
        event.eventType === 'model.requested' &&
        isRecord(event.payload) &&
        event.payload['attemptId'] === attemptId,
    )
  )
    return false;

  const suspension = firstQuotaWakeSuspension(events, attemptId);

  if (
    suspension?.['resumeAt'] === 'boundary' ||
    suspension?.['resumeAt'] === 'finalAnswer'
  )
    return true;

  const latestStartIndex = events.findLastIndex(
    (event) => event.eventType === 'run.started',
  );

  const latestStart = events[latestStartIndex];
  // Terminal settlement closes recovery before writing the saved reply.
  const request = quotaRequestFromEvents(events.slice(0, latestStartIndex + 1));

  return (
    (request?.resumeAt === 'boundary' || request?.resumeAt === 'finalAnswer') &&
    isRecord(latestStart?.payload) &&
    latestStart.payload['attemptId'] === attemptId
  );
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
  const parsed = quotaPayloadSchema.safeParse(payload);

  if (!parsed.success) return undefined;

  const {
    boundaryMode,
    stepBudgetUsed,
    summaryAttemptId,
    summaryPrefixFingerprint,
    baselines,
  } = parsed.data;

  return {
    resumeAt: parsed.data.resumeAt,
    waitCount: parsed.data.waitCount,
    generation: parsed.data.generation,
    ...(parsed.data.resumeAt === 'boundary' &&
      boundaryMode !== undefined && { boundaryMode }),
    ...(stepBudgetUsed !== undefined && { stepBudgetUsed }),
    ...(summaryAttemptId !== undefined && { summaryAttemptId }),
    ...(summaryPrefixFingerprint !== undefined && { summaryPrefixFingerprint }),
    ...(baselines !== undefined && { baselines }),
    ...(payload['resumeAt'] === 'boundary' &&
      Array.isArray(payload['stoppedCalls']) && {
        stoppedCalls: stoppedCallsOf(payload),
      }),
  };
}

const digestEntrySchema = z.object({
  title: z.string(),
  date: z.string(),
  messageCount: z.number(),
  excerpt: z.string().optional(),
});

const firstEpochBaselinesSchema = z.object({
  recencyDigestInitialization: z
    .object({
      baseline: z.object({
        pinned: z.array(digestEntrySchema),
        recent: z.array(digestEntrySchema),
        pinnedShown: z.number(),
        pinnedTotal: z.number(),
        recentShown: z.number(),
        recentTotal: z.number(),
        compiledOn: z.string(),
      }),
      told: z.array(
        z.object({
          chatId: z.string(),
          pinned: z.boolean(),
          title: z.string().optional(),
        }),
      ),
    })
    .optional(),
  skillCatalogFreeze: z
    .object({
      baseline: z.object({
        entries: z.array(
          z.object({ name: z.string(), description: z.string() }),
        ),
        omitted: z.number(),
      }),
      rebakedFrom: z.string().nullable(),
      told: z.array(z.string()),
    })
    .optional(),
});

const omittedCheckpointField = z.unknown().transform(() => undefined);

const quotaPayloadSchema = z.object({
  kind: z.literal('quota'),
  generation: z.number().int().positive(),
  waitCount: z.number().int().positive(),
  resumeAt: z.enum([
    'request',
    'preDispatch',
    'boundary',
    'finalAnswer',
    'compactionRun',
  ]),
  failureClass: z.enum(['quota_exhausted', 'rate_limited']),
  attemptId: z.string(),
  resetsAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  wakeAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  parts: z.array(z.record(z.string(), z.unknown())),
  steps: z.record(z.string(), z.number().int().nonnegative()),
  boundaryMode: z
    .enum(['automatic', 'owner'])
    .or(omittedCheckpointField)
    .optional(),
  stepBudgetUsed: z
    .number()
    .int()
    .nonnegative()
    .or(omittedCheckpointField)
    .optional(),
  summaryAttemptId: z.string().min(1).or(omittedCheckpointField).optional(),
  summaryPrefixFingerprint: z
    .string()
    .min(1)
    .or(omittedCheckpointField)
    .optional(),
  baselines: firstEpochBaselinesSchema
    .refine(
      (value) =>
        value.recencyDigestInitialization !== undefined ||
        value.skillCatalogFreeze !== undefined,
    )
    .or(omittedCheckpointField)
    .optional(),
});

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
