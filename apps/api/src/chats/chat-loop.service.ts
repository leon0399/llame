import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import { assertNotArchived } from '../db/assert-not-archived';
import {
  type Chat,
  type ChatDelivery,
  type Message,
  type Run,
} from '../db/schema';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { type ModelClient } from '../models/model-client';
import {
  ModelsService,
  resolvePermissionMode,
  resolveSendSettings,
  type ModelSelectionValidator,
  type ResolvedSendSettings,
} from '../models/models.service';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { resolveSendChat, takeCreationLock } from './chat-send-chat';
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
import { createRunForMessage, runSelectionFields } from './run-creation';
import { storeOwnerSelection } from './owner-selection';

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
 * One turn that passed every pre-write check: the selector and effort the
 * request named (both resolved inside the admission transaction), the
 * permission mode, the bounded parts, and the ownership of every media part.
 * Chat creation validates before it opens its admission transaction; the
 * message route does the same.
 */
export type ValidatedChatTurn = {
  /** The selector the request named; undefined means "use the stored or default". */
  selector: string | undefined;
  /** The effort the request named; undefined means "follow the spec's order". */
  effort: string | undefined;
  permissionMode: PermissionMode;
  message: { id: string; parts: Array<ClientMessagePart> };
  /** The message parts with every file part resolved to its stored media. */
  parts: Array<MessagePart>;
};

/**
 * Accept-time inputs for the binding transaction: user identity, chat, the
 * selector and effort the request named, the enabled permission mode, and the
 * sanitized message. The selector, its model, and the effort are resolved
 * inside that transaction, against the selection the Chat row stores. Prompt
 * rendering, tool-catalog composition, and context-item derivation are
 * resolved by the executing worker at attempt time, not here.
 */
export type PersistUserMessageAndRunInput = {
  chatId: string;
  userId: string;
  selector: string | undefined;
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
  /** The model the first segment serves, as admission resolved it. */
  modelId: string;
};

/**
 * The answer of a delivery send that stored or found an item and started no
 * Run (run-steering D2): the controller answers 202 with it.
 */
export type PendingDeliveryAnswer = { delivery: ChatDelivery };

/** The Chat's single-flight slot as this send found it. */
type SlotClaim =
  | { readonly state: 'free' }
  | {
      readonly state: 'blocked';
      readonly kind: Run['kind'];
      /** The mode the pending item stores, as the send or the slot dictates. */
      readonly mode: SendableDeliveryMode;
    };

type CreateMessageStreamInput = {
  chatId: string;
  userId: string;
  /** The selector the caller named; absent uses the Chat's stored selection. */
  selector?: string;
  /** Requested by the caller; absent follows the spec's effort order. */
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
    // Validate the request's shape and its permission mode BEFORE any database
    // work: a rejected message must not cost a transaction, and input that was
    // invalid anyway stays a 400. The selector and the effort resolve inside
    // the admission transaction, against the Chat's stored selection.
    const turn = await this.validateTurn(input);

    const admitted = await this.persistUserMessageAndRun({
      chatId: input.chatId,
      userId: input.userId,
      selector: turn.selector,
      effort: turn.effort,
      permissionMode: turn.permissionMode,
      message: turn.message,
      parts: turn.parts,
      delivery,
      targetRunId: randomUUID(),
      takeCreationLock: true,
    });

    if ('delivery' in admitted) return admitted;

    return this.finalizeAcceptedRun({
      ...admitted,
      chatId: input.chatId,
      userId: input.userId,
      modelId: admitted.modelId,
      abortSignal: input.abortSignal,
    });
  }

  /**
   * Every pre-write check of one turn, shared by the message route and chat
   * creation: an enabled permission mode, the bounded parts, and the sender's
   * ownership of every media part. Nothing here writes, and nothing here needs
   * the Chat row — the selector, its model, and the effort are resolved inside
   * the admission transaction instead (design D3).
   */
  async validateTurn(input: {
    userId: string;
    selector?: string;
    effort?: string;
    permissionMode?: PermissionMode;
    message: ChatMessageInput;
  }): Promise<ValidatedChatTurn> {
    const message = this.sanitizeAndValidateMessage(input.message);

    const permissionMode = resolvePermissionMode(
      input.permissionMode,
      this.instanceConfig.config.tools.permissionModes,
    );

    return {
      selector: input.selector,
      effort: input.effort,
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
      modelId: admitted.modelId,
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
      chatId: input.chatId,
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
      this.tenantDb.runAs(input.userId, (tx) =>
        this.admitUserMessageAndRun(tx, input),
      ),
    );
  }

  /** The admission transaction itself: every step below runs in `tx`. */
  private async admitUserMessageAndRun(
    tx: Db,
    input: PersistUserMessageAndRunInput,
  ): Promise<PersistUserMessageAndRunResult | PendingDeliveryAnswer> {
    await takeCreationLock(tx, input);
    const chatsRepo = new ChatsRepository(tx);
    const messagesRepo = new MessagesRepository(tx);

    const { chat, createdByUs } = await resolveSendChat(chatsRepo, input);
    const item = await this.findStoredItem(tx, chatsRepo, input, createdByUs);

    if (item) return { delivery: item };

    const turn = await this.admitTurn(
      chat,
      createdByUs,
      chatsRepo,
      messagesRepo,
      input,
    );

    return this.persistAcceptedTurn(tx, {
      input,
      turn,
      chatsRepo,
      messagesRepo,
    });
  }

  /**
   * Resolve the selection and start the Run, after every check before them
   * answered: the selector, its model, and the effort answer 422 here, inside
   * this transaction, so a 422 rolls back every write it made.
   */
  private async persistAcceptedTurn(
    tx: Db,
    context: {
      input: PersistUserMessageAndRunInput;
      turn: { chat: Chat; userMessage: Message | undefined };
      chatsRepo: ChatsRepository;
      messagesRepo: MessagesRepository;
    },
  ): Promise<PersistUserMessageAndRunResult | PendingDeliveryAnswer> {
    const { input, turn, chatsRepo, messagesRepo } = context;

    const slot = await this.claimSlot(tx, input);

    const selection = resolveSendSettings(
      this.models,
      this.instanceConfig.config.tools.permissionModes,
      {
        stored: turn.chat.modelSelection ?? null,
        request: { selector: input.selector, effort: input.effort },
        writer: 'owner',
        permissionMode: input.permissionMode,
      },
    );

    await storeOwnerSelection(chatsRepo, turn.chat, selection);

    return this.persistAcceptedMessageAndRun(
      tx,
      messagesRepo,
      input,
      turn.userMessage,
      slot,
      selection,
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
    slot: SlotClaim,
    selection: ResolvedSendSettings,
  ): Promise<PersistUserMessageAndRunResult | PendingDeliveryAnswer> {
    const pending = await this.storeOrStart(tx, input, slot);

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

    return this.createAcceptedRun(tx, input, userMessage, selection);
  }

  /**
   * Durable run (#48): every accepted user message becomes exactly one run
   * (SPEC §9.3). The run row + run.created land in the SAME transaction as the
   * user message, so a message can never exist without its execution record.
   * Reusing a message id is rejected above; retries are a separate feature, not
   * implicit idempotency.
   */
  private async createAcceptedRun(
    tx: Db,
    input: PersistUserMessageAndRunInput,
    userMessage: Message,
    selection: ResolvedSendSettings,
  ): Promise<PersistUserMessageAndRunResult> {
    const { run } = await createRunForMessage(
      tx,
      {
        userId: input.userId,
        chatId: input.chatId,
        ...runSelectionFields(selection),
        targetRunId: input.targetRunId,
      },
      userMessage,
    );

    await new ChatDeliveriesRepository(tx).deliverPendingJobNotices(
      input.chatId,
      input.userId,
      { messageId: userMessage.id, runId: run.id },
    );

    return {
      runId: run.id,
      userMessage: toRunUserMessage(userMessage),
      modelId: selection.modelId,
    };
  }
  /**
   * The single-flight step of admission. A send without `delivery` answers 409
   * while a live Run holds the slot. A delivery send claims the slot and, when
   * a live Run holds it, goes on to store the message as a pending item
   * instead (run-steering D2). An id that already names a message of the
   * owner, in any Chat, is a duplicate and is refused before the item is
   * stored — and before the selector is judged, so this 409 wins over a 422.
   */
  private async claimSlot(
    tx: Db,
    input: PersistUserMessageAndRunInput,
  ): Promise<SlotClaim> {
    const slot = {
      tx,
      chatId: input.chatId,
      userId: input.userId,
      dispatch: this.dispatch,
      instanceConfig: this.instanceConfig,
    };

    if (input.delivery === undefined) {
      await clearActiveRunSlot(slot);

      return { state: 'free' };
    }

    const slotState = await claimActiveRunSlot(slot);

    if (slotState.state === 'free') return slotState;

    if (
      await new ChatDeliveriesRepository(tx).messageIdTaken(
        input.message.id,
        input.userId,
      )
    ) {
      throw new ConflictException('Message id already exists');
    }

    return {
      state: 'blocked',
      kind: slotState.kind,
      // A compaction in flight queues the item instead of steering a Run that
      // is not serving it (run-steering D2).
      mode: slotState.kind === 'compaction' ? 'queue' : input.delivery,
    };
  }

  /**
   * Finish the single-flight step: a free slot starts the Run; a blocked one
   * stores the message as a pending item — neither a message row nor a Run
   * (run-steering D2). The item stores only what the send named; its Run later
   * resolves the selector and the effort against the Chat's selection.
   */
  private async storeOrStart(
    tx: Db,
    input: PersistUserMessageAndRunInput,
    slot: SlotClaim,
  ): Promise<PendingDeliveryAnswer | undefined> {
    if (slot.state === 'free') return undefined;
    const deliveries = new ChatDeliveriesRepository(tx);

    const created = await deliveries.insertPending({
      id: input.message.id,
      chatId: input.chatId,
      ownerUserId: input.userId,
      mode: slot.mode,
      parts: input.parts,
      settings: {
        ...(input.selector !== undefined && { selector: input.selector }),
        ...(input.effort !== undefined && { effort: input.effort }),
        permissionMode: input.permissionMode,
      },
    });

    if (!created) throw new ConflictException('Message id already exists');

    if (slot.mode === 'interrupt' || slot.mode === 'steer') {
      await notifyLiveRunSteering(tx, input, slot.mode, this.runWait);
    }

    return { delivery: created };
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
   * downstream state is read, and the row the update returns is the one whose
   * stored selection admission resolves — not the pre-lock read.
   */
  private async admitTurn(
    chat: Chat,
    createdByUs: boolean,
    chatsRepo: ChatsRepository,
    messagesRepo: MessagesRepository,
    input: PersistUserMessageAndRunInput,
  ): Promise<{ chat: Chat; userMessage: Message | undefined }> {
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

    if (createdByUs) return { chat, userMessage: turn.userMessage };

    const locked = await chatsRepo.touch(input.chatId, input.userId);

    return { chat: locked ?? chat, userMessage: turn.userMessage };
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
