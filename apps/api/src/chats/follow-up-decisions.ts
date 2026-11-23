/**
 * The follow-up checks that decide what a Continue or Regenerate request
 * admits, as values: each returns its refusal instead of throwing, so the
 * admission transaction can commit the stuck-Run expiry it already performed.
 * A datastore or provider failure still throws, and rolls the transaction back.
 * Split out of `follow-up-admission.service.ts` so the service keeps only the
 * transaction around them.
 */

import { ConflictException, HttpException } from '@nestjs/common';

import { isRecord } from '@workspace/runtime-safety';

import { type Message, type Run, type RunStatus } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type NextCandidate } from '../models/model-selection';
import {
  EffortNotAvailableError,
  ModelNotAvailableError,
  NextCandidateUnavailableError,
  type ModelSelectionValidator,
} from '../models/models.service';
import { isCompletedAssistantTurn } from './assistant-completion';
import { MessagesRepository } from './chats-repository';
import { continueKeptParts } from './continue-kept-parts';
import { isContextItemPart } from './context-item';
import { type MessagePart } from './context-builder';
import { discardsNonReadOnlyCall } from './regenerate-notice';
import {
  continueStateFromEvents,
  continuedCallSteps,
  withKeptSteps,
  type KeptStepNumbers,
} from './continue-projection';
import { type FollowUpRunInput } from './run-creation';
import { isTerminalRunStatus } from '../runs/run-status';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

/** The terminal statuses a Continue Run resumes from. */
const CONTINUABLE_RUN_STATUSES: ReadonlyArray<RunStatus> = [
  'failed',
  'cancelled',
  'expired',
];

/** What the Continue check settles before the Run row exists. */
export type ContinueDecision =
  | { latestRun: Run; source: Message; effort: string | undefined }
  | { refusal: Error };

/**
 * What the Regenerate check settles before the Run row exists: the Run it acts
 * on, whether its notice is owed, and whether it replaces a reply that already
 * recorded usage (turn-actions D2, D9, D11).
 */
export type RegenerateDecision =
  | { latestRun: Run; notice: boolean; replacesUsage: boolean }
  | { refusal: Error };

/**
 * Whether an error is the admission refusing this request, rather than a
 * failure to execute it. Only a refusal keeps the committed expiry; a
 * datastore or provider failure still rolls the transaction back.
 */
export function isFollowUpRefusal(error: unknown): error is Error {
  return (
    error instanceof HttpException ||
    error instanceof ModelNotAvailableError ||
    error instanceof EffortNotAvailableError
  );
}

/**
 * Everything the Continue check decides, as a value: a refusal is returned
 * so the transaction can commit the stuck-Run expiry it already performed.
 */
export async function continueDecision(
  tx: Db,
  input: { chatId: string; userId: string },
  userMessage: Message,
  models: ModelSelectionValidator,
): Promise<ContinueDecision> {
  try {
    const { latestRun, source } = await continueSource(tx, input, userMessage);

    return { latestRun, source, effort: storedEffort(models, latestRun) };
  } catch (error) {
    if (!isFollowUpRefusal(error)) throw error;

    return { refusal: error };
  }
}

/**
 * Everything the Regenerate check decides, as a value: a refusal is returned
 * so the transaction can commit the stuck-Run expiry it already performed.
 * Any terminal latest Run qualifies, with or without a reply — a Run that
 * failed at pickup leaves the turn with no reply, and that turn needs
 * Regenerate most.
 */
export async function regenerateDecision(
  tx: Db,
  input: { chatId: string; userId: string },
  userMessage: Message,
): Promise<RegenerateDecision> {
  try {
    const latestRun = await latestTurnRun(tx, input, userMessage);

    if (!isTerminalRunStatus(latestRun.status)) {
      throw new ConflictException(
        `A ${latestRun.status} Run cannot be regenerated`,
      );
    }

    const reply = await new MessagesRepository(tx).findReply(
      input.chatId,
      input.userId,
      userMessage.id,
    );

    return {
      latestRun,
      // The notice is owed once per turn: the replaced reply has to hold a
      // call whose effects stay, and the trigger has to hold no notice yet.
      notice:
        reply !== undefined &&
        reply.parts.some((part) => discardsNonReadOnlyCall(part)) &&
        // Once per turn: the trigger must hold no notice yet.
        !userMessage.parts.some(
          (part) =>
            isContextItemPart(part) && part.data.producer === 'regenerate',
        ),
      replacesUsage: reply !== undefined && reply.usage !== null,
    };
  } catch (error) {
    if (!isFollowUpRefusal(error)) throw error;

    return { refusal: error };
  }
}

/** What Continue-on-next-candidate settles before the Run row exists. */
export type ContinueNextDecision =
  | {
      latestRun: Run;
      /** A stored reply exists only when the failed Run produced one. */
      source?: Message;
      next: NextCandidate;
      keptParts: Array<unknown>;
    }
  | { refusal: Error };

function nextCandidateForFailedRun(
  latestRun: Run,
  nextCandidate: (
    selector: string,
    currentModelId: string,
  ) => NextCandidate | undefined,
): NextCandidate {
  if (latestRun.status !== 'failed' || latestRun.kind !== 'turn') {
    throw new NextCandidateUnavailableError(
      `A ${latestRun.status} ${latestRun.kind} Run cannot move to its next candidate`,
    );
  }

  const next = nextCandidate(latestRun.selector, latestRun.modelId);

  if (next === undefined) {
    throw new NextCandidateUnavailableError(
      `Selector '${latestRun.selector}' has no candidate after '${latestRun.modelId}'`,
    );
  }

  return next;
}
/**
 * Only a failed role Run with a following candidate qualifies. A failed Run
 * without its own reply starts the new turn from the host message alone.
 */

export async function continueNextDecision(
  tx: Db,
  input: { chatId: string; userId: string },
  userMessage: Message,
  nextCandidate: (
    selector: string,
    currentModelId: string,
  ) => NextCandidate | undefined,
): Promise<ContinueNextDecision> {
  try {
    const latestRun = await latestTurnRun(tx, input, userMessage);

    const next = nextCandidateForFailedRun(latestRun, nextCandidate);

    const source = await new MessagesRepository(tx).findReply(
      input.chatId,
      input.userId,
      userMessage.id,
    );

    if (source !== undefined) continuableReply(latestRun, source);

    return {
      latestRun,
      ...(source !== undefined && { source }),
      next,
      keptParts: source === undefined ? [] : continueKeptParts(source.parts),
    };
  } catch (error) {
    if (!isFollowUpRefusal(error)) throw error;

    return {
      refusal:
        error instanceof HttpException && error.getStatus() === 409
          ? new NextCandidateUnavailableError(error.message)
          : error,
    };
  }
}

/**
 * What the Continue Run's event log starts from: the reply's kept parts
 * through its last settled tool part, each kept call numbered with the step
 * it belongs to, and whether the reply already recorded usage (turn-actions
 * D4, D6, D11).
 */
export async function continueFollowUp(
  tx: Db,
  userId: string,
  sourceRunId: string,
  source: Message,
): Promise<FollowUpRunInput> {
  // SAFETY: the kept parts are the reply's own stored UI parts, and the
  // projection re-validates every part it reads.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const keptParts = continueKeptParts(
    source.parts,
  ) as ReadonlyArray<MessagePart>;

  const steps = await keptSteps(tx, userId, sourceRunId, keptParts);

  return {
    action: 'continue',
    sourceRunId,
    // The kept parts carry the step each call belongs to, so the continued
    // reply groups the way the source Run's live step sent it (design D5).
    keptParts: withKeptSteps(keptParts, steps),
    replacesUsage: source.usage !== null,
  };
}

/**
 * The step of each kept call, from the steps the kept parts record, the
 * numbers the source Run inherited in its own `run.continued` event, and its
 * `tool.requested` events (turn-actions D6). A kept call whose part records
 * none gets the number its request recorded, after the chain it continued,
 * and the text and reasoning of that step follow it.
 */
async function keptSteps(
  tx: Db,
  userId: string,
  sourceRunId: string,
  keptParts: ReadonlyArray<MessagePart>,
): Promise<KeptStepNumbers> {
  const events = new RunEventsRepository(tx);

  const sourceEvents = await events.listByRunId(sourceRunId, userId, {
    eventTypes: ['tool.requested'],
  });

  // A source Run that continued one itself holds the numbers of the calls it
  // inherited — and the offset of its own — in its own `run.continued`
  // event, so a Continue of it keeps the chain's numbering.
  const sourceContinued = await events.findFirstByType(
    sourceRunId,
    userId,
    'run.continued',
  );

  return continuedCallSteps({
    keptParts,
    ...(sourceContinued !== undefined && {
      sourceContinued: continueStateFromEvents([sourceContinued]),
    }),
    sourceEvents,
  });
}

/**
 * The effort the Continue Run sends: exactly the source Run's, re-checked
 * against the model still declaring it. A stored `null` is "send no effort",
 * not "use the model's default", so a later default cannot change the turn.
 */
function storedEffort(
  models: ModelSelectionValidator,
  latestRun: Run,
): string | undefined {
  const model = models.validateModelSelection(latestRun.modelId);

  return latestRun.effort === null
    ? undefined
    : models.resolveEffortSelection(model, latestRun.effort);
}

/**
 * The message's latest Run, or a 409 when the message has none. The turn
 * check has already refused every later turn, so the Chat's newest Run is
 * this message's Run whenever the message has one.
 */
async function latestTurnRun(
  tx: Db,
  input: { chatId: string; userId: string },
  userMessage: Message,
): Promise<Run> {
  const latestRun = await new RunsRepository(tx).findLatestByChatId(
    input.chatId,
    input.userId,
  );

  if (latestRun?.messageId !== userMessage.id) {
    throw new ConflictException('The message has no Run to follow up');
  }

  return latestRun;
}

/**
 * The message's latest Run and the reply it continues. The turn check has
 * already refused every later turn, so the Chat's newest Run is this
 * message's Run whenever the message has one.
 */
async function continueSource(
  tx: Db,
  input: { chatId: string; userId: string },
  userMessage: Message,
): Promise<{ latestRun: Run; source: Message }> {
  const latestRun = await latestTurnRun(tx, input, userMessage);

  const reply = await new MessagesRepository(tx).findReply(
    input.chatId,
    input.userId,
    userMessage.id,
  );

  return { latestRun, source: continuableReply(latestRun, reply) };
}

/**
 * The reply a Continue Run continues, or a 409: the latest Run must be
 * resumable, its reply must exist, its usage must name that Run, and its
 * usage must not be `completed`.
 */
function continuableReply(latestRun: Run, reply: Message | undefined): Message {
  if (!CONTINUABLE_RUN_STATUSES.includes(latestRun.status)) {
    throw new ConflictException(
      `A ${latestRun.status} Run cannot be continued`,
    );
  }

  if (reply === undefined) {
    throw new ConflictException('The Run that can be continued left no reply');
  }

  const usage = reply.usage;

  if (
    !isRecord(usage) ||
    usage['runId'] !== latestRun.id ||
    isCompletedAssistantTurn(reply)
  ) {
    throw new ConflictException(
      'The reply does not belong to a Run that can be continued',
    );
  }

  return reply;
}
