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
import { McpRuntimeService } from '../mcp/mcp-runtime.service';
import { type ModelClient } from '../models/model-client';
import {
  ModelsService,
  type ModelSelectionValidator,
} from '../models/models.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { type MessagePart } from './context-builder';
import { isRecord, isString, type UnknownRecord } from '../unknown-record';
import { RunAbortRegistry, type RunAborter } from '../runs/run-abort-registry';
import { type RunUserMessage } from '../runs/run-execution.service';
import {
  RunStreamBridgeService,
  type RunStreamResponder,
} from '../runs/run-stream-bridge';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { stuckRunThresholdMs } from '../runs/run-queues';
import {
  PersonalizationService,
  type PromptUserResolver,
} from '../personalization/personalization.service';
import {
  RunDispatchService,
  type RunDispatcher,
} from '../runs/run-dispatch.service';
import {
  SystemPromptsService,
  type SystemPromptRenderInput,
} from '../system-prompts/system-prompts.service';
import { type EffectiveContextSnapshotInput } from '../runs/effective-context-resolver';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { type TurnToolCandidate } from '../tools/turn-tool-catalog';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import {
  KnowledgeToolCandidateResolver,
  type KnowledgeToolCandidateResolverPort,
} from '../knowledge/knowledge-tool-candidate-resolver';
import { sanitizeClientMessageParts } from './context-item';
import {
  MemoryService,
  type MemorySettingsBindingResolver,
  type MemorySettingsResolver,
  type ResolvedMemorySettings,
} from '../memory/memory.service';
import {
  deriveRecencyDigestDelta,
  RecencyDigestService,
  type RecencyDigestDelta,
  type RecencyDigestResolution,
  type RecencyDigestResolver,
} from './recency-digest.service';
import { buildTurnContextAndParts } from './turn-context';

type RuntimeCatalogSnapshotter = Pick<McpRuntimeService, 'snapshotCandidates'>;

/**
 * Narrows a read-back message's `unknown[]` JSONB `parts` to `MessagePart[]`:
 * each part must be an object (the union's `Record<string, unknown>`
 * fallback arm), matching every other JSON-record boundary in this
 * codebase. Malformed (non-object) parts fail closed.
 */
function toMessageParts(parts: readonly unknown[]): MessagePart[] {
  return parts.map((part) => {
    if (!isRecord(part)) {
      throw new Error('Malformed message part: expected an object');
    }
    return part;
  });
}

export type ChatMessageInput = {
  id: string;
  parts: MessagePart[];
};

export type PersistUserMessageAndRunInput = {
  chatId: string;
  userId: string;
  modelId: string;
  /** Resolved at accept time; absent means "send no effort parameter". */
  effort: string | undefined;
  message: ChatMessageInput;
  targetRunId: string;
  model: SystemModelCatalogEntry;
  user: SystemPromptRenderInput['user'];
  allowedToolRules: readonly string[];
  dynamicCandidates: readonly TurnToolCandidate[];
  digestCandidate?: RecencyDigestResolution;
};

type ChatMessageStream = Pick<
  ReturnType<ModelClient['streamText']>,
  'toUIMessageStreamResponse'
>;

/**
 * ChatLoopService — the API side of a message turn (SPEC §9.5): validate,
 * store the message, create the run, enqueue it, and answer with the
 * run-event stream bridge. Execution happens exclusively in the queue
 * consumer (RunsWorkerService → RunExecutionService); there is no inline
 * request-thread execution path.
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
    @Inject(PersonalizationService)
    private readonly personalization: PromptUserResolver,
    private readonly systemPrompts: SystemPromptsService,
    @Inject(McpRuntimeService)
    private readonly mcpRuntime: RuntimeCatalogSnapshotter,
    @Inject(MemoryService)
    private readonly memory: MemorySettingsResolver &
      MemorySettingsBindingResolver,
    @Inject(RecencyDigestService)
    private readonly recencyDigest: RecencyDigestResolver,
    @Inject(KnowledgeToolCandidateResolver)
    private readonly knowledgeCandidates: KnowledgeToolCandidateResolverPort,
  ) {}

  async createMessageStream(input: {
    chatId: string;
    userId: string;
    modelId: string;
    /** Requested by the caller; absent resolves the model's `defaultEffort`. */
    effort?: string;
    message: ChatMessageInput;
    abortSignal?: AbortSignal;
  }): Promise<ChatMessageStream> {
    const model = this.models.validateModelSelection(input.modelId);
    // Resolved from the already-validated model, so an unavailable model is
    // reported without the effort ever being considered.
    const effort = this.models.resolveEffortSelection(model, input.effort);
    // Validate the message BEFORE any database work. A rejected message must
    // not cost a personalization transaction, and a personalization read that
    // fails must not turn a 400 into a 500 for input that was invalid anyway.
    const message = {
      ...input.message,
      parts: sanitizeClientMessageParts(input.message.parts),
    };
    if (message.parts.length === 0) {
      throw new BadRequestException('Message must contain a text part');
    }

    // Read the owner's per-user context in its own short transaction, out here
    // rather than inside the binding transaction below: that one holds the chat
    // row for its whole duration (see the lock-order note in
    // run-execution.service.ts#finishRun), and widening it to cover this read
    // would extend the hold for nothing. The cost is that an edit committed
    // between this read and the bind applies only to the next run — specified
    // and accepted.
    const user = await this.personalization.resolvePromptUser(input.userId);
    const digestCandidate = await this.resolveDigestCandidate(
      input.userId,
      input.chatId,
    );
    const allowedToolRules = this.instanceConfig.config.tools.allowed;
    // This is a pure process-local projection of the last atomically published
    // runtime catalog. It neither waits for nor initiates remote I/O, and it is
    // intentionally resolved before the tenant binding transaction opens.
    const dynamicCandidates: readonly TurnToolCandidate[] =
      this.mcpRuntime.snapshotCandidates();
    const targetRunId = randomUUID();

    const { runId, userMessage, supersededRunIds } =
      await this.persistUserMessageAndRun({
        ...input,
        message,
        effort,
        targetRunId,
        model,
        user,
        allowedToolRules,
        dynamicCandidates,
        digestCandidate,
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

  /** Best-effort: a failed digest resolution must not fail the turn it decorates. */
  private async resolveDigestCandidate(
    userId: string,
    chatId: string,
  ): Promise<RecencyDigestResolution | undefined> {
    try {
      if ((await this.memory.getForOwner(userId)).shareRecentChats === true) {
        return await this.recencyDigest.resolveCandidate(userId, chatId);
      }
    } catch {
      // Do not expose corpus text through diagnostics; only the failure class is useful.
      this.logger.error('recency_digest_resolution_failed');
    }
    return undefined;
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
    supersededRunIds: string[];
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

  private async persistUserMessageAndRun(
    input: PersistUserMessageAndRunInput,
  ): Promise<{
    runId: string;
    userMessage: RunUserMessage;
    supersededRunIds: string[];
  }> {
    // Accepted-turn binding transaction. The prior accepted Run, active
    // compaction boundary, durable availability delta, frozen digest baseline,
    // rendered effective context, user message, immutable snapshot, Run, and
    // run.created event are bound here atomically. A rollback establishes no
    // digest or availability baseline. Compaction resets only this model-facing
    // comparison epoch; it never mutates the process-resident tool catalog.
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);

      let { chat, createdByUs } = await this.resolveChatForTurn(
        chatsRepo,
        input,
      );
      // Archive guard (chat-project-archive): refuse to send into an archived
      // chat. A freshly created chat (createdByUs) is never archived, so this
      // only fires for a pre-existing archived chat — sending does NOT unarchive.
      assertNotArchived(chat);

      const turn = await messagesRepo.findTurnState(
        input.chatId,
        input.userId,
        input.message.id,
      );
      if (turn.userMessage || turn.assistantMessage) {
        throw new ConflictException('Message id already exists');
      }

      // Serialize predecessor reads for accepted turns. The availability and
      // model-switch reminders compare against the immediately preceding Run,
      // so two transactions must not both read the same baseline and then
      // commit in sequence. A freshly inserted chat already carries this
      // transaction's row lock; an existing chat is locked by the activity
      // update before any predecessor state is read.
      if (!createdByUs) {
        // Take the post-lock row from the locking statement itself — `chat`
        // above is a pre-lock snapshot, and this transaction may have waited
        // here behind a compaction or a preceding turn that changed the very
        // digest columns read below.
        chat = (await chatsRepo.touch(input.chatId, input.userId)) ?? chat;
      }

      const eventsRepo = new RunEventsRepository(tx);
      const runsRepo = new RunsRepository(tx);
      await this.clearActiveRunSlot({
        runsRepo,
        eventsRepo,
        chatId: input.chatId,
        userId: input.userId,
      });

      const {
        chat: boundChat,
        shareRecentChats,
        digestDelta,
      } = await this.resolveDigestBindingAndDelta(tx, chatsRepo, chat, input);
      chat = boundChat;

      let userMessage: Message | undefined = turn.userMessage;
      const { effectiveContext, messageParts } = await buildTurnContextAndParts(
        {
          logger: this.logger,
          systemPrompts: this.systemPrompts,
          instanceConfig: this.instanceConfig,
          knowledgeCandidates: this.knowledgeCandidates,
        },
        { tx, chat, turnInput: input, shareRecentChats, digestDelta },
      );

      if (!userMessage) {
        userMessage = await messagesRepo.createUserMessageIfAbsent({
          id: input.message.id,
          chatId: input.chatId,
          senderUserId: input.userId,
          parts: messageParts,
        });
      }

      if (!userMessage) {
        throw new ConflictException('Message id already exists');
      }
      if (digestDelta) {
        await chatsRepo.updateRecencyDigestTold(
          input.chatId,
          input.userId,
          digestDelta.told,
        );
      }

      // Durable run (#48): every accepted user message becomes exactly one run
      // (SPEC §9.3). The run row + run.created land in the SAME transaction as
      // the user message, so a message can never exist without its execution
      // record. Reusing a message id is rejected above; retries are a separate
      // feature, not implicit idempotency.
      const { run, supersededRunIds } = await this.createRunForMessage(
        tx,
        {
          userId: input.userId,
          chatId: input.chatId,
          modelId: input.modelId,
          effort: input.effort,
          targetRunId: input.targetRunId,
        },
        userMessage,
        effectiveContext,
      );

      return {
        runId: run.id,
        userMessage: {
          id: userMessage.id,
          seq: userMessage.seq,
          parts: toMessageParts(userMessage.parts),
        },
        supersededRunIds,
      };
    });
  }

  /**
   * First message creates the chat (#86): the client supplies the id
   * (routing + idempotency); the owner is always the session user. If the
   * chat is absent, upsert it; a conflict means the id is already taken — by
   * us (a concurrent first send) or by another tenant. Re-query to
   * disambiguate: our own row becomes visible (relies on the default READ
   * COMMITTED seeing the concurrent commit), a cross-tenant id stays
   * invisible → 404 (no existence leak).
   */
  private async resolveChatForTurn(
    chatsRepo: ChatsRepository,
    input: { chatId: string; userId: string },
  ): Promise<{ chat: Chat; createdByUs: boolean }> {
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
    return { chat, createdByUs };
  }

  /**
   * Bind this turn's recency-digest baseline (if the candidate resolved
   * earlier is still consented-to and the chat has none yet) and derive the
   * delta to disclose against the previously told set, if any.
   */
  private async resolveDigestBindingAndDelta(
    tx: Db,
    chatsRepo: ChatsRepository,
    chat: Chat,
    input: PersistUserMessageAndRunInput,
  ): Promise<{
    chat: Chat;
    shareRecentChats: ResolvedMemorySettings;
    digestDelta: RecencyDigestDelta | null;
  }> {
    const hadDigestBaseline = chat.recencyDigestBaseline !== null;
    // Read unconditionally: the supersession marker below is gated on this
    // setting too, and it must still be checkable when `input.digestCandidate`
    // is absent because this turn's own candidate resolution failed or was
    // skipped — that failure is unrelated to whether a *prior* compaction's
    // re-bake should be disclosed this turn.
    const shareRecentChats = await this.memory.getForOwnerForBinding(
      tx,
      input.userId,
    );
    if (chat.recencyDigestBaseline == null && input.digestCandidate) {
      // FOR SHARE serializes a consent withdrawal with this accepted binding.
      // The candidate was intentionally read outside this transaction, so a
      // stale true must be discarded instead of entering an immutable prompt.
      if (shareRecentChats?.shareRecentChats === true) {
        const bound = await chatsRepo.setRecencyDigestIfAbsent(
          input.chatId,
          input.userId,
          input.digestCandidate.baseline,
          input.digestCandidate.told,
        );
        chat = bound ?? (await chatsRepo.findById(input.chatId, input.userId))!;
      }
    }

    const digestDelta =
      hadDigestBaseline &&
      input.digestCandidate &&
      chat.recencyDigestTold !== null &&
      shareRecentChats?.shareRecentChats === true
        ? deriveRecencyDigestDelta({
            candidate: input.digestCandidate,
            told: chat.recencyDigestTold,
            pinnedChatIds: await chatsRepo.findPinnedChatIds(
              input.userId,
              chat.recencyDigestTold.map(({ chatId }) => chatId),
            ),
          })
        : null;

    return { chat, shareRecentChats, digestDelta };
  }

  /**
   * The Run row + its context snapshot, atomically with canceling any
   * (defensively impossible, but legacy-data-tolerant) stale active runs on
   * this same message, and the `run.created` event.
   */
  private async createRunForMessage(
    tx: Db,
    input: {
      userId: string;
      chatId: string;
      modelId: string;
      effort: string | undefined;
      targetRunId: string;
    },
    userMessage: Message,
    effectiveContext: EffectiveContextSnapshotInput,
  ): Promise<{ run: Run; supersededRunIds: string[] }> {
    const snapshotsRepo = new ModelContextSnapshotsRepository(tx);
    const snapshot = await snapshotsRepo.createOrReuse(
      input.userId,
      effectiveContext,
    );

    const runsRepo = new RunsRepository(tx);
    const eventsRepo = new RunEventsRepository(tx);
    const superseded = await runsRepo.cancelActiveRunsForMessage(
      userMessage.id,
      input.userId,
    );
    for (const stale of superseded) {
      await eventsRepo.append(stale.id, 'run.cancelled', {
        reason: 'superseded by retry',
      });
    }

    let run: Run;
    try {
      // Savepoint (nested tx): a unique violation must not poison the outer
      // transaction — the unwedge path above still needs it.
      run = await tx.transaction((inner) =>
        new RunsRepository(inner).create({
          id: input.targetRunId,
          chatId: input.chatId,
          messageId: userMessage.id,
          userId: input.userId,
          modelId: input.modelId,
          effort: input.effort,
          modelContextSnapshotId: snapshot.id,
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
    await eventsRepo.append(run.id, 'run.created', {
      chatId: input.chatId,
      messageId: userMessage.id,
    });

    return { run, supersededRunIds: superseded.map((stale) => stale.id) };
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
      { message },
    );
    if (expired) {
      await input.eventsRepo.append(blocking.id, 'run.expired', {
        status: 'expired',
        message,
      });
    }
  }
}

/**
 * True for any non-null `object` — deliberately NOT `isRecord`, which also
 * excludes arrays: an `Error.cause` chain walk must keep visiting a
 * pathological array-shaped cause exactly as it does today, not stop early.
 */
function isCauseChainLink(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

/**
 * Postgres unique_violation on the per-chat single-flight partial index.
 * Walks the cause chain — drizzle wraps the postgres.js error.
 */
export function isInflightUniqueViolation(error: unknown): boolean {
  for (
    let current = error;
    isCauseChainLink(current);
    current = current['cause']
  ) {
    const mentionsIndex =
      (isString(current['constraint_name']) &&
        current['constraint_name'].includes('runs_chat_inflight_unique')) ||
      (isString(current['message']) &&
        current['message'].includes('runs_chat_inflight_unique'));
    if (current['code'] === '23505' && mentionsIndex) {
      return true;
    }
  }
  return false;
}
