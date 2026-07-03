import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type Message } from '../db/schema';
import { type ModelClient } from '../models/model-client';
import { ModelsService } from '../models/models.service';
import {
  ChatsRepository,
  MessagesRepository,
  findLiveWindow,
} from './chats-repository';
import { CompactionService } from '../compaction/compaction.service';
import {
  buildContext,
  partsToText,
  type MessagePart,
  type StoredMessage,
} from './context-builder';
import { TitleService } from '../titles/title.service';
import { createDeltaBuffer } from '../runs/delta-buffer';
import {
  RunEventsRepository,
  RunsRepository,
  type RunEventType,
} from '../runs/runs-repository';
import {
  buildTurnTelemetry,
  emitCompletedTurnTelemetryLog,
  turnTelemetryLogger,
  type TurnTelemetry,
} from './turn-telemetry';

export const CHAT_SYSTEM_PROMPT =
  'You are llame, an answer-only assistant. Answer the latest user message directly. Do not claim to use tools or take external actions.';

export type ChatMessageInput = {
  id: string;
  parts: MessagePart[];
};

@Injectable()
export class ChatLoopService {
  private readonly logger = new Logger(ChatLoopService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly models: ModelsService,
    private readonly compaction: CompactionService,
    private readonly titles: TitleService,
  ) {}

  async createMessageStream(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
    abortSignal?: AbortSignal;
  }): Promise<ReturnType<ModelClient['streamText']>> {
    // Throws MissingModelCredentialError (a domain error) when absent; the controller
    // maps it to HTTP 402. The service stays HTTP-agnostic (it will move to a worker, §9.5).
    const credential = await this.models.resolveModelCredential(input.userId);
    const client = this.models.createOpenAIClient(credential);

    const { system, messages, untitled, runId } =
      await this.persistUserAndBuildContext(input);
    const streamStartedAt = Date.now();

    // Durable run lifecycle (#48, SPEC §9.4): the run row + run.created were
    // written with the user message; execution events follow here. While the
    // loop still executes on the request thread (until #50), these writes are
    // observability dual-writes — they must never break the live stream.
    await this.recordRunProgress(input.userId, runId, async (tx) => {
      await new RunsRepository(tx).markStarted(runId, input.userId);
      const events = new RunEventsRepository(tx);
      await events.append(runId, 'run.started');
      await events.append(runId, 'model.requested', {
        model: client.model,
        provider: client.provider,
      });
    });

    // model.delta persistence (#48/#49): deltas are coalesced (delta-buffer)
    // and appended through a sequential promise chain so events land in stream
    // order even though onTextDelta fires synchronously.
    const deltas = createDeltaBuffer();
    // Everything streamed so far — if the stream dies mid-flight, the failed
    // turn persists the partial text instead of a blank reply (honest and
    // consistent: a failed run whose turn shows what the user actually saw).
    let streamedText = '';
    let deltaWrites: Promise<void> = Promise.resolve();
    const persistDelta = (text: string | null) => {
      if (text === null) {
        return;
      }
      deltaWrites = deltaWrites.then(() =>
        this.recordRunProgress(input.userId, runId, async (tx) => {
          await new RunEventsRepository(tx).append(runId, 'model.delta', {
            text,
          });
        }),
      );
    };

    // Single terminal writer: onError and onFinish can in principle both fire
    // for one stream (e.g. a mid-stream error followed by a finishReason:
    // 'error' finish). markFinished's finished_at guard protects the runs ROW,
    // but the append-only event log has no such guard — without this gate the
    // log could carry two contradictory terminal events. First writer wins.
    // The assistant-turn write gets the same gate: failed/aborted assistant
    // rows stay mutable (retries update them), so a second terminal callback
    // could otherwise overwrite the turn the first one recorded — keeping the
    // message, telemetry, and run status a consistent triple.
    let turnRecorded = false;
    const recordTurnOnce = async (turn: {
      parts: MessagePart[];
      telemetry: TurnTelemetry;
    }) => {
      if (turnRecorded) {
        return;
      }
      turnRecorded = true;
      await this.recordAssistantTurn({
        chatId: input.chatId,
        userId: input.userId,
        inReplyTo: input.message.id,
        parts: turn.parts,
        telemetry: turn.telemetry,
      });
    };
    let finalized = false;
    const finalizeRun = async (
      status: 'completed' | 'failed' | 'cancelled',
      events: Array<{ type: RunEventType; payload?: unknown }>,
      error?: unknown,
    ) => {
      if (finalized) {
        return;
      }
      finalized = true;
      // Drain buffered deltas BEFORE the terminal events so the log reads
      // in stream order: …model.delta, model.completed, run.<status>.
      persistDelta(deltas.flush());
      await deltaWrites;
      // NOTE: recordRunProgress swallows failures by design (a dual-write must
      // never break the live stream) — a lost terminal write leaves the run
      // non-terminal until the deadman sweep (later #48 slice) expires it.
      await this.recordRunProgress(input.userId, runId, async (tx) => {
        const eventsRepo = new RunEventsRepository(tx);
        for (const event of events) {
          await eventsRepo.append(runId, event.type, event.payload);
        }
        await new RunsRepository(tx).markFinished(
          runId,
          input.userId,
          status,
          error !== undefined ? error : undefined,
        );
      });
    };

    try {
      return client.streamText({
        system,
        messages,
        abortSignal: input.abortSignal,
        onTextDelta: (text) => {
          streamedText += text;
          persistDelta(deltas.push(text));
        },
        onError: async ({ error }) => {
          // The stream has already sent HTTP headers, so this error can't reach the NestJS
          // exception filter — logging here is the only way to surface model/network failures.
          this.logger.error(
            `Stream error for chat ${input.chatId}`,
            error instanceof Error ? error.stack : String(error),
          );

          const telemetry = buildTurnTelemetry({
            usage: null,
            finishReason: null,
            status: input.abortSignal?.aborted ? 'aborted' : 'error',
            model: client.model,
            provider: client.provider,
            latencyMs: Date.now() - streamStartedAt,
          });

          await recordTurnOnce({
            parts: streamedText ? [{ type: 'text', text: streamedText }] : [],
            telemetry,
          });

          const status =
            telemetry.status === 'aborted' ? 'cancelled' : 'failed';
          const message =
            error instanceof Error ? error.message : String(error);
          await finalizeRun(
            status,
            [{ type: `run.${status}`, payload: { status, message } }],
            { message },
          );
        },
        onFinish: async ({ text, usage, finishReason }) => {
          const telemetry = buildTurnTelemetry({
            usage,
            finishReason,
            status: input.abortSignal?.aborted
              ? 'aborted'
              : finishReason === 'error'
                ? 'error'
                : 'completed',
            model: client.model,
            provider: client.provider,
            latencyMs: Date.now() - streamStartedAt,
          });

          await recordTurnOnce({ parts: [{ type: 'text', text }], telemetry });

          const status =
            telemetry.status === 'completed'
              ? 'completed'
              : telemetry.status === 'aborted'
                ? 'cancelled'
                : 'failed';
          await finalizeRun(status, [
            { type: 'model.completed', payload: { usage, finishReason } },
            { type: `run.${status}` },
          ]);

          // Post-turn work (#57 compaction, #78 titling). Title generation is awaited
          // so the first post-stream chat-list refresh can observe it; failures are
          // swallowed by TitleService. Compaction remains fire-and-forget until it
          // rides into the worker with the loop (#50).
          if (telemetry.status === 'completed') {
            void this.compaction.maybeCompact({
              chatId: input.chatId,
              userId: input.userId,
              client,
              // The exact system prompt this turn used — the compaction request
              // reuses it (plus this turn's history rendering) so its prefix hits
              // the provider prompt cache this turn just populated.
              system,
              // Real usage from this turn = ground truth for the trigger; the
              // char-based estimate is only the fallback.
              lastTurnTotalTokens: telemetry.totalTokens,
            });
            // Gated on the title as read when this turn began (untitled) — the
            // common already-titled turn pays no extra read; the atomic
            // `title IS NULL` guard still wins any race with a mid-stream rename.
            if (untitled) {
              await this.titles.maybeGenerateTitle({
                chatId: input.chatId,
                userId: input.userId,
                client,
                userText: partsToText(input.message.parts),
              });
            }
          }
        },
      });
    } catch (error) {
      // A synchronous throw from streamText (provider/config validation before
      // any callback can fire) would otherwise strand the run at
      // 'running_model' forever — neither onError nor onFinish ever runs.
      const message = error instanceof Error ? error.message : String(error);
      await finalizeRun(
        'failed',
        [{ type: 'run.failed', payload: { status: 'failed', message } }],
        { message },
      );
      throw error;
    }
  }

  /**
   * Best-effort run bookkeeping (#48). While the loop runs on the request
   * thread, run rows/events are a durability dual-write: failures are logged,
   * never surfaced into the live stream. When the loop moves into the worker
   * (#50) these become the authoritative execution record.
   */
  private async recordRunProgress(
    userId: string,
    runId: string,
    write: (
      tx: Parameters<Parameters<TenantDbService['runAs']>[1]>[0],
    ) => Promise<void>,
  ): Promise<void> {
    try {
      await this.tenantDb.runAs(userId, write);
    } catch (error) {
      this.logger.error(
        `Failed to record run progress for run ${runId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async persistUserAndBuildContext(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
  }): Promise<{
    system: string;
    messages: AiModelMessage[];
    untitled: boolean;
    runId: string;
  }> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);

      // First message creates the chat (#86): the client supplies the id (routing +
      // idempotency); the owner is always the session user. If the chat is absent, upsert
      // it; a conflict means the id is already taken — by us (a concurrent first send) or by
      // another tenant. Re-query to disambiguate: our own row becomes visible (relies on the
      // default READ COMMITTED seeing the concurrent commit), a cross-tenant id stays
      // invisible → 404 (no existence leak). Mirrors the user-message path below.
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

      const turn = await messagesRepo.findTurnState(
        input.chatId,
        input.userId,
        input.message.id,
      );
      if (
        turn.assistantMessage &&
        isCompletedAssistantTurn(turn.assistantMessage)
      ) {
        throw new ConflictException('Message turn already completed');
      }

      // Idempotency key reuse with different content is a client error, not a retry.
      // Normalize both sides to plain JSON first: the stored parts are plain (from jsonb)
      // while input parts are class-transformer instances, so a raw deep-equal would
      // always differ on the prototype.
      if (
        turn.userMessage &&
        !isDeepStrictEqual(
          normalizeJson(turn.userMessage.parts),
          normalizeJson(input.message.parts),
        )
      ) {
        throw new ConflictException(
          'Message id already used with different content',
        );
      }

      let userMessage: Message | undefined = turn.userMessage;

      if (!userMessage) {
        userMessage = await messagesRepo.createUserMessageIfAbsent({
          id: input.message.id,
          chatId: input.chatId,
          senderUserId: input.userId,
          parts: input.message.parts,
        });
      }

      if (!userMessage) {
        const retryTurn = await messagesRepo.findTurnState(
          input.chatId,
          input.userId,
          input.message.id,
        );
        if (
          retryTurn.assistantMessage &&
          isCompletedAssistantTurn(retryTurn.assistantMessage)
        ) {
          throw new ConflictException('Message turn already completed');
        }

        userMessage = retryTurn.userMessage;
      }

      if (!userMessage) {
        throw new ConflictException('Message id already exists');
      }

      // Mark chat activity so it sorts to the top of the chat list (findByOwner). Skip only
      // when THIS turn inserted the chat — its updatedAt is already now(), so touching again
      // is a redundant write. A request that found the chat (pre-existing, or created by a
      // concurrent same-tenant race that this one lost) still touches it.
      if (!createdByUs) {
        await chatsRepo.touch(input.chatId, input.userId);
      }

      // Durable run (#48): every user message becomes a run (SPEC §9.3). The
      // run row + run.created land in the SAME transaction as the user message,
      // so a message can never exist without its execution record. A retried
      // turn (aborted/error) creates a fresh run — one message, many attempts.
      // KNOWN GAP: two CONCURRENT requests for the same message id both reach
      // this point (the idempotency insert dedupes the message, not the run) —
      // two runs and two model streams for one turn. The fix is per-chat
      // single-flight, deliberately deferred to the heartbeat slice of #48:
      // without heartbeat, a crashed in-flight run would deadlock its chat.
      const runsRepo = new RunsRepository(tx);
      const run = await runsRepo.create({
        chatId: input.chatId,
        messageId: userMessage.id,
        userId: input.userId,
      });
      await new RunEventsRepository(tx).append(run.id, 'run.created', {
        chatId: input.chatId,
        messageId: userMessage.id,
      });

      // Lineage-based compaction (#57): superseded turns (seq <= uptoSeq) are
      // represented by the summary; only the live window is read back — via the
      // same shared query the compaction service uses, bounded to this turn.
      // No message-count cap: context size is governed in tokens by the
      // compaction threshold, so the full live window is always sent.
      const { compaction, history } = await findLiveWindow(
        tx,
        input.chatId,
        input.userId,
        { maxSeq: userMessage.seq },
      );
      const { system, messages } = buildContext(history as StoredMessage[], {
        systemPrompt: CHAT_SYSTEM_PROMPT,
        ...(compaction
          ? {
              compaction: {
                summary: compaction.summary,
                uptoSeq: compaction.uptoSeq,
              },
            }
          : {}),
      });

      return {
        system,
        messages: messages as AiModelMessage[],
        // Titling is gated on the title as read in THIS transaction — no extra
        // post-turn read. The atomic `title IS NULL` write guard still decides.
        untitled: chat.title === null,
        runId: run.id,
      };
    });
  }

  private async recordAssistantTurn(input: {
    chatId: string;
    userId: string;
    inReplyTo: string;
    parts: MessagePart[];
    telemetry: TurnTelemetry;
  }): Promise<void> {
    try {
      const assistantMessage = await this.persistAssistantMessage(input);

      if (assistantMessage) {
        emitCompletedTurnTelemetryLog(turnTelemetryLogger, {
          chatId: input.chatId,
          messageId: assistantMessage.id,
          inReplyTo: input.inReplyTo,
          telemetry: input.telemetry,
          onError: (error) => {
            this.logger.error(
              `Failed to emit assistant turn telemetry for chat ${input.chatId}`,
              error instanceof Error ? error.stack : String(error),
            );
          },
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to persist assistant turn for chat ${input.chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async persistAssistantMessage(input: {
    chatId: string;
    userId: string;
    inReplyTo: string;
    parts: MessagePart[];
    telemetry: TurnTelemetry;
  }): Promise<Message | undefined> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const messagesRepo = new MessagesRepository(tx);
      const turn = await messagesRepo.findTurnState(
        input.chatId,
        input.userId,
        input.inReplyTo,
      );

      if (turn.assistantMessage) {
        if (isCompletedAssistantTurn(turn.assistantMessage)) {
          return undefined;
        }

        return messagesRepo.updateAssistantReply({
          id: turn.assistantMessage.id,
          chatId: input.chatId,
          inReplyTo: input.inReplyTo,
          parts: input.parts,
          usage: input.telemetry,
        });
      }

      // The user turn must still exist (it was persisted before streaming). If it's gone
      // — e.g. the chat was deleted mid-stream — skip rather than hit an in_reply_to FK error.
      if (!turn.userMessage) {
        return undefined;
      }

      return messagesRepo.createAssistantReplyIfAbsent({
        chatId: input.chatId,
        parts: input.parts,
        usage: input.telemetry,
        inReplyTo: input.inReplyTo,
      });
    });
  }
}

/** Strip class prototypes / undefined so two structurally-equal shapes compare equal. */
function normalizeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function isCompletedAssistantTurn(message: Message): boolean {
  const usage = message.usage;
  if (typeof usage !== 'object' || usage === null || !('status' in usage)) {
    return true;
  }

  return (usage as { status?: unknown }).status === 'completed';
}
