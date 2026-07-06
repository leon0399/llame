import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type Message, type RunStatus } from '../db/schema';
import { type ModelClient } from '../models/model-client';
import {
  ChatsRepository,
  CompactionsRepository,
  isCompletedAssistantTurn,
  MessagesRepository,
} from '../chats/chats-repository';
import { CompactionService } from '../compaction/compaction.service';
import {
  buildContext,
  CHAT_SYSTEM_PROMPT,
  partsToText,
  type MessagePart,
  type StoredMessage,
} from '../chats/context-builder';
import { createDeltaBuffer } from './delta-buffer';
import {
  RunEventsRepository,
  RunsRepository,
  type RunEventType,
} from './runs-repository';
import { TitleService } from '../titles/title.service';
import {
  buildTurnTelemetry,
  emitCompletedTurnTelemetryLog,
  turnTelemetryLogger,
  type TurnTelemetry,
} from '../chats/turn-telemetry';

/**
 * The run reached a terminal state (superseded / cancelled / expired) before
 * execution could claim it — nothing was executed, nothing was appended.
 */
export class RunNotRunnableError extends Error {
  constructor(readonly runId: string) {
    super(`Run ${runId} is no longer runnable (already terminal).`);
    this.name = 'RunNotRunnableError';
  }
}

/** The already-persisted user turn a run executes against. */
export type RunUserMessage = {
  id: string;
  seq: number;
  parts: MessagePart[];
};

/**
 * Cap on persisted reasoning text. Reasoning is display-only (stripped from
 * model context), so this bounds storage + the per-turn context-read cost (each
 * build reads every message's parts) without affecting what the model sees.
 */
export const REASONING_PERSIST_MAX = 24_000;

/**
 * Assistant-turn parts: a leading `reasoning` part (capped, display-only) when
 * the model produced thinking, then the answer text. Reasoning survives a
 * reload but is never re-fed (partsToText strips it).
 */
export function assistantParts(
  reasoningText: string,
  text: string,
): MessagePart[] {
  if (reasoningText.length === 0) {
    return [{ type: 'text', text }];
  }
  const reasoning =
    reasoningText.length > REASONING_PERSIST_MAX
      ? `${reasoningText.slice(0, REASONING_PERSIST_MAX)}…`
      : reasoningText;
  return [
    { type: 'reasoning', text: reasoning },
    { type: 'text', text },
  ];
}

type TerminalRunStatus = Extract<
  RunStatus,
  'completed' | 'failed' | 'cancelled' | 'expired'
>;

/**
 * RunExecutionService (#48/#50, SPEC §9.5) — executes one run: context
 * assembly, the model call, and every durable side effect (assistant turn,
 * run lifecycle + model.delta events, post-turn compaction/titling).
 *
 * Extracted from the HTTP-coupled ChatLoopService so the exact same execution
 * drives both venues: today the request thread returns the live stream to the
 * controller; the queue worker (#50) will call executeRun and consume the
 * stream itself. Everything here is transport-agnostic — no HTTP types, and
 * the caller supplies the ModelClient (credential resolution stays with the
 * caller: the API's 402-before-persistence contract, the worker's own resolve).
 */
@Injectable()
export class RunExecutionService {
  private readonly logger = new Logger(RunExecutionService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly compaction: CompactionService,
    private readonly titles: TitleService,
  ) {}

  async executeRun(input: {
    runId: string;
    chatId: string;
    userId: string;
    userMessage: RunUserMessage;
    client: ModelClient;
    abortSignal?: AbortSignal;
    /**
     * Crash recovery (worker redelivery): allow claiming a run already at
     * running_model when its heartbeat is older than this window. Omitted
     * (inline mode): a running_model run is never re-claimable.
     */
    reclaimStaleMs?: number;
  }): Promise<ReturnType<ModelClient['streamText']>> {
    const { client } = input;

    // Context assembly happens at execution time (not enqueue time): the run
    // reads the chat as it exists when it starts — compaction summary + live
    // window up to the triggering message (SPEC §9.5 puts this worker-side).
    const { system, messages, untitled } = await this.tenantDb.runAs(
      input.userId,
      async (tx) => {
        // Titling gate (#78): read the title as of execution start — the
        // common already-titled turn must not pay a post-turn title model
        // call. The atomic \`title IS NULL\` write guard still decides races.
        const chat = await new ChatsRepository(tx).findById(
          input.chatId,
          input.userId,
        );

        const compaction = await new CompactionsRepository(
          tx,
        ).findLatestByChatId(input.chatId, input.userId, {
          beforeSeq: input.userMessage.seq,
        });

        const history = await new MessagesRepository(tx).findByChatId(
          input.chatId,
          input.userId,
          {
            maxSeq: input.userMessage.seq,
            ...(compaction ? { sinceSeq: compaction.uptoSeq } : {}),
          },
        );

        const context = buildContext(history as StoredMessage[], {
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

        return { ...context, untitled: chat?.title === null };
      },
    );

    const streamStartedAt = Date.now();

    // Claim the run (#48, review hardening): markStarted refuses terminal
    // runs — a run superseded, cancelled, or expired between creation and
    // execution must never reach the model (no events appended, no spend).
    // Deliberately NOT best-effort: a failed claim aborts execution.
    const claimed = await this.tenantDb.runAs(input.userId, async (tx) => {
      const started = await new RunsRepository(tx).markStarted(
        input.runId,
        input.userId,
        input.reclaimStaleMs !== undefined
          ? { reclaimStaleMs: input.reclaimStaleMs }
          : undefined,
      );
      if (!started) {
        return false;
      }
      const events = new RunEventsRepository(tx);
      await events.append(input.runId, 'run.started');
      await events.append(input.runId, 'model.requested', {
        model: client.model,
        provider: client.provider,
      });
      return true;
    });
    if (!claimed) {
      throw new RunNotRunnableError(input.runId);
    }

    // Stream-ordered event chain (#48/#49): EVERY event whose position matters
    // for replay — today just model.delta, extended below for reasoning.delta —
    // is appended through this ONE serialized promise chain, so DB insert order
    // (which assigns run_events.sequence) matches stream order. A generic seam:
    // the tool-loop branch (#150 remainder) extends this with tool.call/
    // tool.result through the same chain rather than a parallel one.
    const deltas = createDeltaBuffer();
    // Everything streamed so far — if the stream dies mid-flight, the failed
    // turn persists the partial text instead of a blank reply (honest and
    // consistent: a failed run whose turn shows what the user actually saw).
    let streamedText = '';
    let deltaWrites: Promise<void> = Promise.resolve();
    const enqueueEvent = (eventType: RunEventType, payload: unknown) => {
      deltaWrites = deltaWrites.then(() =>
        this.recordRunProgress(input.userId, input.runId, async (tx) => {
          await new RunEventsRepository(tx).append(
            input.runId,
            eventType,
            payload,
          );
        }),
      );
    };
    const persistDelta = (text: string | null) => {
      if (text !== null) {
        enqueueEvent('model.delta', { text });
      }
    };

    // Reasoning ("thinking") deltas: coalesced in their own buffer, appended
    // through the SAME chain as model.delta so reasoning and text land in
    // stream order (reasoning precedes text). The full reasoning text is ALSO
    // accumulated (reasoningText) and persisted as a leading `reasoning` part of
    // the assistant message, so thinking survives a reload — but `partsToText`
    // strips reasoning, so it is still NEVER re-fed to the model.
    //
    // Accumulated from EACH onReasoningDelta chunk (not the SDK's
    // onFinish.reasoningText, which is only the FINAL step's reasoning and would
    // silently drop step-1 thinking on a multi-step tool turn — master has no
    // tool loop today, so every turn is one step, but the accumulation is
    // correct regardless of step count and matches the persistence branch).
    const reasoningDeltas = createDeltaBuffer();
    let reasoningText = '';
    const persistReasoning = (text: string | null) => {
      if (text !== null) {
        enqueueEvent('reasoning.delta', { text });
      }
    };

    try {
      return client.streamText({
        system,
        messages: messages as AiModelMessage[],
        abortSignal: input.abortSignal,
        onTextDelta: (text) => {
          streamedText += text;
          // Time-injected push: age-based flushes (#50 live-channel
          // granularity) stay pure inside the buffer.
          // Cross-flush on a modality switch: reasoning and text stream one at
          // a time, so when text starts, drain any still-buffered reasoning
          // FIRST (and vice versa in onReasoningDelta) — else a sub-threshold
          // reasoning tail would flush only at onFinish, landing AFTER the
          // text in the log. A no-op once the other buffer is empty, so it's
          // cheap on the steady-state stream.
          persistReasoning(reasoningDeltas.flush());
          persistDelta(deltas.push(text, Date.now()));
        },
        onReasoningDelta: (text) => {
          reasoningText += text;
          persistDelta(deltas.flush());
          persistReasoning(reasoningDeltas.push(text, Date.now()));
        },
        onError: async ({ error }) => {
          // On the request thread the stream has already sent HTTP headers, so
          // this error can't reach an exception filter — log + record it.
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

          const status =
            telemetry.status === 'aborted' ? 'cancelled' : 'failed';
          persistReasoning(reasoningDeltas.flush());
          persistDelta(deltas.flush());
          await deltaWrites;
          const message =
            error instanceof Error ? error.message : String(error);
          const finish = await this.finishRun({
            userId: input.userId,
            runId: input.runId,
            status,
            runPayload: {
              status,
              message,
            },
            error: { message },
          });
          // Message persistence is independent of bookkeeping (a DB blip in
          // finishRun must not drop the turn). Skip only when ANOTHER writer
          // finished the run with intent: cancelled (user stop / supersede —
          // the newer attempt owns the turn) or a dual-fire that already
          // recorded it. An 'expired' loss still persists what streamed —
          // expiry is a liveness misjudgment, not user intent.
          if (finish.outcome === 'lost' && finish.finalStatus !== 'expired') {
            return;
          }

          await this.recordAssistantTurn({
            chatId: input.chatId,
            userId: input.userId,
            inReplyTo: input.userMessage.id,
            parts: streamedText ? [{ type: 'text', text: streamedText }] : [],
            telemetry,
          });
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

          const status =
            telemetry.status === 'completed'
              ? 'completed'
              : telemetry.status === 'aborted'
                ? 'cancelled'
                : 'failed';
          // Drain buffered reasoning + deltas BEFORE the terminal events so the
          // log reads in stream order: …model.delta, model.completed, run.completed.
          persistReasoning(reasoningDeltas.flush());
          persistDelta(deltas.flush());
          await deltaWrites;
          const finish = await this.finishRun({
            userId: input.userId,
            runId: input.runId,
            status,
            modelCompleted: {
              usage,
              finishReason,
            },
          });
          // Same decoupling as onError: only an intentional terminal state
          // written by someone else suppresses the completed reply.
          if (finish.outcome === 'lost' && finish.finalStatus !== 'expired') {
            return;
          }

          await this.recordAssistantTurn({
            chatId: input.chatId,
            userId: input.userId,
            inReplyTo: input.userMessage.id,
            // Persist the accumulated thinking as a leading reasoning part (display
            // only — partsToText strips it, so it is never re-fed). Capped so an
            // unbounded thinking blob doesn't amplify every later turn's context
            // read (each build reads all message parts, then discards reasoning).
            // Only turns reaching onFinish (normal completion + the narrow
            // finish-races-abort case) get this; the common event-driven abort
            // goes through onError → the streamedText-only parts above (reasoning
            // dropped, like text-in-progress today).
            parts: assistantParts(reasoningText, text),
            telemetry,
          });

          // Post-turn work (#57 compaction, #78 titling). Title generation is awaited
          // so the first post-stream chat-list refresh can observe it; failures are
          // swallowed by TitleService. Compaction remains fire-and-forget.
          if (telemetry.status === 'completed') {
            void this.compaction.maybeCompact({
              chatId: input.chatId,
              userId: input.userId,
              client,
              // The exact system prompt this turn used — the compaction request
              // reuses it so its prefix hits the provider prompt cache this
              // turn just populated (#57).
              system,
              lastTurnTotalTokens: telemetry.totalTokens,
            });
            if (untitled) {
              await this.titles.maybeGenerateTitle({
                chatId: input.chatId,
                userId: input.userId,
                client,
                userText: partsToText(input.userMessage.parts),
              });
            }
          }
        },
      });
    } catch (error) {
      // A synchronous throw from streamText (provider/config validation before
      // any callback can fire) would otherwise strand the claimed run at
      // 'running_model' until the deadman sweep expires it — fail it now.
      const message = error instanceof Error ? error.message : String(error);
      await this.finishRun({
        userId: input.userId,
        runId: input.runId,
        status: 'failed',
        runPayload: { status: 'failed', message },
        error: { message },
      });
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

  /**
   * Terminal bookkeeping with a tri-state outcome, so callers can tell an
   * idempotent loss (another writer finished the run — read its status to
   * decide what the turn means) from a swallowed DB error (bookkeeping is
   * best-effort; message persistence must never depend on it).
   */
  private async finishRun(input: {
    userId: string;
    runId: string;
    status: TerminalRunStatus;
    modelCompleted?: { usage: unknown; finishReason: unknown };
    runPayload?: unknown;
    error?: unknown;
  }): Promise<
    { outcome: 'won' | 'errored' } | { outcome: 'lost'; finalStatus?: string }
  > {
    try {
      return await this.tenantDb.runAs(input.userId, async (tx) => {
        const runsRepo = new RunsRepository(tx);
        const finished = await runsRepo.markFinished(
          input.runId,
          input.userId,
          input.status,
          input.error,
        );
        if (!finished) {
          const current = await runsRepo.findById(input.runId, input.userId);
          return { outcome: 'lost' as const, finalStatus: current?.status };
        }

        const events = new RunEventsRepository(tx);
        if (input.modelCompleted) {
          await events.append(
            input.runId,
            'model.completed',
            input.modelCompleted,
          );
        }
        await events.append(
          input.runId,
          `run.${input.status}`,
          input.runPayload,
        );
        return { outcome: 'won' as const };
      });
    } catch (error) {
      this.logger.error(
        `Failed to finish run ${input.runId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'errored' };
    }
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
