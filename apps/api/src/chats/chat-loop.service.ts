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
  PermissionModeNotAvailableError,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { isInflightUniqueViolation } from './inflight-unique-violation';
import {
  creationInProgress,
  tryCreationTransactionLock,
} from './chat-creation-lock';
import { RunAbortRegistry, type RunAborter } from '../runs/run-abort-registry';
import { type RunUserMessage } from '../runs/run-execution.service';
import {
  RunStreamBridgeService,
  type RunStreamResponder,
} from '../runs/run-stream-bridge';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { finalizeRunReply } from '../runs/run-reply-finalizer';
import { heartbeatSeconds } from '../runs/run-queues';
import {
  RunDispatchService,
  type RunDispatcher,
} from '../runs/run-dispatch.service';
import {
  sanitizeClientMessageParts,
  type ClientMessagePart,
} from './context-item';
import { MediaService, type MediaDescriber } from '../media/media.service';
import { type MessagePart } from './context-builder';
import { resolveOwnerFileParts, toRunUserMessage } from './chat-message-parts';

/** How long admission waits on the blocking run's job state (see blockerIsLive). */
const JOB_STATE_READ_TIMEOUT_MS = 5000;

/** A message as a caller sent it: parts are untrusted until sanitized. */
export type ChatMessageInput = {
  id: string;
  parts: ReadonlyArray<unknown>;
};

/**
 * One turn that passed every pre-write check: the model selection, the
 * permission mode, the parts, and the ownership of every media part. Chat
 * creation validates before it stores a chat; the message route validates
 * before it opens its transaction.
 */
export type ValidatedChatTurn = {
  modelId: string;
  /** Resolved at accept time; absent means "send no effort parameter". */
  effort: string | undefined;
  permissionMode: PermissionMode;
  message: { id: string; parts: Array<ClientMessagePart> };
  /** The message parts with every file part resolved to its stored media. */
  parts: Array<MessagePart>;
};

/**
 * Accept-time inputs for the binding transaction: user identity, chat,
 * selected model/effort/mode, and the sanitized message. Prompt rendering,
 * tool-catalog composition, and context-item derivation are resolved by
 * the executing worker at attempt time, not here.
 */
export type PersistUserMessageAndRunInput = {
  chatId: string;
  userId: string;
  modelId: string;
  /** Resolved at accept time; absent means "send no effort parameter". */
  effort: string | undefined;
  /** Validated at accept time and persisted on the Run. */
  permissionMode: PermissionMode;
  message: { id: string; parts: Array<ClientMessagePart> };
  /** The sanitized message with its file parts already resolved. */
  parts: Array<MessagePart>;
  targetRunId: string;
  /**
   * Whether this transaction must win the Chat's creation lock: true on the
   * message route, false inside a create request, which already holds that
   * Chat's session lock and would otherwise deadlock against itself.
   */
  takeCreationLock: boolean;
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
  permissionMode: PermissionMode;
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
  /** Requested by the caller; absent resolves to the default permission mode. */
  permissionMode?: PermissionMode;
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
    @Inject(MediaService)
    private readonly media: MediaDescriber,
  ) {}

  async createMessageStream(
    input: CreateMessageStreamInput,
  ): Promise<ChatMessageStream> {
    // Validate BEFORE any database work: a rejected message must not cost a
    // transaction, and input that was invalid anyway stays a 400.
    const turn = await this.validateTurn(input);
    const targetRunId = randomUUID();

    const { runId, userMessage, supersededRunIds } =
      await this.persistUserMessageAndRun({
        chatId: input.chatId,
        userId: input.userId,
        ...turn,
        targetRunId,
        takeCreationLock: true,
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

  /**
   * Every pre-write check of one turn, shared by the message route and chat
   * creation: the model, its effort, an enabled permission mode, the bounded
   * parts, and the sender's ownership of every media part. Nothing here writes.
   */
  async validateTurn(input: {
    userId: string;
    modelId: string;
    effort?: string;
    permissionMode?: PermissionMode;
    message: ChatMessageInput;
  }): Promise<ValidatedChatTurn> {
    const model = this.models.validateModelSelection(input.modelId);
    // Resolved from the already-validated model, so an unavailable model is
    // reported without the effort ever being considered.
    const effort = this.models.resolveEffortSelection(model, input.effort);
    const permissionMode: PermissionMode = input.permissionMode ?? 'default';
    if (
      !this.instanceConfig.config.tools.permissionModes.includes(permissionMode)
    ) {
      throw new PermissionModeNotAvailableError(permissionMode);
    }
    const message = this.sanitizeAndValidateMessage(input.message);
    return {
      modelId: input.modelId,
      effort,
      permissionMode,
      message,
      parts: await resolveOwnerFileParts(
        this.media,
        input.userId,
        message.parts,
      ),
    };
  }

  /**
   * The message step of a create request: the same accepted-turn transaction
   * and the same post-commit enqueue as a send, under the create's own session
   * lock instead of taking the Chat's creation lock again. The create answers
   * JSON, so the stream bridge is not involved; the client resumes through
   * `GET /api/v1/chats/:id/stream`.
   */
  async startFirstRun(input: {
    chatId: string;
    userId: string;
    turn: ValidatedChatTurn;
  }): Promise<{ runId: string }> {
    const { runId, userMessage, supersededRunIds } =
      await this.persistUserMessageAndRun({
        chatId: input.chatId,
        userId: input.userId,
        ...input.turn,
        targetRunId: randomUUID(),
        takeCreationLock: false,
      });
    for (const supersededRunId of supersededRunIds) {
      this.aborts.abort(supersededRunId);
    }
    await this.dispatch.dispatch({
      runId,
      chatId: input.chatId,
      userId: input.userId,
      modelId: input.turn.modelId,
      userMessage,
    });
    return { runId };
  }

  private sanitizeAndValidateMessage(
    message: ChatMessageInput,
  ): PersistUserMessageAndRunInput['message'] {
    const sanitized = {
      id: message.id,
      parts: sanitizeClientMessageParts(message.parts),
    };
    if (sanitized.parts.length === 0) {
      throw new BadRequestException('Message must contain a text or file part');
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
   * worker — this transaction establishes only the accepted user/model/effort/mode
   * identity and the durable Run record.
   */
  private async persistUserMessageAndRun(
    input: PersistUserMessageAndRunInput,
  ): Promise<PersistUserMessageAndRunResult> {
    // Media ownership was decided by `validateTurn` before this transaction
    // opened: a file part naming media the sender does not own rejects the
    // message before any chat or message row is written. Media is immutable, so
    // reading it in its own transaction races nothing.
    return this.tenantDb.runAs(input.userId, async (tx) => {
      // The Chat's creation lock, inside the admission transaction: a create
      // request holding it answers 409 here, and this route holds it only until
      // the transaction ends, never for the life of the Run.
      if (
        input.takeCreationLock &&
        !(await tryCreationTransactionLock(tx, input.chatId))
      ) {
        throw creationInProgress();
      }
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);
      const eventsRepo = new RunEventsRepository(tx);
      const runsRepo = new RunsRepository(tx);

      const { userMessage: admittedMessage } = await this.admitTurn(
        chatsRepo,
        messagesRepo,
        input,
      );
      await this.clearActiveRunSlot({ tx, runsRepo, eventsRepo, ...input });

      // The user message is persisted with only the caller's sanitized text
      // and resolved file parts. Context-rail items (model-switch,
      // availability, digest, temporal) are resolved by the executing worker
      // and stored on this message by the attempt's dispatch transaction,
      // before its first request.
      const userMessage = await this.persistUserMessageIfAbsent(
        messagesRepo,
        admittedMessage,
        input,
        input.parts,
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
          permissionMode: input.permissionMode,
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

  /**
   * Whether a run still in flight is one the queue can execute, judged by its
   * own job's state rather than by its age: a queued, retrying, or active job
   * is live however long the run has existed. A job-less run is still treated
   * as live for one liveness window, because the enqueue can legitimately
   * land just after the run row committed. Anything else — absent and older
   * than that, or a settled job — means the queue can no longer execute it.
   *
   * The read runs inside the accepted-turn transaction, which holds the chat
   * row, so it is bounded; a state it cannot read in time, or at all, cannot
   * prove the run wedged and counts as live (409), never as expirable.
   */
  private async blockerIsLive(run: Run): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const state = await Promise.race([
      this.dispatch.jobState(run.id),
      new Promise<'unreadable'>((resolve) => {
        timer = setTimeout(
          () => resolve('unreadable'),
          JOB_STATE_READ_TIMEOUT_MS,
        );
      }),
    ])
      .catch(() => 'unreadable' as const)
      .finally(() => clearTimeout(timer));
    if (state !== 'absent') {
      return (
        state === 'unreadable' ||
        state === 'queued' ||
        state === 'retrying' ||
        state === 'active'
      );
    }
    const lastSignOfLife = run.startedAt ?? run.createdAt;
    return (
      Date.now() - lastSignOfLife.getTime() <
      heartbeatSeconds(this.instanceConfig.config) * 1000
    );
  }

  private async clearActiveRunSlot(input: {
    tx: Db;
    runsRepo: RunsRepository;
    eventsRepo: RunEventsRepository;
    chatId: string;
    userId: string;
  }): Promise<void> {
    const findActive = () =>
      input.runsRepo.findActiveByChatId(input.chatId, input.userId);
    const blocking = await findActive();
    if (!blocking) return;
    if (await this.blockerIsLive(blocking)) {
      // Re-check the row once: `blocking` may have finished between the read
      // above and now, in which case the chat is simply free. Its job state
      // is not read again, so one send holds the chat row for at most one
      // bounded wait.
      if (await findActive()) {
        throw new ConflictException(
          'Another run is already in flight for this chat',
        );
      }
      return;
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
      // The chat row is held first and the run row next, so finalizing the
      // reply after them keeps the worker's run-then-reply order.
      await finalizeRunReply(input.tx, {
        run: expired,
        status: 'expired',
        models: this.instanceConfig.config.models,
      });
      await input.eventsRepo.append(blocking.id, 'run.expired', {
        status: 'expired',
        message,
      });
    }
  }
}
