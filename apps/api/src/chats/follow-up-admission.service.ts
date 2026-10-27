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
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { createRunForMessage } from './run-creation';
import { RunsRepository } from '../runs/runs-repository';

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
    // The checks that need no stored state, before the transaction: `continue`
    // is the only action this layer can execute, and a model or an effort it
    // names would be silently ignored.
    if (input.request.action !== 'continue') {
      throw new BadRequestException('action must be continue');
    }
    if (input.request.modelId !== undefined) {
      throw new BadRequestException('A continue request does not name a model');
    }
    if (input.request.effort !== undefined) {
      throw new BadRequestException(
        'A continue request does not name an effort',
      );
    }
    const permissionMode = resolvePermissionMode(
      input.request.permissionMode,
      this.instanceConfig.config.tools.permissionModes,
    );

    return this.tenantDb.runAs(input.userId, async (tx) => {
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
    });
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
    // commits after the lock is seen by the next request, not this one.
    const locked = await chatsRepo.touch(input.chatId, input.userId);
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
  ): Promise<AcceptedRun> {
    const { latestRun, source } = await this.continueSource(
      tx,
      input,
      userMessage,
    );
    const effort = this.storedEffort(latestRun);

    const { run, supersededRunIds } = await createRunForMessage(
      tx,
      {
        userId: input.userId,
        chatId: input.chatId,
        modelId: latestRun.modelId,
        effort,
        permissionMode,
        targetRunId: randomUUID(),
        followUp: {
          action: 'continue',
          sourceRunId: latestRun.id,
          keptParts: continueKeptParts(source.parts),
          replacesUsage: source.usage !== null,
        },
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
