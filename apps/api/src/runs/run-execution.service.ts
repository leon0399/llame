import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import {
  buildContext,
  CHAT_SYSTEM_PROMPT,
  partsToText,
  type MessagePart,
  type StoredMessage,
} from '../chats/context-builder';
import { createDeltaBuffer } from './delta-buffer';
import {
  BUILTIN_TOOLS,
  resolveAvailableTools,
  type ToolPolicyVerdict,
} from '../chats/tools/registry';
import { type ToolRiskClass } from '../chats/tools/types';
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

/** Default tool-loop step cap when RUN_MAX_STEPS is unset. */
export const DEFAULT_MAX_STEPS = 4;

/**
 * SEAM(#131): the tool loop's hard step cap was originally sourced from the
 * config-resolver's per-run snapshot (`runs.config_snapshot` → `run.maxSteps`,
 * org/user/chat-scope overridable). Config-resolver (#131) never shipped to
 * master — its PR was closed/superseded by instance-config (#165), which does
 * not (yet) model a per-run scope hierarchy. Read RUN_MAX_STEPS directly from
 * env instead, same pattern CompactionService uses for
 * COMPACTION_TOKEN_THRESHOLD (positiveEnvNumber below mirrors its helper).
 * Wiring this into a real config layer is a decision for the fresh tool-loop
 * spec, not this rebase.
 */
function runMaxSteps(config: ConfigService): number {
  const value = Number(config.get<string>('RUN_MAX_STEPS'));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_STEPS;
}

/**
 * The operator's instance-level tool allowlist (`TOOLS_ENABLED` env). Parsed
 * from env — NEVER from the user-mergeable config snapshot: `configs_write`
 * RLS lets a user write their OWN user-scope config, so honoring a merged
 * `tools.enabled` would be a self-grant. Env is operator-only.
 */
export function parseEnabledTools(
  raw: string | undefined,
): ReadonlySet<string> {
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/**
 * Risk classes an operator may enable via the blunt `TOOLS_ENABLED` env switch.
 * Deliberately EXCLUDES `write_external`, `destructive` (and any future
 * high-risk class): env enablement grants WITHOUT approval-gating (unlike a
 * policy allow, which carries approval levels), so a genuinely dangerous tool
 * must go through an explicit policy `allow`, never a bare env toggle. Own-scope
 * low/medium tools (the current + near-term built-ins) are env-enablable.
 */
const ENV_ENABLABLE_RISK_CLASSES: ReadonlySet<ToolRiskClass> = new Set([
  'read_only',
  'compute_only',
  'search_only',
  'write_local',
  'write_internal',
]);

/**
 * Apply operator enablement as an instance-scope allow that a policy deny still
 * overrides: only the `'unset'` (no policy matched) verdict is upgraded, and
 * only for an env-enablable risk class. A policy `'deny'` (explicit or the
 * fail-closed all-deny) and a policy `'allow'` are untouched — so an operator
 * can enable a tool instance-wide while a policy still denies it for one user,
 * and enablement never bypasses a deny or grants a high-risk tool.
 */
export function applyEnablement(
  verdict: ToolPolicyVerdict,
  tool: { name: string; riskClass: ToolRiskClass },
  enabledTools: ReadonlySet<string>,
): ToolPolicyVerdict {
  return verdict === 'unset' &&
    enabledTools.has(tool.name) &&
    ENV_ENABLABLE_RISK_CLASSES.has(tool.riskClass)
    ? 'allow'
    : verdict;
}

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
  const parts: MessagePart[] = [];
  if (reasoningText.length > 0) {
    const reasoning =
      reasoningText.length > REASONING_PERSIST_MAX
        ? `${reasoningText.slice(0, REASONING_PERSIST_MAX)}…`
        : reasoningText;
    parts.push({ type: 'reasoning', text: reasoning });
  }
  // Skip an empty text part: a reasoning-only turn (or one that hits onFinish
  // with no visible answer) should not persist a spurious `{ type: 'text',
  // text: '' }` -- no downstream renderer (chat-page.tsx, markdown export)
  // needs an empty text bubble/line.
  if (text.length > 0) {
    parts.push({ type: 'text', text });
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
    private readonly config: ConfigService,
  ) {}

  /**
   * SEAM(#133): per-tool verdict for this turn, composed with operator env
   * enablement (`TOOLS_ENABLED`). The original design consulted a real policy
   * engine here — `PolicyService.checkWithin` per built-in, in the SAME
   * transaction that resolved the run's other config, each decision audited
   * (deny overrides allow; an allow demanding human approval is treated as
   * unavailable, since there is no approval flow yet). Policy engine (#133)
   * never shipped to master — its PR is open, unmerged, rebased separately —
   * so there is no policy to consult: every tool's verdict is unconditionally
   * `'unset'`, which composes with `parseEnabledTools`/`ENV_ENABLABLE_RISK_CLASSES`
   * exactly as it would with a real "no policy matched" result — the safe
   * allowlist (registry.ts) is the only source of availability until #133
   * lands and this stub is replaced with a real policy check. Wiring the
   * actual policy engine back in is NOT this rebase's call to make.
   */
  private resolveToolVerdicts(
    userId: string,
    chatId: string,
  ): Map<string, ToolPolicyVerdict> {
    void userId;
    void chatId;
    // Operator enablement (instance env only — never user-writable config).
    const enabledTools = parseEnabledTools(
      this.config.get<string>('TOOLS_ENABLED'),
    );
    return new Map(
      BUILTIN_TOOLS.map((builtin) => [
        builtin.name,
        applyEnablement('unset', builtin, enabledTools),
      ]),
    );
  }

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

    // Tool verdict resolution (SEAM(#133), see resolveToolVerdicts): every
    // tool resolves 'unset' — the safe allowlist + TOOLS_ENABLED decide.
    const toolVerdicts = this.resolveToolVerdicts(
      input.userId,
      input.chatId,
    );

    // Trusted execution context for data tools — built from the RUN's fields,
    // NEVER from model input, so a tool's data scope can't be widened by the
    // model (authorization identity from a trusted source only).
    const toolContext = {
      userId: input.userId,
      chatId: input.chatId,
      tenantDb: this.tenantDb,
    };

    // Available tools for this turn (MVP tool loop): pre-filtered by the
    // fail-closed allowlist BEFORE the stream — no mid-stream permission DB
    // work (the process shares one Postgres connection).
    const toolSet: ToolSet = Object.fromEntries(
      resolveAvailableTools(
        BUILTIN_TOOLS,
        (builtin) => toolVerdicts.get(builtin.name) ?? 'unset',
      ).map((builtin) => [
        builtin.name,
        tool({
          description: builtin.description,
          inputSchema: builtin.inputSchema,
          execute: async (
            args: unknown,
            { toolCallId }: { toolCallId: string },
          ) => {
            // Flush any buffered model.delta of THIS step FIRST, so partial
            // text is enqueued before the tool events (stream-order).
            persistDelta(deltas.flush());
            // toolCallId correlates the call with its result — the bridge
            // pairs them into one UI tool part (tool-loop UI visibility).
            enqueueEvent('tool.call', {
              toolCallId,
              toolName: builtin.name,
              args,
            });
            const result = await builtin.execute(args as never, toolContext);
            enqueueEvent('tool.result', {
              toolCallId,
              toolName: builtin.name,
              status: result.status,
              output: result,
            });
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
        // Tool loop (MVP): pass the pre-filtered set + hard step cap. Absent
        // when no tool is available → the answer-only single-generation path.
        ...(hasTools
          ? { tools: toolSet, maxSteps: runMaxSteps(this.config) }
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
            // reasoning that streamed before the abort/error is kept too, not
            // silently dropped while the partial answer survives.
            parts: assistantParts(reasoningText, streamedText),
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
