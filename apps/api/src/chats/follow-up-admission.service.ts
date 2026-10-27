/**
 * Follow-up admission (turn-actions D1–D4): the service that turns a request
 * on an existing turn into a queued Run, with no HTTP route of its own.
 *
 * One transaction locks the Chat's row, checks that the turn is the latest
 * one, passes the chat send's single-flight admission, applies the action
 * check, and creates the Run with the parts its event log starts from. The
 * caller dispatches and streams the returned Run through
 * `ChatLoopService.finalizeAcceptedRun`, so a follow-up never runs as a plain
 * Run.
 */

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { assertNotArchived } from '../db/assert-not-archived';
import { type Message, type Run } from '../db/schema';
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
  type ModelSelectionValidator,
} from '../models/models.service';
import {
  RunDispatchService,
  type RunDispatcher,
} from '../runs/run-dispatch.service';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { type RunUserMessage } from '../runs/run-execution.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { clearActiveRunSlot } from './chat-admission';
import { continueKeptParts } from './continue-kept-parts';
import { continuableReply } from './follow-up-admission';
import {
  validateFollowUpRequest,
  type FollowUpRequestInput,
  type ValidatedFollowUpRequest,
} from './follow-up-request';
import { createRunForMessage, type FollowUpRunInput } from './run-creation';
import { toRunUserMessage } from './chat-message-parts';

/**
 * A follow-up Run that passed admission, shaped as `finalizeAcceptedRun`'
 * input: the caller dispatches and streams it exactly like an accepted chat
 * send.
 */
export type AdmittedFollowUpRun = {
  runId: string;
  userMessage: RunUserMessage;
  supersededRunIds: Array<string>;
  chatId: string;
  userId: string;
  modelId: string;
  followUp: FollowUpRunInput;
};

/** The settings the action check derives from the Run it continues. */
type ContinueSettings = {
  modelId: string;
  effort: string | undefined;
  followUp: FollowUpRunInput;
};

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
  }): Promise<AdmittedFollowUpRun> {
    // A refused request costs no transaction and writes nothing.
    const request = validateFollowUpRequest(
      input.request,
      this.instanceConfig.config.tools.permissionModes,
    );

    return this.tenantDb.runAs(input.userId, (tx) =>
      this.admitInTransaction(tx, input, request),
    );
  }

  private async admitInTransaction(
    tx: Db,
    input: {
      chatId: string;
      userId: string;
      userMessageId: string;
    },
    request: ValidatedFollowUpRequest,
  ): Promise<AdmittedFollowUpRun> {
    const eventsRepo = new RunEventsRepository(tx);
    const runsRepo = new RunsRepository(tx);
    const userMessage = await this.lockLatestTurn(
      new ChatsRepository(tx),
      new MessagesRepository(tx),
      input,
    );

    // A chat send's own single-flight admission: a live Run answers 409, and a
    // stuck Run is expired here so the action check reads its outcome.
    await clearActiveRunSlot({
      tx,
      runsRepo,
      eventsRepo,
      chatId: input.chatId,
      userId: input.userId,
      dispatch: this.dispatch,
      instanceConfig: this.instanceConfig,
    });

    return this.createFollowUpRun(tx, input, request, userMessage);
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
    assertNotArchived(chat);
    await chatsRepo.touch(input.chatId, input.userId);

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
   * The action check and the Run it admits: the message's latest Run and its
   * reply decide the kept parts, and the Run records the follow-up identity its
   * event log starts from.
   */
  private async createFollowUpRun(
    tx: Db,
    input: { chatId: string; userId: string; userMessageId: string },
    request: ValidatedFollowUpRequest,
    userMessage: Message,
  ): Promise<AdmittedFollowUpRun> {
    const continued = await this.continueSettingsFor(tx, input, userMessage);

    const { run, supersededRunIds } = await createRunForMessage(
      tx,
      {
        userId: input.userId,
        chatId: input.chatId,
        modelId: continued.modelId,
        effort: continued.effort,
        permissionMode: request.permissionMode,
        targetRunId: randomUUID(),
        followUp: continued.followUp,
      },
      userMessage,
    );

    return {
      runId: run.id,
      userMessage: toRunUserMessage(userMessage),
      supersededRunIds,
      chatId: input.chatId,
      userId: input.userId,
      modelId: continued.modelId,
      followUp: continued.followUp,
    };
  }

  /**
   * The message's latest Run and its reply, then the Continue check on them.
   * A message with no Run has nothing to follow up.
   */
  private async continueSettingsFor(
    tx: Db,
    input: { chatId: string; userId: string },
    userMessage: Message,
  ): Promise<ContinueSettings> {
    const latestRun = await new RunsRepository(tx).findLatestForMessage(
      userMessage.id,
      input.userId,
    );
    if (!latestRun) {
      throw new ConflictException('The message has no Run to follow up');
    }
    const { assistantMessage: reply } = await new MessagesRepository(
      tx,
    ).findTurnState(input.chatId, input.userId, userMessage.id);
    return this.continueSettings(latestRun, reply);
  }

  /**
   * The Continue action check (turn-actions D2): the resumable Run and its
   * unfinished reply decide what the new Run keeps, and the Run's own model and
   * effort pass the chat-send checks again — an operator who removed that
   * model is answered before any write.
   */
  private continueSettings(
    latestRun: Run,
    reply: Message | undefined,
  ): ContinueSettings {
    const source = continuableReply(latestRun, reply);
    const model = this.models.validateModelSelection(latestRun.modelId);
    return {
      modelId: latestRun.modelId,
      effort: this.models.resolveEffortSelection(
        model,
        latestRun.effort ?? undefined,
      ),
      followUp: {
        action: 'continue',
        sourceRunId: latestRun.id,
        keptParts: continueKeptParts(source.parts),
        replacesUsage: source.usage !== null,
      },
    };
  }
}
