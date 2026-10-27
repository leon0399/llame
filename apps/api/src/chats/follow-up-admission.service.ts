/**
 * Follow-up admission (turn-actions D1–D4): the service that turns a request
 * on an existing turn into a queued Run, with no HTTP route of its own.
 *
 * One transaction locks the Chat's row, checks that the turn is the latest
 * one, passes the chat send's single-flight admission, applies the Continue
 * check, and creates the Run with the parts its event log starts from. The
 * caller dispatches and streams the returned Run through
 * `ChatLoopService.finalizeAcceptedRun`, so a follow-up never runs as a plain
 * Run.
 */

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { isRecord } from '@workspace/runtime-safety';

import { assertNotArchived } from '../db/assert-not-archived';
import { type Message, type Run, type RunStatus } from '../db/schema';
import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import {
  EffortNotAvailableError,
  ModelNotAvailableError,
  ModelsService,
  resolvePermissionMode,
  type ModelSelectionValidator,
} from '../models/models.service';
import {
  RunDispatchService,
  type RunDispatcher,
} from '../runs/run-dispatch.service';
import { isCompletedAssistantTurn } from './assistant-completion';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { clearActiveRunSlot } from './chat-admission';
import { type AcceptedRun } from './chat-loop.service';
import { toRunUserMessage } from './chat-message-parts';
import { continueKeptParts } from './continue-kept-parts';
import { type MessagePart } from './context-builder';
import {
  continuedRecords,
  continueStateFromEvents,
  type ContinuedRecords,
} from './continue-projection';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { createRunForMessage, type FollowUpRunInput } from './run-creation';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

/**
 * A follow-up request as the caller sent it, before its checks. Continue takes
 * its model and its effort from the Run it continues, so those fields are only
 * here to be refused.
 */
export type FollowUpRequestInput = {
  action?: string;
  modelId?: string;
  effort?: string;
  /** Absent means `default`, as on a chat send. */
  permissionMode?: PermissionMode;
};

/** The terminal statuses a Continue Run resumes from. */
const CONTINUABLE_RUN_STATUSES: ReadonlyArray<RunStatus> = [
  'failed',
  'cancelled',
  'expired',
];

/**
 * What one admission transaction returns. A refusal is a VALUE, not a throw:
 * the transaction may already have expired a stuck Run, and design D1 keeps
 * that expiry even when the follow-up is then refused. The caller throws the
 * refusal after the commit, so the refusal itself still writes nothing.
 */
type AdmissionOutcome = AcceptedRun | { refusal: Error };

/** What the Continue check settles before the Run row exists. */
type ContinueDecision =
  | { latestRun: Run; source: Message; effort: string | undefined }
  | { refusal: Error };

/**
 * Whether an error is the admission refusing this request, rather than a
 * failure to execute it. Only a refusal keeps the committed expiry; a
 * datastore or provider failure still rolls the transaction back.
 */
function isFollowUpRefusal(error: unknown): error is Error {
  return (
    error instanceof HttpException ||
    error instanceof ModelNotAvailableError ||
    error instanceof EffortNotAvailableError
  );
}

@Injectable()
export class FollowUpAdmissionService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(ModelsService)
    private readonly models: ModelSelectionValidator,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(RunDispatchService)
    private readonly dispatch: RunDispatcher,
  ) {}

  /**
   * Admit a follow-up Run on an existing turn. A refused request throws before
   * or inside the transaction without creating a Run.
   */
  async admitFollowUpRun(input: {
    chatId: string;
    userId: string;
    userMessageId: string;
    request: FollowUpRequestInput;
  }): Promise<AcceptedRun> {
    // A refused request costs no transaction and writes nothing.
    const permissionMode = this.admissionPermissionMode(input.request);

    const outcome = await this.tenantDb.runAs(
      input.userId,
      async (tx): Promise<AdmissionOutcome> => {
        const userMessage = await this.lockLatestTurn(
          new ChatsRepository(tx),
          new MessagesRepository(tx),
          input,
        );

        // A chat send's own single-flight admission: a live Run answers 409, and
        // a stuck Run is expired here so the Continue check reads its outcome.
        await clearActiveRunSlot({
          tx,
          chatId: input.chatId,
          userId: input.userId,
          dispatch: this.dispatch,
          instanceConfig: this.instanceConfig,
        });

        return this.continueRun(tx, input, userMessage, permissionMode);
      },
    );

    // The expiry committed above; the refusal is answered from here, after it.
    if ('refusal' in outcome) {
      throw outcome.refusal;
    }
    return outcome;
  }

  /**
   * The checks that need no stored state: `continue` is the only action this
   * layer can execute, a model or an effort it names would be silently
   * ignored, and the mode must be one the operator enabled.
   */
  private admissionPermissionMode(
    request: FollowUpRequestInput,
  ): PermissionMode {
    if (request.action !== 'continue') {
      throw new BadRequestException('action must be continue');
    }
    if (request.modelId !== undefined) {
      throw new BadRequestException('A continue request does not name a model');
    }
    if (request.effort !== undefined) {
      throw new BadRequestException(
        'A continue request does not name an effort',
      );
    }
    return resolvePermissionMode(
      request.permissionMode,
      this.instanceConfig.config.tools.permissionModes,
    );
  }

  /**
   * The owned Chat and its row lock, then the turn: a user message of this
   * Chat with no user message after it. Every refusal here happens before any
   * job state is read, so a foreign Chat reveals nothing about its queue.
   */
  private async lockLatestTurn(
    chatsRepo: ChatsRepository,
    messagesRepo: MessagesRepository,
    input: { chatId: string; userId: string; userMessageId: string },
  ): Promise<Message> {
    const chat = await chatsRepo.findById(input.chatId, input.userId);
    if (!chat) {
      throw new NotFoundException(`Chat ${input.chatId} not found`);
    }
    // The row lock comes before the archive check (design D1): an archive that
    // commits after the lock is seen by the next request, not this one. The
    // lock writes nothing, so a refused request leaves the Chat untouched; the
    // admitted path bumps `updated_at` below, once the turn is accepted.
    const locked = await chatsRepo.lock(input.chatId, input.userId);
    if (!locked) {
      throw new NotFoundException(`Chat ${input.chatId} not found`);
    }
    assertNotArchived(locked);

    const { userMessage } = await messagesRepo.findTurnState(
      input.chatId,
      input.userId,
      input.userMessageId,
    );
    if (!userMessage) {
      throw new NotFoundException(`Message ${input.userMessageId} not found`);
    }
    if (
      await messagesRepo.hasLaterUserMessage(
        input.chatId,
        input.userId,
        userMessage.seq,
      )
    ) {
      throw new ConflictException(
        'A follow-up request applies to the latest user message only',
      );
    }
    return userMessage;
  }

  /**
   * The Continue check and the Run it admits. The Run's own model and effort
   * pass the chat-send checks again, so an operator who removed that model is
   * answered before any write; a stored effort stays exactly as it was.
   */
  private async continueRun(
    tx: Db,
    input: { chatId: string; userId: string },
    userMessage: Message,
    permissionMode: PermissionMode,
  ): Promise<AdmissionOutcome> {
    const decision = await this.continueDecision(tx, input, userMessage);
    if ('refusal' in decision) {
      return decision;
    }
    const { latestRun, source, effort } = decision;

    // Accepted: the Chat is the turn's latest activity again.
    await new ChatsRepository(tx).touch(input.chatId, input.userId);
    const { run, supersededRunIds } = await createRunForMessage(
      tx,
      {
        userId: input.userId,
        chatId: input.chatId,
        modelId: latestRun.modelId,
        effort,
        permissionMode,
        targetRunId: randomUUID(),
        followUp: await this.continueFollowUp(
          tx,
          input.userId,
          latestRun.id,
          source,
        ),
      },
      userMessage,
    );

    return {
      runId: run.id,
      userMessage: toRunUserMessage(userMessage),
      supersededRunIds,
      chatId: input.chatId,
      userId: input.userId,
      modelId: latestRun.modelId,
    };
  }

  /**
  /**
   * Everything the Continue check decides, as a value: a refusal is returned
   * so the transaction can commit the stuck-Run expiry it already performed.
   */
  private async continueDecision(
    tx: Db,
    input: { chatId: string; userId: string },
    userMessage: Message,
  ): Promise<ContinueDecision> {
    try {
      const { latestRun, source } = await this.continueSource(
        tx,
        input,
        userMessage,
      );
      return { latestRun, source, effort: this.storedEffort(latestRun) };
    } catch (error) {
      if (!isFollowUpRefusal(error)) throw error;
      return { refusal: error };
    }
  }

  /**
   * What the Continue Run's event log starts from: the reply's kept parts
   * through its last settled tool part, the step each kept call belongs to, and
   * whether the reply already recorded usage (turn-actions D4, D6, D11).
   */
  private async continueFollowUp(
    tx: Db,
    userId: string,
    sourceRunId: string,
    source: Message,
  ): Promise<FollowUpRunInput> {
    const keptParts = continueKeptParts(source.parts);
    const records = await this.continueRecords(
      tx,
      userId,
      sourceRunId,
      keptParts,
    );
    return {
      action: 'continue',
      sourceRunId,
      keptParts,
      keptStepNumbers: records.steps,
      keptResults: records.results,
      replacesUsage: source.usage !== null,
    };
  }

  /**
   * What the Continue Run records about its kept calls: the step each belongs
   * to — the source Run's own steps follow the ones it continued, so a chain
   * never merges two responses — and the result the source Run sent the model
   * (turn-actions D6).
   */
  private async continueRecords(
    tx: Db,
    userId: string,
    sourceRunId: string,
    keptParts: ReadonlyArray<unknown>,
  ): Promise<ContinuedRecords> {
    const events = new RunEventsRepository(tx);
    // SAFETY: the kept parts are the reply's own stored UI parts, and the
    // projection re-validates every part it reads.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const parts = keptParts as ReadonlyArray<MessagePart>;
    const sourceEvents = await events.listByRunId(sourceRunId, userId, {
      eventTypes: ['tool.requested', 'tool.completed'],
    });
    const sourceContinued = await events.findFirstByType(
      sourceRunId,
      userId,
      'run.continued',
    );
    return continuedRecords({
      keptParts: parts,
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
  private storedEffort(latestRun: Run): string | undefined {
    const model = this.models.validateModelSelection(latestRun.modelId);
    return latestRun.effort === null
      ? undefined
      : this.models.resolveEffortSelection(model, latestRun.effort);
  }

  /**
   * The message's latest Run and the reply it continues. The turn check has
   * already refused every later turn, so the Chat's newest Run is this
   * message's Run whenever the message has one.
   */
  private async continueSource(
    tx: Db,
    input: { chatId: string; userId: string },
    userMessage: Message,
  ): Promise<{ latestRun: Run; source: Message }> {
    const latestRun = await new RunsRepository(tx).findLatestByChatId(
      input.chatId,
      input.userId,
    );
    if (latestRun?.messageId !== userMessage.id) {
      throw new ConflictException('The message has no Run to follow up');
    }
    const reply = await new MessagesRepository(tx).findReply(
      input.chatId,
      input.userId,
      userMessage.id,
    );
    return { latestRun, source: this.continuableReply(latestRun, reply) };
  }

  /**
   * The reply a Continue Run continues, or a 409: the latest Run must be
   * resumable, its reply must exist, its usage must name that Run, and its
   * usage must not be `completed`.
   */
  private continuableReply(
    latestRun: Run,
    reply: Message | undefined,
  ): Message {
    if (!CONTINUABLE_RUN_STATUSES.includes(latestRun.status)) {
      throw new ConflictException(
        `A ${latestRun.status} Run cannot be continued`,
      );
    }
    if (reply === undefined) {
      throw new ConflictException(
        'The Run that can be continued left no reply',
      );
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
}
