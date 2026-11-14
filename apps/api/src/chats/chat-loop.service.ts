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
import { type Chat, type ChatDelivery, type Message } from '../db/schema';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { type ModelClient } from '../models/model-client';
import {
  ModelsService,
  resolveSendSettings,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import {
  creationInProgress,
  tryCreationTransactionLock,
} from './chat-creation-lock';
import { type RunUserMessage } from '../runs/run-execution.service';
import {
  RunStreamBridgeService,
  type RunStreamResponder,
} from '../runs/run-stream-bridge';
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
import {
  claimActiveRunSlot,
  clearActiveRunSlot,
  notifyLiveRunSteering,
} from './chat-admission';
import { RunWaitService } from '../runs/run-wait.service';
import { retryRunTransaction } from '../runs/run-transaction';
import { type SendableDeliveryMode } from './dto/chat-deliveries.dto';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { createRunForMessage } from './run-creation';

/**
 * A Run that passed admission, and the identity its dispatch needs: what
 * `finalizeAcceptedRun` consumes, and what a follow-up admission returns.
 */
export type AcceptedRun = {
  runId: string;
  userMessage: RunUserMessage;
  chatId: string;
  userId: string;
  modelId: string;
  abortSignal?: AbortSignal;
};

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
  /**
   * Set when the sender accepts a pending item in place of a 409: a live Run
   * stores the message as an item, an idle Chat starts a Run as usual.
   */
  delivery?: SendableDeliveryMode | undefined;
  targetRunId: string;
  /**
   * Whether this transaction must win the Chat's creation lock: true on the
   * message route, false inside a create request, which already holds that
   * Chat's session lock and would otherwise deadlock against itself.
   */
  takeCreationLock: boolean;
};

export type ChatMessageStream = Pick<
  ReturnType<ModelClient['streamText']>,
  'toUIMessageStreamResponse'
>;

type PersistUserMessageAndRunResult = {
  runId: string;
  userMessage: RunUserMessage;
};

/**
 * The answer of a delivery send that stored or found an item and started no
 * Run (run-steering D2): the controller answers 202 with it.
 */
export type PendingDeliveryAnswer = { delivery: ChatDelivery };

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
    @Inject(RunDispatchService)
    private readonly dispatch: RunDispatcher,
    @Inject(MediaService)
    private readonly media: MediaDescriber,
    @Inject(RunWaitService)
    private readonly runWait: Pick<RunWaitService, 'wakeForChatInTransaction'>,
  ) {}

  /**
   * A plain chat send. It answers a stored pending item of the same message id
   * (run-steering D2) and starts nothing then; otherwise it starts a Run.
   */
  createMessageStream(
    input: CreateMessageStreamInput,
  ): Promise<ChatMessageStream | PendingDeliveryAnswer> {
    return this.send(input, undefined);
  }

  /**
   * A chat send that names a delivery mode (run-steering D2): with a live Run
   * it stores a pending item and answers it, with an idle Chat it is a plain
   * send. A retry of the same message id answers the stored item.
   */
  createDeliveryMessage(
    input: CreateMessageStreamInput & { delivery: SendableDeliveryMode },
  ): Promise<ChatMessageStream | PendingDeliveryAnswer> {
    return this.send(input, input.delivery);
  }

  private async send(
    input: CreateMessageStreamInput,
    delivery: SendableDeliveryMode | undefined,
  ): Promise<ChatMessageStream | PendingDeliveryAnswer> {
    // Validate BEFORE any database work: a rejected message must not cost a
    // transaction, and input that was invalid anyway stays a 400.
    const turn = await this.validateTurn(input);

    const admitted = await this.persistUserMessageAndRun({
      chatId: input.chatId,
      userId: input.userId,
      ...turn,
      delivery,
      targetRunId: randomUUID(),
      takeCreationLock: true,
    });

    if ('delivery' in admitted) return admitted;

    return this.finalizeAcceptedRun({
      ...admitted,
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
    const { effort, permissionMode } = resolveSendSettings(
      this.models,
      this.instanceConfig.config.tools.permissionModes,
      input,
    );

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
    const admitted = await this.persistUserMessageAndRun({
      chatId: input.chatId,
      userId: input.userId,
      ...input.turn,
      targetRunId: randomUUID(),
      takeCreationLock: false,
    });

    // The Chat of a create request is new, so no item of it can exist; an id
    // of another Chat's item is refused in admission. This is the same refusal.
    if ('delivery' in admitted) {
      throw new ConflictException('Message id already exists');
    }

    const { runId, userMessage } = admitted;
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
   * Post-persistence side effects for a just-accepted run: dispatch the durable execution (#50 — queue mechanics and
   * enqueue-failure handling live in RunDispatchService), and answer with the
   * run-event stream bridge. The HTTP connection is a viewport onto the
   * durable run — closing it does not kill the turn. No inline index here:
   * the assistant finalize re-indexes the whole chat (incl. this message); an
   * orphaned user-only turn (failed run) is caught by the discovery sweep.
   */
  async finalizeAcceptedRun(input: AcceptedRun): Promise<ChatMessageStream> {
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
  ): Promise<PersistUserMessageAndRunResult | PendingDeliveryAnswer> {
    // Media ownership was decided by `validateTurn` before this transaction
    // opened: a file part naming media the sender does not own rejects the
    // message before any chat or message row is written. Media is immutable, so
    // reading it in its own transaction races nothing.
    return retryRunTransaction(() =>
      this.tenantDb.runAs(input.userId, async (tx) => {
        await this.takeCreationLock(tx, input);
        const chatsRepo = new ChatsRepository(tx);
        const messagesRepo = new MessagesRepository(tx);

        const { chat, createdByUs } = await this.resolveChat(chatsRepo, input);

        const item = await this.findStoredItem(
          tx,
          chatsRepo,
          input,
          createdByUs,
        );

        if (item) return { delivery: item };

        const admittedMessage = await this.admitTurn(
          chat,
          createdByUs,
          chatsRepo,
          messagesRepo,
          input,
        );

        return this.persistAcceptedMessageAndRun(
          tx,
          messagesRepo,
          input,
          admittedMessage,
        );
      }),
    );
  }

  /**
   * Persist the accepted user message and its Run in the admission
   * transaction, then release pending job notices to that Run.
   */
  private async persistAcceptedMessageAndRun(
    tx: Db,
    messagesRepo: MessagesRepository,
    input: PersistUserMessageAndRunInput,
    admittedMessage: Message | undefined,
  ): Promise<PersistUserMessageAndRunResult | PendingDeliveryAnswer> {
    const pending = await this.admitToSlot(tx, input);

    if (pending) return pending;

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
    const { run } = await createRunForMessage(tx, input, userMessage);
    await new ChatDeliveriesRepository(tx).deliverPendingJobNotices(
      input.chatId,
      input.userId,
      { messageId: userMessage.id, runId: run.id },
    );

    return {
      runId: run.id,
      userMessage: toRunUserMessage(userMessage),
    };
  }
  /**
   * The single-flight step of admission. A send without `delivery` answers 409
   * while a live Run holds the slot. A delivery send stores the message as a
   * pending item instead: neither a message row nor a Run (run-steering D2).
   * Without a live blocker the send goes on to start its Run, whatever
   * `delivery` says. An id that already names a message of the owner, in any
   * Chat, is a duplicate and is refused before the item is stored.
   */
  private async admitToSlot(
    tx: Db,
    input: PersistUserMessageAndRunInput,
  ): Promise<PendingDeliveryAnswer | undefined> {
    const slot = {
      tx,
      chatId: input.chatId,
      userId: input.userId,
      dispatch: this.dispatch,
      instanceConfig: this.instanceConfig,
    };

    if (input.delivery === undefined) {
      await clearActiveRunSlot(slot);

      return undefined;
    }

    if ((await claimActiveRunSlot(slot)) === 'free') return undefined;
    const deliveries = new ChatDeliveriesRepository(tx);

    if (await deliveries.messageIdTaken(input.message.id, input.userId)) {
      throw new ConflictException('Message id already exists');
    }

    const created = await deliveries.insertPending({
      id: input.message.id,
      chatId: input.chatId,
      ownerUserId: input.userId,
      mode: input.delivery,
      parts: input.parts,
      settings: {
        modelId: input.modelId,
        ...(input.effort !== undefined && { effort: input.effort }),
        permissionMode: input.permissionMode,
      },
    });

    if (!created) throw new ConflictException('Message id already exists');

    if (input.delivery === 'interrupt' || input.delivery === 'steer') {
      await notifyLiveRunSteering(tx, input, input.delivery, this.runWait);
    }

    return { delivery: created };
  }

  /**
   * The Chat's creation lock, inside the admission transaction: a create
   * request holding it answers 409 here, and this route holds it only until the
   * transaction ends, never for the life of the Run.
   */
  private async takeCreationLock(
    tx: Db,
    input: PersistUserMessageAndRunInput,
  ): Promise<void> {
    if (
      input.takeCreationLock &&
      !(await tryCreationTransactionLock(tx, input.chatId))
    ) {
      throw creationInProgress();
    }
  }

  /**
   * Resolve or create the chat: the first message creates the chat (#86). The
   * client supplies the id (routing + idempotency); the owner is always the
   * session user. If the chat is absent, upsert it; a conflict means the id is
   * already taken — by us (a concurrent first send) or by another tenant.
   * Re-query to disambiguate: our own row becomes visible (relies on the
   * default READ COMMITTED seeing the concurrent commit), a cross-tenant id
   * stays invisible → 404 (no existence leak).
   */
  private async resolveChat(
    chatsRepo: ChatsRepository,
    input: PersistUserMessageAndRunInput,
  ): Promise<{ chat: Chat; createdByUs: boolean }> {
    let chat = await chatsRepo.findById(input.chatId, input.userId);

    if (chat) return { chat, createdByUs: false };
    chat = await chatsRepo.createIfAbsent({
      id: input.chatId,
      ownerUserId: input.userId,
    });

    if (chat) return { chat, createdByUs: true };
    chat = await chatsRepo.findById(input.chatId, input.userId);

    if (!chat) {
      throw new NotFoundException(`Chat ${input.chatId} not found`);
    }

    return { chat, createdByUs: false };
  }

  /**
   * The owner-produced pending item already stored under the message id of
   * this send, in any state. A retry repeats the id, so the stored item answers
   * it before the duplicate-id check would refuse the id and before any Run
   * starts (run-steering D2); a job-produced item or an item of another Chat
   * conflicts. A delivery send takes the Chat row lock first, which serializes
   * two sends of one id; a plain send keeps the lock for `touch`, as before.
   */
  private async findStoredItem(
    tx: Db,
    chatsRepo: ChatsRepository,
    input: PersistUserMessageAndRunInput,
    createdByUs: boolean,
  ): Promise<ChatDelivery | undefined> {
    if (input.delivery !== undefined && !createdByUs) {
      await chatsRepo.lock(input.chatId, input.userId);
    }

    const item = await new ChatDeliveriesRepository(tx).findById(
      input.message.id,
      input.userId,
    );

    if (item && (item.chatId !== input.chatId || item.producer !== 'owner')) {
      throw new ConflictException('Message id already exists');
    }

    return item;
  }

  /**
   * Admit the turn: refuse an archived chat and a reused message id (a turn
   * already carrying a user or assistant message). Serializes predecessor
   * reads for an accepted turn on a pre-existing chat — the chat row lock
   * ensures two transactions do not both commit against the same baseline. A
   * freshly inserted chat already carries this transaction's row lock; an
   * existing chat is locked here (by the activity update) before any
   * downstream state is read.
   */
  private async admitTurn(
    chat: Chat,
    createdByUs: boolean,
    chatsRepo: ChatsRepository,
    messagesRepo: MessagesRepository,
    input: PersistUserMessageAndRunInput,
  ): Promise<Message | undefined> {
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

    if (!createdByUs) await chatsRepo.touch(input.chatId, input.userId);

    return turn.userMessage;
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
}
