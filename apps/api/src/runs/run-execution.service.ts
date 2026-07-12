import { Injectable, Logger } from '@nestjs/common';
import { tool, type ModelMessage as AiModelMessage, type ToolSet } from 'ai';

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
import { SearchReindexDispatchService } from '../search/search-reindex-dispatch.service';
import {
  buildContext,
  CHAT_SYSTEM_PROMPT,
  partsToText,
  type MessagePart,
  type StoredMessage,
} from '../chats/context-builder';
import { createDeltaBuffer } from './delta-buffer';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { resolveAdvertisedTools } from '../tools/registry';
import { invalidCallResult, refusalResult, runTool } from '../tools/runner';
import { type ToolContext, type ToolResult } from '../tools/types';
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
 * A persisted tool-activity part (design D5, AI SDK tool-part vocabulary):
 * `type: "tool-<name>"`, correlated by `toolCallId`, settled state only
 * (`output-available` | `output-error` — no `input-streaming`/`input-available`
 * snapshot is persisted; results are atomic in this slice, D5). Built by both
 * the genuine-execution path (runTool) and the unavailable/hallucinated-call
 * refusal path (onUnavailableToolCall), so both render through the exact same
 * `ToolCallPart` component web-side.
 */
export type ToolActivityPart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: 'output-available' | 'output-error';
  input: unknown;
  output?: unknown;
  errorText?: string;
};

/** The step-cap marker part (design D6): `type: "data-cap-notice"`, AI SDK
 * v6 data-part shape (payload nested under `.data`) so the SAME part renders
 * live (bridge → `data-cap-notice` stream chunk) and from history. */
export type CapNoticePart = {
  type: 'data-cap-notice';
  data: { stepsUsed: number; maxSteps: number };
};

function toolActivityPart(
  toolCallId: string,
  toolName: string,
  input: unknown,
  result: ToolResult,
): ToolActivityPart {
  return result.status === 'success'
    ? {
        type: `tool-${toolName}`,
        toolCallId,
        state: 'output-available',
        input,
        output: result,
      }
    : {
        type: `tool-${toolName}`,
        toolCallId,
        state: 'output-error',
        input,
        errorText: result.message,
      };
}

/**
 * Assistant-turn parts, in occurrence order: a leading `reasoning` part
 * (capped, display-only) when the model produced thinking, then every tool
 * call/result of the run (in the order they were recorded), then the answer
 * text, then an optional step-cap notice. All three display-only kinds —
 * reasoning, tool parts, and the cap notice — survive a reload for the UI but
 * are stripped by `partsToText`, so they never re-enter model context on a
 * later turn or in a compaction summary (the model saw tool results live
 * during the run's own loop; the persisted parts are a UI record).
 */
export function assistantParts(input: {
  reasoningText: string;
  toolParts: readonly ToolActivityPart[];
  text: string;
  capNotice?: CapNoticePart;
}): MessagePart[] {
  const { reasoningText, toolParts, text, capNotice } = input;
  const parts: MessagePart[] = [];
  if (reasoningText.length > 0) {
    const reasoning =
      reasoningText.length > REASONING_PERSIST_MAX
        ? `${reasoningText.slice(0, REASONING_PERSIST_MAX)}…`
        : reasoningText;
    parts.push({ type: 'reasoning', text: reasoning });
  }
  parts.push(...toolParts);
  // Skip an empty text part: a reasoning-only turn (or one that hits onFinish
  // with no visible answer) should not persist a spurious `{ type: 'text',
  // text: '' }` -- no downstream renderer (chat-page.tsx, markdown export)
  // needs an empty text bubble/line.
  if (text.length > 0) {
    parts.push({ type: 'text', text });
  }
  if (capNotice) {
    parts.push(capNotice);
  }
  return parts;
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
 * drives both venues: the queue worker calls executeRun and the request thread
 * streams from persisted run events. Everything here is transport-agnostic — no
 * HTTP types, and the caller supplies the ModelClient after resolving the run's
 * stored model id.
 */
@Injectable()
export class RunExecutionService {
  private readonly logger = new Logger(RunExecutionService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly compaction: CompactionService,
    private readonly titles: TitleService,
    private readonly instanceConfig: InstanceConfigService,
    private readonly reindexDispatch: SearchReindexDispatchService,
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
        modelId: client.model,
      });
      return true;
    });
    if (!claimed) {
      throw new RunNotRunnableError(input.runId);
    }

    // Stream-ordered event chain (#48/#49, tool-loop): EVERY event whose
    // position matters for replay — model.delta, reasoning.delta, AND
    // tool.call/tool.result — is appended through this ONE serialized promise
    // chain, so DB insert order (which assigns run_events.sequence) matches
    // stream order. Coalesced deltas and tool events must never race each
    // other into the log.
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

    // Trusted execution context for tools — built from the RUN's fields,
    // NEVER from model input, so a tool's data scope can't be widened by the
    // model (authorization identity from a trusted source only). Matches
    // ToolContext (tools/types.ts) exactly.
    const toolContext: ToolContext = {
      userId: input.userId,
      chatId: input.chatId,
      tenantDb: this.tenantDb,
    };

    const { allowed, maxStepsPerRun, callTimeoutSeconds } =
      this.instanceConfig.config.tools;

    // Tool activity accumulated in occurrence order, for persistence on the
    // assistant message (design D5) — both genuinely-executed calls and
    // gate-refused/hallucinated calls push here, so both render through the
    // exact same ToolCallPart component web-side.
    const toolParts: ToolActivityPart[] = [];
    let capped = false;

    // One place each for the two tool events that both the executed path and
    // the gate-refused path emit identically — the only difference between the
    // paths is the 'tool.started' event, which the executed path emits on its
    // own between these two.
    const recordToolRequested = (
      toolCallId: string,
      toolName: string,
      toolInput: unknown,
    ) => {
      enqueueEvent('tool.requested', {
        toolCallId,
        toolName,
        input: toolInput,
      });
    };
    const recordToolCompleted = (
      toolCallId: string,
      toolName: string,
      toolInput: unknown,
      result: ToolResult,
    ) => {
      enqueueEvent('tool.completed', {
        toolCallId,
        toolName,
        status: result.status,
        output: result,
      });
      toolParts.push(toolActivityPart(toolCallId, toolName, toolInput, result));
    };

    // Available tools for this turn: pre-filtered by the fail-closed
    // allowlist ∩ read_only gate (design D3) BEFORE the stream — no
    // mid-stream permission DB work (the process shares one Postgres
    // connection).
    const toolSet: ToolSet = Object.fromEntries(
      resolveAdvertisedTools(new Set(allowed)).map((advertised) => [
        advertised.id,
        tool({
          description: advertised.description,
          inputSchema: advertised.inputSchema,
          execute: async (
            args: unknown,
            { toolCallId }: { toolCallId: string },
          ) => {
            // Flush any buffered model.delta of THIS step FIRST, so partial
            // text is enqueued before the tool events (stream-order).
            persistDelta(deltas.flush());
            // toolCallId correlates requested/started/completed into one UI
            // tool part (tool-loop UI visibility).
            recordToolRequested(toolCallId, advertised.id, args);
            enqueueEvent('tool.started', {
              toolCallId,
              toolName: advertised.id,
            });
            const result = await runTool(
              advertised,
              args,
              toolContext,
              callTimeoutSeconds,
            );
            recordToolCompleted(toolCallId, advertised.id, args, result);
            return result;
          },
        }),
      ]),
    );
    const hasTools = Object.keys(toolSet).length > 0;

    try {
      return client.streamText({
        system,
        messages: messages as AiModelMessage[],
        abortSignal: input.abortSignal,
        // Tool loop: pass the pre-filtered set + the operator step cap.
        // Absent when no tool is available → the answer-only single-
        // generation path (today's pre-tool-loop behavior).
        ...(hasTools
          ? {
              tools: toolSet,
              maxSteps: maxStepsPerRun,
              // Fires once, the moment the model client disables tools for
              // the next step because maxStepsPerRun tool-requesting steps
              // already ran (D6) — record it as a distinct run event; the
              // cap-marker PART is persisted in onFinish once the run
              // actually completes (a run that errors mid-loop after
              // capping does not claim to have "completed with the cap").
              onCapReached: () => {
                capped = true;
                enqueueEvent('run.step_cap_reached', {
                  stepsUsed: maxStepsPerRun,
                  maxSteps: maxStepsPerRun,
                });
              },
              // A tool call the model requested but that never passed the
              // gate/schema check (unlisted/non-read_only/hallucinated name,
              // or schema-invalid args) — recorded for durability/UI
              // visibility (D3/D6 "recorded, non-fatal tool error"). No
              // 'tool.started' event: the call never genuinely ran.
              onUnavailableToolCall: ({
                toolCallId,
                toolName,
                input: callInput,
                reason,
              }) => {
                persistDelta(deltas.flush());
                const result =
                  reason === 'not_available'
                    ? refusalResult(toolName)
                    : invalidCallResult(toolName);
                // No 'tool.started': the call never genuinely ran (a refusal
                // is distinguished downstream by requested+completed with no
                // started in between).
                recordToolRequested(toolCallId, toolName, callInput);
                recordToolCompleted(toolCallId, toolName, callInput, result);
              },
            }
          : {}),
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
            modelId: client.model,
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
            // Same "show what the user actually saw" honesty as streamedText:
            // reasoning and any tool activity that happened before the
            // abort/error are kept too, not silently dropped while the
            // partial answer survives. No cap notice here — the run didn't
            // complete (see onFinish), so it can't claim "answered at cap".
            parts: assistantParts({
              reasoningText,
              toolParts,
              text: streamedText,
            }),
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
            modelId: client.model,
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
              // Carry the FULL turn telemetry (tokens + cost + latency + model) so
              // the stream bridge can surface per-turn usage as message metadata
              // live and on resume — the same object persisted on the message.
              telemetry,
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
            parts: assistantParts({
              reasoningText,
              toolParts,
              text,
              // Cap-marker part (D6): persisted alongside the call/result
              // parts ONLY when the run actually reached the cap AND
              // completed — history renders the notice from persisted
              // parts, not from the run-events log.
              ...(capped
                ? {
                    capNotice: {
                      type: 'data-cap-notice',
                      data: {
                        stepsUsed: maxStepsPerRun,
                        maxSteps: maxStepsPerRun,
                      },
                    },
                  }
                : {}),
            }),
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
    modelCompleted?: {
      usage: unknown;
      finishReason: unknown;
      telemetry?: TurnTelemetry;
    };
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
        // Index the completed assistant reply for search (#195). Fire-and-forget:
        // enqueueChatReindex is best-effort and never rejects (it swallows its own
        // errors), so awaiting would only add a round-trip to turn finalization —
        // the sweep repairs a missed enqueue (its staleness check is message-time-
        // based, so it catches an assistant reply that didn't bump chats.updated_at).
        void this.reindexDispatch.enqueueChatReindex(
          input.chatId,
          input.userId,
        );

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

      let persisted: Message | undefined;
      if (turn.assistantMessage) {
        if (isCompletedAssistantTurn(turn.assistantMessage)) {
          return undefined;
        }
        persisted = await messagesRepo.updateAssistantReply({
          id: turn.assistantMessage.id,
          chatId: input.chatId,
          inReplyTo: input.inReplyTo,
          parts: input.parts,
          usage: input.telemetry,
        });
      } else if (!turn.userMessage) {
        // The user turn must still exist (it was persisted before streaming). If
        // it's gone — e.g. the chat was deleted mid-stream — skip rather than hit
        // an in_reply_to FK error.
        return undefined;
      } else {
        persisted = await messagesRepo.createAssistantReplyIfAbsent({
          chatId: input.chatId,
          parts: input.parts,
          usage: input.telemetry,
          inReplyTo: input.inReplyTo,
        });
      }

      // Bump the chat's activity time so an in-place assistant-reply update (which
      // leaves messages.created_at unchanged) still moves the search staleness
      // high-water mark — the reindex sweep's backstop for a lost enqueue depends
      // on it — and so the chat list reflects the latest turn.
      if (persisted) {
        await new ChatsRepository(tx).touch(input.chatId, input.userId);
      }
      return persisted;
    });
  }
}
