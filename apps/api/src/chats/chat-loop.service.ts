import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import { assertNotArchived } from '../db/assert-not-archived';
import { type Chat, type Message, type Run } from '../db/schema';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { type ModelClient } from '../models/model-client';
import {
  ModelsService,
  type ModelSelectionValidator,
} from '../models/models.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { type MessagePart } from './context-builder';
import { isRecord } from '@workspace/runtime-safety';
import { isInflightUniqueViolation } from './inflight-unique-violation';
import { RunAbortRegistry, type RunAborter } from '../runs/run-abort-registry';
import { type RunUserMessage } from '../runs/run-execution.service';
import {
  RunStreamBridgeService,
  type RunStreamResponder,
} from '../runs/run-stream-bridge';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { stuckRunThresholdMs } from '../runs/run-queues';
import {
  RunDispatchService,
  type RunDispatcher,
} from '../runs/run-dispatch.service';
import { sanitizeClientMessageParts } from './context-item';

/**
 * Narrows a read-back message's `unknown[]` JSONB `parts` to `MessagePart[]`:
 * each part must be an object (the union's `Record<string, unknown>`
 * fallback arm), matching every other JSON-record boundary in this
 * codebase. Malformed (non-object) parts fail closed.
 */
function toMessageParts(parts: ReadonlyArray<unknown>): Array<MessagePart> {
  return parts.map((part) => {
    if (!isRecord(part)) {
      throw new Error('Malformed message part: expected an object');
    }
    return part;
  });
}

/** Project a persisted user Message into the wire `RunUserMessage` shape. */
function toRunUserMessage(message: Message): RunUserMessage {
  return {
    id: message.id,
    seq: message.seq,
    parts: toMessageParts(message.parts),
  };
}

export type ChatMessageInput = {
  id: string;
  parts: Array<MessagePart>;
};

/**
 * Accept-time inputs for the binding transaction: user identity, chat,
 * selected model/effort, and the sanitized message. Prompt rendering,
 * tool-catalog composition, and context-item derivation are resolved by
 * the executing worker at attempt time, not here.
 */
export type PersistUserMessageAndRunInput = {
  chatId: string;
  userId: string;
  modelId: string;
  /** Resolved at accept time; absent means "send no effort parameter". */
  effort: string | undefined;
  message: ChatMessageInput;
  targetRunId: string;
};

type ChatMessageStream = Pick<
  ReturnType<ModelClient['streamText']>,
  'toUIMessageStreamResponse'
>;

type CreateRunForMessageInput = {
  userId: string;
  chatId: string;
  modelId: string;
  effort: string | undefined;
  targetRunId: string;
};

type CreateRunForMessageResult = { run: Run; supersededRunIds: Array<string> };

type PersistUserMessageAndRunResult = {
  runId: string;
  userMessage: RunUserMessage;
  supersededRunIds: Array<string>;
};

type CreateMessageStreamInput = {
  chatId: string;
  userId: string;
  modelId: string;
  /** Requested by the caller; absent resolves the model's `defaultEffort`. */
  effort?: string;
  message: ChatMessageInput;
  abortSignal?: AbortSignal;
};

/**
 * ChatLoopService — the API side of a message turn (SPEC §9.5): validate,
 * store the message, create the run, enqueue it, and answer with the
 * run-event stream bridge. Prompt rendering, tool-catalog composition,
 * and context-item derivation are deferred to the executing worker —
 * this service persists only the accepted user message and Run identity.
 */
@Injectable()
export class ChatLoopService {
  private readonly logger = new Logger(ChatLoopService.name);

  constructor(
    // Each annotation below carries no DI metadata of its own (#268 — the
    // narrow capability type erases to `Object` at runtime), so the token is
    // explicit.
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(ModelsService)
    private readonly models: ModelSelectionValidator,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(RunStreamBridgeService)
    private readonly bridge: RunStreamResponder,
    @Inject(RunAbortRegistry)
    private readonly aborts: RunAborter,
    @Inject(RunDispatchService)
    private readonly dispatch: RunDispatcher,
  ) {}

  async createMessageStream(
    input: CreateMessageStreamInput,
  ): Promise<ChatMessageStream> {
    const model = this.models.validateModelSelection(input.modelId);
    // Resolved from the already-validated model, so an unavailable model is
    // reported without the effort ever being considered.
    const effort = this.models.resolveEffortSelection(model, input.effort);
    // Validate BEFORE any database work: a rejected message must not cost a
    // transaction, and input that was invalid anyway stays a 400.
    const message = this.sanitizeAndValidateMessage(input.message);

    const targetRunId = randomUUID();

    const { runId, userMessage, supersededRunIds } =
      await this.persistUserMessageAndRun({
        chatId: input.chatId,
        userId: input.userId,
        modelId: input.modelId,
        effort,
        message,
        targetRunId,
      });

    return this.finalizeAcceptedRun({
      runId,
      userMessage,
      supersededRunIds,
      chatId: input.chatId,
      userId: input.userId,
      modelId: input.modelId,
      abortSignal: input.abortSignal,
    });
  }

  private sanitizeAndValidateMessage(
    message: ChatMessageInput,
  ): ChatMessageInput {
    const sanitized = {
      ...message,
      parts: sanitizeClientMessageParts(message.parts),
    };
    if (sanitized.parts.length === 0) {
      throw new BadRequestException('Message must contain a text part');
    }
    return sanitized;
  }

  /**
   * Post-persistence side effects for a just-accepted run: abort any
   * in-process model call a superseded retry left running (after the tx
   * committed, so the superseded run is already terminally cancelled — first
   * writer wins), dispatch the durable execution (#50 — queue mechanics and
   * enqueue-failure handling live in RunDispatchService), and answer with the
   * run-event stream bridge. The HTTP connection is a viewport onto the
   * durable run — closing it does not kill the turn. No inline index here:
   * the assistant finalize re-indexes the whole chat (incl. this message); an
   * orphaned user-only turn (failed run) is caught by the discovery sweep.
   */
  private async finalizeAcceptedRun(input: {
    runId: string;
    userMessage: RunUserMessage;
    supersededRunIds: Array<string>;
    chatId: string;
    userId: string;
    modelId: string;
    abortSignal?: AbortSignal;
  }): Promise<ChatMessageStream> {
    for (const supersededRunId of input.supersededRunIds) {
      this.aborts.abort(supersededRunId);
    }

    await this.dispatch.dispatch({
      runId: input.runId,
      chatId: input.chatId,
      userId: input.userId,
      modelId: input.modelId,
      userMessage: input.userMessage,
    });

    const response = this.bridge.createUiMessageStreamResponse({
      runId: input.runId,
      userId: input.userId,
      abortSignal: input.abortSignal,
    });
    // The controller consumes only this one-method stream surface; the
    // bridge's Response satisfies it without claiming a full streamText result.
    return {
      toUIMessageStreamResponse: () => response,
    };
  }

  /**
   * Accepted-turn binding transaction: chat admission, single-flight,
   * user-message persistence, Run creation, and the run.created event.
   * Prompt rendering and tool-catalog composition are deferred to the
   * worker — this transaction establishes only the accepted user/model/effort
   * identity and the durable Run record.
   */
  private async persistUserMessageAndRun(
    input: PersistUserMessageAndRunInput,
  ): Promise<PersistUserMessageAndRunResult> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);
      const eventsRepo = new RunEventsRepository(tx);
      const runsRepo = new RunsRepository(tx);

      const { userMessage: admittedMessage } = await this.admitTurn(
        chatsRepo,
        messagesRepo,
        input,
      );
      await this.clearActiveRunSlot({ runsRepo, eventsRepo, ...input });

      // The user message is persisted with only the caller's sanitized text
      // parts. Context-rail items (model-switch, availability, digest,
      // temporal) are resolved by the executing worker and published
      // atomically with the successful assistant turn.
      const userMessage = await this.persistUserMessageIfAbsent(
        messagesRepo,
        admittedMessage,
        input,
        input.message.parts,
      );

      // Durable run (#48): every accepted user message becomes exactly one run
      // (SPEC §9.3). The run row + run.created land in the SAME transaction as
      // the user message, so a message can never exist without its execution
      // record. Reusing a message id is rejected above; retries are a separate
      // feature, not implicit idempotency.
      const { run, supersededRunIds } = await this.createRunForMessage(
        tx,
        input,
        userMessage,
      );

      return {
        runId: run.id,
        userMessage: toRunUserMessage(userMessage),
        supersededRunIds,
      };
    });
  }

  /**
   * Resolve/create the chat and admit the turn: refuse an archived chat and
   * a reused message id (a turn already carrying a user or assistant
   * message). Serializes predecessor reads for an accepted turn on a
   * pre-existing chat — the chat row lock ensures two transactions do not
   * both commit against the same baseline. A freshly inserted chat already
   * carries this transaction's row lock; an existing chat is locked here
   * (by the activity update) before any downstream state is read.
   */
  private async admitTurn(
    chatsRepo: ChatsRepository,
    messagesRepo: MessagesRepository,
    input: PersistUserMessageAndRunInput,
  ): Promise<{ chat: Chat; userMessage: Message | undefined }> {
    // First message creates the chat (#86): the client supplies the id
    // (routing + idempotency); the owner is always the session user. If the
    // chat is absent, upsert it; a conflict means the id is already taken —
    // by us (a concurrent first send) or by another tenant. Re-query to
    // disambiguate: our own row becomes visible (relies on the default READ
    // COMMITTED seeing the concurrent commit), a cross-tenant id stays
    // invisible → 404 (no existence leak).
    let chat = await chatsRepo.findById(input.chatId, input.userId);
    let createdByUs = false;
    if (!chat) {
      chat = await chatsRepo.createIfAbsent({
        id: input.chatId,
        ownerUserId: input.userId,
      });
      if (chat) {
        createdByUs = true;
      } else {
        chat = await chatsRepo.findById(input.chatId, input.userId);
      }
      if (!chat) {
        throw new NotFoundException(`Chat ${input.chatId} not found`);
      }
    }

    // Archive guard (chat-project-archive): a freshly created chat
    // (createdByUs) is never archived, so this only fires for a pre-existing
    // archived chat — sending does NOT unarchive.
    assertNotArchived(chat);

    const turn = await messagesRepo.findTurnState(
      input.chatId,
      input.userId,
      input.message.id,
    );
    if (turn.userMessage || turn.assistantMessage) {
      throw new ConflictException('Message id already exists');
    }

    if (!createdByUs) {
      chat = (await chatsRepo.touch(input.chatId, input.userId)) ?? chat;
    }

    return { chat, userMessage: turn.userMessage };
  }

  private async persistUserMessageIfAbsent(
    messagesRepo: MessagesRepository,
    existing: Message | undefined,
    input: PersistUserMessageAndRunInput,
    parts: Array<MessagePart>,
  ): Promise<Message> {
    const userMessage =
      existing ??
      (await messagesRepo.createUserMessageIfAbsent({
        id: input.message.id,
        chatId: input.chatId,
        senderUserId: input.userId,
        parts,
      }));
    if (!userMessage) {
      throw new ConflictException('Message id already exists');
    }
    return userMessage;
  }

  /**
   * The Run row, atomically with canceling any (defensively impossible, but
   * legacy-data-tolerant) stale active runs on this same message, and the
   * `run.created` event. No snapshot is bound — the worker resolves
   * prompt/catalog at execution time.
   */
  private async createRunForMessage(
    tx: Db,
    input: CreateRunForMessageInput,
    userMessage: Message,
  ): Promise<CreateRunForMessageResult> {
    const runsRepo = new RunsRepository(tx);
    const eventsRepo = new RunEventsRepository(tx);
    const superseded = await this.cancelSupersededRuns(
      runsRepo,
      eventsRepo,
      userMessage,
      input.userId,
    );

    const run = await this.createRunRow(tx, input, userMessage);
    await eventsRepo.append(run.id, 'run.created', {
      chatId: input.chatId,
      messageId: userMessage.id,
    });

    return { run, supersededRunIds: superseded.map((stale) => stale.id) };
  }

  /**
   * Defensive cleanup for impossible legacy state: a freshly inserted
   * message should have no older active runs, but if dev data violates that
   * invariant, canceling them preserves the per-chat single-flight slot.
   */
  private async cancelSupersededRuns(
    runsRepo: RunsRepository,
    eventsRepo: RunEventsRepository,
    userMessage: Message,
    userId: string,
  ): Promise<Array<Run>> {
    const superseded = await runsRepo.cancelActiveRunsForMessage(
      userMessage.id,
      userId,
    );
    for (const stale of superseded) {
      await eventsRepo.append(stale.id, 'run.cancelled', {
        reason: 'superseded by retry',
      });
    }
    return superseded;
  }

  /**
   * The Run row itself, in a savepoint (nested tx) so the single-flight
   * unique violation it may raise cannot poison the outer accepted-turn
   * transaction — `clearActiveRunSlot` above still needs it live.
   */
  private async createRunRow(
    tx: Db,
    input: CreateRunForMessageInput,
    userMessage: Message,
  ): Promise<Run> {
    try {
      return await tx.transaction((inner) =>
        new RunsRepository(inner).create({
          id: input.targetRunId,
          chatId: input.chatId,
          messageId: userMessage.id,
          userId: input.userId,
          modelId: input.modelId,
          effort: input.effort,
        }),
      );
    } catch (error) {
      if (isInflightUniqueViolation(error)) {
        throw new ConflictException(
          'Another run is already in flight for this chat',
        );
      }
      throw error;
    }
  }

  private async clearActiveRunSlot(input: {
    runsRepo: RunsRepository;
    eventsRepo: RunEventsRepository;
    chatId: string;
    userId: string;
  }): Promise<void> {
    const stuckAfterMs = stuckRunThresholdMs(this.instanceConfig.config);
    const isStuck = (run: Run) =>
      Date.now() - (run.startedAt ?? run.createdAt).getTime() >= stuckAfterMs;
    const findActive = () =>
      input.runsRepo.findActiveByChatId(input.chatId, input.userId);

    let blocking = await findActive();
    if (!blocking) return;
    if (!isStuck(blocking)) {
      // Re-check once: `blocking` may have finished between the read above
      // and now, or genuinely still be within its grace window.
      blocking = await findActive();
      if (!blocking) return;
      if (!isStuck(blocking)) {
        throw new ConflictException(
          'Another run is already in flight for this chat',
        );
      }
    }

    const message =
      'Expired by a new message: run stuck with no execution progress.';
    const expired = await input.runsRepo.markFinished(
      blocking.id,
      input.userId,
      'expired',
      { error: { message } },
    );
    if (expired) {
      await input.eventsRepo.append(blocking.id, 'run.expired', {
        status: 'expired',
        message,
      });
    }
  }
}
