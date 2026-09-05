import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { tool, type ToolSet } from 'ai';

import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  type Message,
  type ModelToolDeclaration,
  type RunStatus,
} from '../db/schema';
import { type ModelClient } from '../models/model-client';
import {
  ChatsRepository,
  CompactionsRepository,
  isCompletedAssistantTurn,
  MessagesRepository,
} from '../chats/chats-repository';
import {
  CompactionService,
  toStoredMessages,
  type CompactionCapability,
} from '../compaction/compaction.service';
import { requestFitsContextWindow } from '../compaction/compaction';
import { SearchIndexService } from '../search/search-index.service';
import {
  SearchEmbedDispatchService,
  type ChatEmbedDispatcher,
} from '../search/search-embed-dispatch.service';
import {
  SearchReindexDispatchService,
  type ChatReindexDispatcher,
} from '../search/search-reindex-dispatch.service';
import {
  buildContext,
  partsToText,
  type MessagePart,
} from '../chats/context-builder';
import { isModelChangeItem } from '../chats/context-item-producers';
import { neutralizeToolResult } from '../chats/tool-observation-part';
import { createDeltaBuffer } from './delta-buffer';
import {
  createAssistantPartCollector,
  reconstructDurableAssistant,
  toolActivityPart,
} from './assistant-transcript';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { invalidCallResult, refusalResult, runTool } from '../tools/runner';
import { toFlexibleSchema } from '@workspace/tool-runtime/schema-utils';
import {
  type KnowledgeToolResolver,
  type ToolContext,
  type ToolResult,
} from '../tools/types';
import { KnowledgeToolRuntimeResolver } from '../knowledge/knowledge-tool-runtime-resolver';
import { toolTerminationMessage } from './tool-settlement';
import {
  RunEventsRepository,
  RunsRepository,
  type RunEventType,
} from './runs-repository';
import { TitleService, type TitleCapability } from '../titles/title.service';
import {
  buildTurnTelemetry,
  emitCompletedTurnTelemetryLog,
  turnTelemetryLogger,
  type TurnTelemetry,
} from '../chats/turn-telemetry';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';
import {
  ContextIncompatibleError,
  DYNAMIC_TOOL_EXECUTOR_RESOLVER,
  type DynamicToolExecutorResolver,
  ModelContextExecutionError,
  resolveBoundExecutableTools,
} from './snapshot-tool-execution';

type AssistantTurnTelemetry = TurnTelemetry & { runId: string };

/** One turn's assistant reply, as handed to the terminal write and its post-work. */
type AssistantTurnPersistence = {
  chatId: string;
  inReplyTo: string;
  parts: Array<MessagePart>;
  telemetry?: AssistantTurnTelemetry;
};

type AssistantTurnWrite = AssistantTurnPersistence & {
  telemetry: AssistantTurnTelemetry;
};

/** The assembled context+tools an execution attempt runs against. */
type PreparedExecutionContext = {
  system: string;
  messages: ReturnType<typeof buildContext>['messages'];
  untitled: boolean;
  toolDeclarations: Array<ModelToolDeclaration>;
  tools: Awaited<ReturnType<typeof resolveBoundExecutableTools>>;
};

type ExecuteRunInput = {
  runId: string;
  chatId: string;
  userId: string;
  userMessage: RunUserMessage;
  client: ModelClient;
  abortSignal?: AbortSignal;
};

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

/**
 * AbortSignal.abort(reason) tag for the worker's own in-process wall-clock
 * timeout (design D7 mechanism 1). Both a timeout and a user-requested cancel
 * (RunAbortRegistry.abort(), no reason) share the same AbortController/signal
 * plumbing — this is how classifyAbortedRun tells them apart so only a
 * timeout is recorded as run.expired, never run.cancelled.
 */
export const RUN_TIMEOUT_ABORT_REASON = 'run-timeout';

/**
 * Classify an aborted run's terminal status from the signal that aborted it:
 * a worker-side wall-clock timeout is run.expired; any other abort (a user
 * cancel, a superseding retry) is run.cancelled. Exported standalone — pure
 * and DB-free — so the tagging is unit-testable without the full executeRun
 * path.
 */
export function classifyAbortedRun(
  signal: AbortSignal | undefined,
): 'cancelled' | 'expired' {
  return signal?.reason === RUN_TIMEOUT_ABORT_REASON ? 'expired' : 'cancelled';
}

/** The already-persisted user turn a run executes against. */
export type RunUserMessage = {
  id: string;
  seq: number;
  parts: Array<MessagePart>;
};

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
/** The capabilities the runs worker needs to drive and terminalize a turn. */
export type RunExecutor = Pick<
  RunExecutionService,
  'executeRun' | 'settleTerminalRun'
>;

/** The search capability needed after an assistant turn commits. */
export type ChatSearchIndexer = Pick<SearchIndexService, 'reindexChat'>;

@Injectable()
export class RunExecutionService {
  private readonly logger = new Logger(RunExecutionService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(CompactionService)
    private readonly compaction: CompactionCapability,
    @Inject(TitleService)
    private readonly titles: TitleCapability,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(SearchIndexService)
    private readonly searchIndex: ChatSearchIndexer,
    @Inject(SearchReindexDispatchService)
    private readonly reindexDispatch: ChatReindexDispatcher,
    @Inject(KnowledgeToolRuntimeResolver)
    private readonly knowledgeResolver: KnowledgeToolResolver,

    @Inject(SearchEmbedDispatchService)
    private readonly embedDispatch: ChatEmbedDispatcher,
    @Optional()
    @Inject(DYNAMIC_TOOL_EXECUTOR_RESOLVER)
    private readonly dynamicToolResolver?: DynamicToolExecutorResolver,
  ) {}

  /**
   * Terminalize work that can outlive its executor (notably retry exhaustion)
   * through the same durable settlement transaction as executor callbacks.
   * Throws when that transaction cannot commit so callers never acknowledge
   * queue work whose terminal state is not durable.
   */
  async settleTerminalRun(input: {
    userId: string;
    runId: string;
    status: TerminalRunStatus;
    runPayload?: unknown;
    error?: unknown;
    telemetry?: AssistantTurnTelemetry;
  }) {
    const { telemetry, ...terminalInput } = input;
    const settlement = await this.finishRun({
      ...terminalInput,
      synthesizedTurnTelemetry: telemetry,
    });
    if (settlement.outcome === 'errored') {
      throw new Error(`Could not durably settle terminal run ${input.runId}.`);
    }
    await this.afterAssistantTurn(
      settlement.assistantMessage,
      input.userId,
      telemetry,
    );
    return settlement;
  }

  async executeRun(
    input: ExecuteRunInput,
  ): Promise<ReturnType<ModelClient['streamText']>> {
    const { client } = input;

    // Claim before any context preparation can invoke a model. Transition
    // compaction is part of this run's execution budget and cancellation
    // lifecycle, not untracked pre-work. A cancel that won the worker pickup
    // TOCTOU is settled atomically here without spending on either model.
    const claim = await this.tenantDb.runAs(input.userId, async (tx) => {
      const runs = new RunsRepository(tx);
      const events = new RunEventsRepository(tx);
      if (input.abortSignal?.aborted) {
        const status = classifyAbortedRun(input.abortSignal);
        const finished = await runs.markFinished(
          input.runId,
          input.userId,
          status,
          { message: this.abortedRunMessage(status) },
        );
        if (finished) {
          await events.append(input.runId, `run.${status}`, {
            message: this.abortedRunMessage(status),
          });
        }
        return false;
      }

      const started = await runs.markStarted(input.runId, input.userId);
      if (!started) {
        const current = await runs.findById(input.runId, input.userId);
        if (
          current?.cancelRequestedAt != null &&
          !['completed', 'failed', 'cancelled', 'expired'].includes(
            current.status,
          )
        ) {
          const cancelled = await runs.markFinished(
            input.runId,
            input.userId,
            'cancelled',
          );
          if (cancelled) {
            await events.append(input.runId, 'run.cancelled', {
              message: this.abortedRunMessage('cancelled'),
            });
          }
        }
        return false;
      }

      // The claim returns the persisted effort rather than setting an outer
      // variable: it is read inside the transaction (the run row is the single
      // source of truth for what this run executes at, not the queue payload)
      // and can only be reached on the path that actually claimed the run.
      // Deliberately never re-resolved or re-validated against current
      // configuration — a level the operator has since withdrawn is still sent
      // verbatim, and a run that stored none sends no provider option at all.
      await events.append(input.runId, 'run.started');
      return { effort: started.effort ?? undefined };
    });
    if (!claim) {
      throw new RunNotRunnableError(input.runId);
    }
    const { effort } = claim;
    if (input.abortSignal?.aborted) {
      await this.settleAbortedRun(input);
    }

    // Context assembly happens at execution time (not enqueue time): the run
    // reads the chat as it exists when it starts — compaction summary + live
    // window up to the triggering message (SPEC §9.5 puts this worker-side).
    let prepared: PreparedExecutionContext;
    try {
      const context = await this.tenantDb.runAs(input.userId, async (tx) => {
        // Titling gate (#78): read the title as of execution start — the
        // common already-titled turn must not pay a post-turn title model
        // call. The atomic \`title IS NULL\` write guard still decides races.
        const chat = await new ChatsRepository(tx).findById(
          input.chatId,
          input.userId,
        );

        const snapshot = await new ModelContextSnapshotsRepository(
          tx,
        ).findByOwnedRun(input.runId, input.userId);
        if (!snapshot) {
          throw new ModelContextExecutionError(
            `Run ${input.runId} has no owned model-context snapshot.`,
          );
        }

        const built = await this.rebuildContextForChat(
          tx,
          input,
          snapshot.systemPrompt,
        );

        return {
          ...built,
          snapshot,
          untitled: chat?.title === null,
        };
      });
      let contextItems = context.contextItems;
      prepared = {
        system: context.system,
        messages: context.messages,
        untitled: context.untitled,
        toolDeclarations: context.snapshot.toolDeclarations,
        tools: await resolveBoundExecutableTools(
          context.snapshot.toolDeclarations,
          undefined,
          this.dynamicToolResolver,
        ),
      };

      // Transition compaction replaces the request wholesale when it runs, so
      // the items recorded must be the rebuilt set — the initial build's
      // items were never sent.
      contextItems = await this.ensureRequestFitsContextWindow(
        prepared,
        contextItems,
        input,
      );
      // Recorded only once the request is final: before this point a
      // transition compaction can still replace it, and a preparation failure
      // means no request was ever made. Recording earlier would durably assert
      // a request the model never received.
      const recorded = await this.tenantDb.runAs(input.userId, (tx) =>
        new RunsRepository(tx).recordContextItems(
          input.runId,
          input.userId,
          contextItems,
        ),
      );
      // A miss means the owner-scoped row is gone — the chat was deleted out
      // from under a claimed run. Executing past that would send a request on
      // behalf of a run nobody can see, and would leave the authority record
      // empty for it; both are worse than stopping here.
      if (!recorded) {
        throw new RunNotRunnableError(input.runId);
      }
    } catch (error) {
      if (input.abortSignal?.aborted) {
        await this.settleAbortedRun(input);
      }
      if (error instanceof ModelContextExecutionError) {
        const message = error.message;
        await this.finishRun({
          userId: input.userId,
          runId: input.runId,
          status: 'failed',
          runPayload: { status: 'failed', message, code: error.code },
          error: { message, code: error.code },
        });
      }
      throw error;
    }
    const { system, messages, untitled, tools: executableTools } = prepared;

    if (input.abortSignal?.aborted) {
      await this.settleAbortedRun(input);
    }

    const streamStartedAt = Date.now();

    // `model.requested` describes the target inference, not source-model
    // transition compaction. Record it only after preparation succeeds and
    // immediately before the target call.
    await this.tenantDb.runAs(input.userId, async (tx) => {
      const events = new RunEventsRepository(tx);
      await events.append(input.runId, 'model.requested', {
        modelId: client.model,
        // Travels with modelId wherever it is recorded (available-models
        // spec); omitted rather than null when the run carried none.
        ...(effort !== undefined && { effort }),
      });
    });

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
    const assistantPartCollector = createAssistantPartCollector();
    let deltaWrites: Promise<void> = Promise.resolve();
    let progressWriteFailed = false;
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- generic run-event payload dispatcher: shape depends on `eventType` (a discriminated union `RunEventsRepository.append` accepts), and every call site below already constructs the correct literal shape (see `persistDelta`/`persistReasoning`/`recordToolRequested`); this is the single serialization chokepoint, not a validation boundary.
    const enqueueEvent = (eventType: RunEventType, payload: unknown) => {
      deltaWrites = deltaWrites.then(async () => {
        const recorded = await this.recordRunProgress(
          input.userId,
          input.runId,
          async (tx) => {
            await new RunEventsRepository(tx).append(
              input.runId,
              eventType,
              payload,
            );
          },
        );
        if (!recorded) progressWriteFailed = true;
      });
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
      abortSignal: input.abortSignal,
      knowledgeResolver: this.knowledgeResolver,
    };

    const { maxStepsPerRun, callTimeoutSeconds } =
      this.instanceConfig.config.tools;

    // Tool activity accumulated in occurrence order, for persistence on the
    // assistant message (design D5) — both genuinely-executed calls and
    // gate-refused/hallucinated calls push here, so both render through the
    // exact same ToolCallPart component web-side.
    let capped = false;

    // One place each for the two tool events that both the executed path and
    // the gate-refused path emit identically — the only difference between the
    // paths is the 'tool.started' event, which the executed path emits on its
    // own between these two.
    // Calls requested but not yet settled, with what they need to be settled
    // on the abort path (#293). Name and input live here rather than in the
    // part collector so termination settles through recordToolCompleted, and
    // the durable event and the persisted part can never disagree.
    const openToolCalls = new Map<
      string,
      { toolName: string; toolInput: unknown }
    >();
    const recordToolRequested = (
      toolCallId: string,
      toolName: string,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- the AI SDK's own inputSchema validation (`toFlexibleSchema`, wired into `tool({...})` below) already ran before this callback fires; `toolInput` here is that already-admitted, per-tool-schema-shaped value forwarded for durable recording.
      toolInput: unknown,
    ) => {
      openToolCalls.set(toolCallId, { toolName, toolInput });
      enqueueEvent('tool.requested', {
        toolCallId,
        toolName,
        input: toolInput,
      });
      // Reserve the final persisted part at request time. Tool execution can
      // complete concurrently, so appending on completion would reorder
      // history relative to the live bridge, which opens the UI part here.
      assistantPartCollector.toolRequested(toolCallId);
    };
    // Ids whose outcome has already been durably recorded. At-most-once per
    // call across BOTH the event log and the persisted part — the collector
    // has its own guard, but without this one enqueueEvent fires a second
    // tool.completed for a call the collector correctly ignored.
    const settledToolCallIds = new Set<string>();
    const recordToolCompleted = (
      toolCallId: string,
      toolName: string,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- same rationale as `recordToolRequested` above: the AI SDK's inputSchema validation already ran before this value ever reaches either function.
      toolInput: unknown,
      result: ToolResult,
    ) => {
      if (settledToolCallIds.has(toolCallId)) {
        return;
      }
      settledToolCallIds.add(toolCallId);
      openToolCalls.delete(toolCallId);
      enqueueEvent('tool.completed', {
        toolCallId,
        toolName,
        status: result.status,
        output: result,
      });
      assistantPartCollector.tool(
        toolActivityPart(toolCallId, toolName, toolInput, result),
      );
    };

    /**
     * Settle every still-open tool call when the run terminates (#293). Runs
     * through recordToolCompleted so each settlement emits its durable
     * `tool.completed` event AND fills its reserved part — the live stream,
     * the event log and history then agree. `type: 'cancelled'` marks the
     * result as produced by termination rather than by the tool, so an audit
     * can tell "we stopped this" from "the tool failed"; the part collector
     * ignores a genuine late result for an already-settled call.
     */
    const settleOpenToolCalls = (
      status: 'cancelled' | 'expired' | 'failed',
    ) => {
      const message = toolTerminationMessage(status);
      // recordToolCompleted deletes the current key; removing the entry being
      // visited is well-defined for a Map iterator, so no snapshot is needed.
      for (const [toolCallId, { toolName, toolInput }] of openToolCalls) {
        recordToolCompleted(toolCallId, toolName, toolInput, {
          status: 'error',
          type: 'cancelled',
          message,
        });
      }
    };

    // Set only when a parent abort lands while at least one tool call is open.
    // The tool continuation awaits it, so a failed durable terminal write is
    // surfaced to the stream/worker instead of becoming a detached rejection.
    let parentAbortSettlement: Promise<void> | undefined;

    // The immutable snapshot is the authority for what the model sees. The
    // registry supplied only compatible read-only executor functions above;
    // the mutable operator allowlist is intentionally not re-applied here.
    const toolSet: ToolSet = Object.fromEntries(
      executableTools.map(({ declaration, executor }) => [
        declaration.id,
        tool({
          description: declaration.description,
          inputSchema: toFlexibleSchema(declaration.inputSchema)!,
          execute: async (
            // eslint-disable-next-line anti-slop/no-unknown-parameters -- mirrors the AI SDK's own `tool({ execute })` callback signature; `args` is validated against `declaration.inputSchema` (`toFlexibleSchema` above) by the SDK itself before this executor is invoked -- the boundary parse already happened one frame up, inside the SDK.
            args: unknown,
            { toolCallId }: { toolCallId: string },
          ) => {
            // Flush any buffered model.delta of THIS step FIRST, so partial
            // text is enqueued before the tool events (stream-order).
            persistDelta(deltas.flush());
            // toolCallId correlates requested/started/completed into one UI
            // tool part (tool-loop UI visibility).
            recordToolRequested(toolCallId, declaration.id, args);
            enqueueEvent('tool.started', {
              toolCallId,
              toolName: declaration.id,
            });
            const result = await runTool(
              executor,
              args,
              { ...toolContext, toolCallId },
              callTimeoutSeconds,
            );
            if (input.abortSignal?.aborted) {
              await parentAbortSettlement;
            } else {
              // The observation records the tool's exact output; only what the
              // model reads is neutralized.
              recordToolCompleted(toolCallId, declaration.id, args, result);
            }
            return neutralizeToolResult(result);
          },
        }),
      ]),
    );
    const hasTools = Object.keys(toolSet).length > 0;

    // Reserve termination settlement synchronously on the PARENT run signal,
    // before runTool's promise continuation can record its own cancellation
    // result. Abort event listeners run synchronously in registration order;
    // this listener is installed before the provider starts any tool, so
    // recordToolCompleted's first-writer guard makes the later runTool result a
    // no-op. A per-call timeout aborts only runTool's derived signal and never
    // reaches this listener, so ordinary timeout completions are unchanged.
    const settleToolsOnParentAbort = () => {
      if (openToolCalls.size === 0 || parentAbortSettlement) {
        return;
      }
      const status = classifyAbortedRun(input.abortSignal);
      const message = toolTerminationMessage(status);
      settleOpenToolCalls(status);
      parentAbortSettlement = (async () => {
        await deltaWrites;
        if (progressWriteFailed) {
          await this.failRunProgressPersistence({
            userId: input.userId,
            runId: input.runId,
          });
          return;
        }
        try {
          await this.settleTerminalRun({
            userId: input.userId,
            runId: input.runId,
            status,
            runPayload: { status, message },
            error: { message },
          });
        } catch {
          await this.failRunProgressPersistence({
            userId: input.userId,
            runId: input.runId,
          });
        }
      })();
    };
    const removeParentAbortListener = () => {
      input.abortSignal?.removeEventListener('abort', settleToolsOnParentAbort);
    };
    if (input.abortSignal?.aborted) {
      settleToolsOnParentAbort();
    } else {
      input.abortSignal?.addEventListener('abort', settleToolsOnParentAbort, {
        once: true,
      });
    }

    try {
      return client.streamText({
        system,
        messages,
        abortSignal: input.abortSignal,
        // Absent → no provider option at all, leaving the provider default.
        ...(effort !== undefined && { effort }),
        // Tool loop: pass the pre-filtered set + the operator step cap.
        // Absent when no tool is available → the answer-only single-
        // generation path (today's pre-tool-loop behavior).
        ...(hasTools && {
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
        }),
        onTextDelta: (text) => {
          streamedText += text;
          assistantPartCollector.text(text);
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
          assistantPartCollector.reasoning(text);
          persistDelta(deltas.flush());
          persistReasoning(reasoningDeltas.push(text, Date.now()));
        },
        onError: async ({ error }) => {
          removeParentAbortListener();
          if (parentAbortSettlement) {
            await parentAbortSettlement;
            return;
          }
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
            ...(effort !== undefined && { effort }),
            latencyMs: Date.now() - streamStartedAt,
            price: client.pricing,
          });
          const assistantTelemetry: AssistantTurnTelemetry = {
            ...telemetry,
            runId: input.runId,
          };

          const status =
            telemetry.status === 'aborted'
              ? classifyAbortedRun(input.abortSignal)
              : 'failed';
          persistReasoning(reasoningDeltas.flush());
          persistDelta(deltas.flush());
          await deltaWrites;
          if (progressWriteFailed) {
            await this.settleProgressWriteFailure({
              userId: input.userId,
              runId: input.runId,
              telemetry: assistantTelemetry,
            });
            return;
          }
          const message =
            status === 'expired'
              ? 'Run timed out: exceeded its wall-clock budget.'
              : error instanceof Error
                ? error.message
                : String(error);
          // Settle before reading parts: a call still open here was rendered
          // as running live, and an unsettled part is filtered out of
          // history — so without this the live view and the reload disagree.
          settleOpenToolCalls(status);
          // Re-drain: settleOpenToolCalls enqueued new events via
          // recordToolCompleted. Without this await, finishRun's terminal
          // event can commit before the settlement events, and a process kill
          // in that window permanently loses them.
          await deltaWrites;
          if (progressWriteFailed) {
            await this.settleProgressWriteFailure({
              userId: input.userId,
              runId: input.runId,
              telemetry: assistantTelemetry,
            });
            return;
          }
          const turn: AssistantTurnWrite = {
            chatId: input.chatId,
            inReplyTo: input.userMessage.id,
            // Same "show what the user actually saw" honesty as streamedText:
            // reasoning and any tool activity that happened before the
            // abort/error are kept too, not silently dropped while the
            // partial answer survives. No cap notice here — the run didn't
            // complete (see onFinish), so it can't claim "answered at cap".
            parts: assistantPartCollector.parts(),
            telemetry: assistantTelemetry,
          };
          const finish = await this.finishRun({
            userId: input.userId,
            runId: input.runId,
            status,
            runPayload: {
              status,
              message,
            },
            error: { message },
            assistantTurn: turn,
          });

          await this.afterAssistantTurn(
            finish.assistantMessage,
            input.userId,
            turn.telemetry,
          );
        },
        onFinish: async ({ text, usage, finishReason }) => {
          removeParentAbortListener();
          if (parentAbortSettlement) {
            await parentAbortSettlement;
            return;
          }
          // `streamedText === ''` makes the `startsWith` check vacuously true
          // (every string starts with the empty string), so that case is
          // already covered by this branch — there is no second case to guard.
          if (text.startsWith(streamedText)) {
            assistantPartCollector.text(text.slice(streamedText.length));
          }
          const telemetry = buildTurnTelemetry({
            usage,
            finishReason,
            status: input.abortSignal?.aborted
              ? 'aborted'
              : finishReason === 'error'
                ? 'error'
                : 'completed',
            modelId: client.model,
            ...(effort !== undefined && { effort }),
            latencyMs: Date.now() - streamStartedAt,
            price: client.pricing,
          });
          const assistantTelemetry: AssistantTurnTelemetry = {
            ...telemetry,
            runId: input.runId,
          };

          const status =
            telemetry.status === 'completed'
              ? 'completed'
              : telemetry.status === 'aborted'
                ? classifyAbortedRun(input.abortSignal)
                : 'failed';
          // Drain buffered reasoning + deltas BEFORE the terminal events so the
          // log reads in stream order: …model.delta, model.completed, run.completed.
          persistReasoning(reasoningDeltas.flush());
          persistDelta(deltas.flush());
          await deltaWrites;
          if (progressWriteFailed) {
            await this.settleProgressWriteFailure({
              userId: input.userId,
              runId: input.runId,
              telemetry: assistantTelemetry,
            });
            return;
          }
          // Persist the accumulated thinking as a leading reasoning part (display
          // only — partsToText strips it, so it is never re-fed). Capped so an
          // unbounded thinking blob doesn't amplify every later turn's context
          // read (each build reads all message parts, then discards reasoning).
          // Only turns reaching onFinish (normal completion + the narrow
          // finish-races-abort case) get this; the common event-driven abort
          // goes through onError → the streamedText-only parts above (reasoning
          // dropped, like text-in-progress today).
          if (capped) {
            assistantPartCollector.capNotice({
              type: 'data-cap-notice',
              data: { stepsUsed: maxStepsPerRun, maxSteps: maxStepsPerRun },
            });
          }
          // Normally a no-op — a completed run settled every call through the
          // toolSet wrapper. It fires for the narrow finish-races-abort case,
          // where a call can still be open when this path wins.
          if (status !== 'completed') {
            settleOpenToolCalls(status);
            // Re-drain after settlement — same reason as in onError.
            await deltaWrites;
            if (progressWriteFailed) {
              await this.settleProgressWriteFailure({
                userId: input.userId,
                runId: input.runId,
                telemetry: assistantTelemetry,
              });
              return;
            }
          }
          const turn: AssistantTurnWrite = {
            chatId: input.chatId,
            inReplyTo: input.userMessage.id,
            parts: assistantPartCollector.parts(),
            telemetry: assistantTelemetry,
          };
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
              telemetry: assistantTelemetry,
            },
            assistantTurn: turn,
          });

          await this.afterAssistantTurn(
            finish.assistantMessage,
            input.userId,
            turn.telemetry,
          );

          // Post-work needs a committed turn to act on, and needs to own it.
          // Two cases have neither. An intentional terminal state written by
          // someone else (cancel/supersede): the newer attempt owns the turn.
          // And a terminal transaction that rolled back with nothing salvaged:
          // there is no stored turn to title after or compact around, so
          // running either would spend a title model call on a turn that does
          // not exist. The gate is the committed message rather than the
          // outcome, because 'errored' no longer implies nothing committed —
          // the catch salvages the answer in its own transaction, and a chat
          // whose first turn landed that way still needs a title.
          if (
            (finish.outcome === 'errored' && !finish.assistantMessage) ||
            (finish.outcome === 'lost' && finish.finalStatus !== 'expired')
          ) {
            return;
          }

          // Post-turn work (#57 compaction, #78 titling), both AFTER the
          // terminal commit. Titling is awaited only to keep it inside the
          // job's lifetime — the client's stream already ended at
          // `run.completed`, so a title landing here is observed by a later
          // refetch, not this turn's (#261 comment thread; #78's
          // "before stream completion" wording predates the queue split).
          // Failures are swallowed by TitleService. Compaction is
          // fire-and-forget.
          if (telemetry.status === 'completed') {
            void this.compaction.maybeCompact({
              chatId: input.chatId,
              userId: input.userId,
              client,
              // The exact system prompt this turn used — the compaction request
              // reuses it so its prefix hits the provider prompt cache this
              // turn just populated (#57).
              system,
              toolDeclarations: prepared.toolDeclarations,
              // Same reason the system prompt is reused: compaction runs
              // immediately after the turn to land inside the provider's
              // prompt-cache TTL, and a differing effort invalidates the
              // message blocks that request shape exists to reuse.
              ...(effort !== undefined && { effort }),
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
      removeParentAbortListener();
      // A synchronous throw from streamText (provider/config validation before
      // any callback can fire) would otherwise strand the claimed run at
      // 'running_model' until the deadman sweep expires it — fail it now.
      if (input.abortSignal?.aborted) {
        await this.settleAbortedRun(input);
      }
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
   * Loads the latest compaction and the message history up to the run's
   * triggering message, then rebuilds the context with `systemPrompt` — the
   * shared core of both the initial per-run context build and a
   * transition-compaction rebuild.
   */
  private async rebuildContextForChat(
    tx: Db,
    input: ExecuteRunInput,
    systemPrompt: string,
  ): Promise<ReturnType<typeof buildContext>> {
    const { chatId, userId, userMessage } = input;
    const compaction = await new CompactionsRepository(tx).findLatestByChatId(
      chatId,
      userId,
      { beforeSeq: userMessage.seq },
    );
    const history = await new MessagesRepository(tx).findByChatId(
      chatId,
      userId,
      {
        maxSeq: userMessage.seq,
        ...(compaction && { sinceSeq: compaction.uptoSeq }),
      },
    );
    return buildContext(toStoredMessages(history), {
      systemPrompt,
      ...(compaction && {
        compaction: {
          summary: compaction.summary,
          uptoSeq: compaction.uptoSeq,
          replacementHistory: compaction.replacementHistory,
        },
      }),
    });
  }

  /**
   * If the built request doesn't fit the target model's context window,
   * attempts recovery via `compactAndRebuildForContextWindow` — or fails fast
   * with `ContextIncompatibleError` when there is no model-switch anchor to
   * transition from. Returns `contextItems` unchanged when the request
   * already fits.
   */
  private async ensureRequestFitsContextWindow(
    prepared: PreparedExecutionContext,
    contextItems: ReturnType<typeof buildContext>['contextItems'],
    input: ExecuteRunInput,
  ): Promise<ReturnType<typeof buildContext>['contextItems']> {
    const reservedOutputTokens =
      this.instanceConfig.config.runs.maxOutputTokens;
    if (
      requestFitsContextWindow({
        system: prepared.system,
        messages: prepared.messages,
        toolDeclarations: prepared.toolDeclarations,
        contextWindowTokens: input.client.contextWindowTokens,
        reservedOutputTokens,
      })
    ) {
      return contextItems;
    }
    if (!input.userMessage.parts.some(isModelChangeItem)) {
      throw new ContextIncompatibleError(
        'The complete request exceeds the target model context window and no model-switch source context is available.',
      );
    }
    return this.compactAndRebuildForContextWindow(
      prepared,
      input,
      reservedOutputTokens,
    );
  }

  /**
   * Attempts one transition compaction and context rebuild, then re-checks;
   * throws `ContextIncompatibleError` if compaction itself fails (unless the
   * abort signal fired, which rethrows) or the rebuilt request still doesn't
   * fit. Mutates `prepared.messages` in place and returns the rebuilt context
   * items to record — the initial build's items were never sent.
   */
  private async compactAndRebuildForContextWindow(
    prepared: PreparedExecutionContext,
    input: ExecuteRunInput,
    reservedOutputTokens: number | null,
  ): Promise<ReturnType<typeof buildContext>['contextItems']> {
    try {
      await this.compaction.compactForTransition({
        chatId: input.chatId,
        userId: input.userId,
        triggeringUserSeq: input.userMessage.seq,
        reservedOutputTokens,
        abortSignal: input.abortSignal,
      });
    } catch (error) {
      if (input.abortSignal?.aborted) throw error;
      throw new ContextIncompatibleError(
        'The complete request does not fit the target model and transition compaction could not produce compatible context.',
        { cause: error },
      );
    }
    const rebuilt = await this.tenantDb.runAs(input.userId, (tx) =>
      this.rebuildContextForChat(tx, input, prepared.system),
    );
    prepared.messages = rebuilt.messages;
    if (
      !requestFitsContextWindow({
        system: prepared.system,
        messages: prepared.messages,
        toolDeclarations: prepared.toolDeclarations,
        contextWindowTokens: input.client.contextWindowTokens,
        reservedOutputTokens,
      })
    ) {
      throw new ContextIncompatibleError(
        'The complete request still exceeds the target model context window after one transition compaction.',
      );
    }
    return rebuilt.contextItems;
  }

  private abortedRunMessage(status: 'cancelled' | 'expired'): string {
    return status === 'expired'
      ? 'Run timed out: exceeded its wall-clock budget.'
      : 'Run was cancelled before model inference.';
  }

  /** Settle an observed abort before streaming and suppress queue retries only
   * after the terminal state + matching event are durably visible. */
  private async settleAbortedRun(input: {
    userId: string;
    runId: string;
    abortSignal?: AbortSignal;
  }): Promise<never> {
    const status = classifyAbortedRun(input.abortSignal);
    const message = this.abortedRunMessage(status);
    const finish = await this.finishRun({
      userId: input.userId,
      runId: input.runId,
      status,
      runPayload: { status, message },
      error: { message },
    });
    if (finish.outcome === 'errored') {
      throw new Error(
        `Could not durably settle aborted run ${input.runId}; retry required.`,
      );
    }
    throw new RunNotRunnableError(input.runId);
  }

  /**
   * Settle the run as failed because its own progress could not be persisted.
   *
   * Reached from four points in the stream lifecycle — `onError` and
   * `onFinish`, each before and after the assistant turn is written. Once a
   * delta write has failed the durable log no longer matches what the model
   * produced, so the run must not settle as anything but failed, and it must
   * settle the same way from every one of those points.
   */
  private async settleProgressWriteFailure(input: {
    userId: string;
    runId: string;
    telemetry: AssistantTurnTelemetry;
  }): Promise<void> {
    const message = 'Run progress could not be persisted.';
    await this.settleTerminalRun({
      userId: input.userId,
      runId: input.runId,
      status: 'failed',
      telemetry: input.telemetry,
      runPayload: { status: 'failed', message },
      error: { message },
    });
  }

  private async failRunProgressPersistence(input: {
    userId: string;
    runId: string;
  }): Promise<void> {
    const message = 'Run progress could not be persisted.';
    try {
      await this.settleTerminalRun({
        userId: input.userId,
        runId: input.runId,
        status: 'failed',
        runPayload: { status: 'failed', message },
        error: { message },
      });
    } catch {
      // Leave the run nonterminal when even the fallback settlement cannot
      // durably synthesize the missing tool completion.
    }
  }

  /**
   * Progress events are the replay source of truth. A failed write is logged
   * and reported to the caller, which suppresses the assistant-message
   * projection so history cannot claim a transcript the durable event log
   * cannot replay.
   */
  private async recordRunProgress(
    userId: string,
    runId: string,
    write: (
      tx: Parameters<Parameters<TenantDbService['runAs']>[1]>[0],
    ) => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.tenantDb.runAs(userId, write);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to record run progress for run ${runId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * Terminal bookkeeping with a tri-state outcome, so callers can tell an
   * idempotent loss (another writer finished the run — read its status to
   * decide what the turn means) from a swallowed DB error.
   *
   * When `assistantTurn` is supplied the message is persisted in THIS
   * transaction, so "run is terminal" and "the answer is readable" become
   * atomic (#261). They used to be two commits, and every reader that landed
   * between them — a resume probe (204: no active run) followed by a history
   * refetch (no assistant message) — lost the answer with nothing left to
   * trigger another fetch.
   *
   * The coupling runs both ways, deliberately: a failure in ANY step here —
   * not only the message write — now rolls back the whole turn, and since the
   * deadman sweep EXPIRES a stranded run rather than re-running it, the
   * streamed answer is then gone rather than merely unacknowledged. That is
   * the accepted cost. What it replaces is worse: a run reporting an answer it
   * never stored, equally unrecoverable and, unlike this, on the normal path.
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
    assistantTurn?: AssistantTurnWrite;
    synthesizedTurnTelemetry?: AssistantTurnTelemetry;
  }): Promise<
    | { outcome: 'won' | 'errored'; assistantMessage?: Message }
    | { outcome: 'lost'; finalStatus?: string; assistantMessage?: Message }
  > {
    try {
      return await this.tenantDb.runAs(input.userId, async (tx) => {
        // LOCK ORDER — the run row first, then the message row, and no
        // EXCLUSIVE lock on the chat row (its activity bump moved to
        // afterAssistantTurn for exactly this reason). The chat is the one row
        // other writers contend on from both directions:
        // `chat-loop.service.ts` takes it BEFORE this chat's run (send),
        // `chats.service.ts#deleteChat` takes it AFTER (cancel, then delete) —
        // so holding it for update here would close a cycle with one of them
        // whichever order this transaction picked.
        //
        // Inserting the assistant message DOES take a FOR KEY SHARE lock on the
        // chat row, through the messages.chat_id foreign key, and that is safe
        // for one specific reason: FOR KEY SHARE conflicts ONLY with FOR
        // UPDATE. The send path holds that chat row for its whole transaction —
        // from its activity touch through the run insert that waits on us — but
        // an UPDATE of a non-key column takes FOR NO KEY UPDATE, which a KEY
        // SHARE request does not wait on, so the cycle never closes. That rule
        // is the entire premise here, so it is pinned by a test rather than
        // asserted ("a concurrent chat touch does not block the finalizer's
        // message write" in worker-concurrency.integration.test.ts).
        //
        // deleteChat is the other direction (runs, then chats): its first act
        // (requestCancel) blocks on the run row below, so it never reaches its
        // chat DELETE — the one lock that WOULD block us — while this
        // transaction is open. Every other writer takes the run row before any
        // message row of ours, and per-turn message rows are disjoint, so this
        // order waits on no one who waits on us.
        const runsRepo = new RunsRepository(tx);
        const finished = await runsRepo.markFinished(
          input.runId,
          input.userId,
          input.status,
          input.error,
        );
        if (!finished) {
          const current = await runsRepo.findById(input.runId, input.userId);
          // Message persistence is independent of who won the bookkeeping race,
          // EXCEPT when another writer finished the run with intent: cancelled
          // (user stop / supersede — the newer attempt owns the turn, and a
          // completed reply here would make its own persist a no-op) or a
          // dual-fire that already recorded it. An 'expired' loss still keeps
          // what streamed — expiry is a liveness misjudgment, not user intent.
          //
          // This branch is SALVAGE, and deliberately outside the atomicity
          // guarantee above: the terminal event was published by someone else
          // (dead-letter expiry) before this worker knew, so no transaction
          // here can be atomic with a commit that already happened. Making it
          // so would mean the expiry writer holding the streamed parts, which
          // live only in this process's memory. What this recovers is a partial
          // answer for a run already declared dead; the run this worker itself
          // finishes — every normal turn — is atomic.
          const assistantMessage =
            current?.status === 'expired'
              ? await this.persistAssistantMessage(
                  tx,
                  input.userId,
                  input.assistantTurn,
                )
              : undefined;
          return {
            outcome: 'lost' as const,
            finalStatus: current?.status,
            assistantMessage,
          };
        }

        const events = new RunEventsRepository(tx);
        const durable = reconstructDurableAssistant(
          await events.listByRunId(input.runId, input.userId),
        );
        for (const [
          toolCallId,
          { toolName, toolInput },
        ] of durable.openToolCalls) {
          if (input.status === 'completed') {
            throw new Error(
              `Run ${input.runId} cannot complete with durable tool calls still open.`,
            );
          }
          const result: ToolResult = {
            status: 'error',
            type: 'cancelled',
            message: toolTerminationMessage(input.status),
          };
          // One transaction owns the run row before reaching here. Appending
          // settlement, projecting its assistant part, and publishing the
          // terminal event therefore form one fail-closed ordering domain.
          await events.append(input.runId, 'tool.completed', {
            toolCallId,
            toolName,
            status: result.status,
            output: result,
          });
          durable.collector.tool(
            toolActivityPart(toolCallId, toolName, toolInput, result),
          );
        }
        if (input.modelCompleted) {
          await events.append(
            input.runId,
            'model.completed',
            input.modelCompleted,
          );
        }
        const durableParts = durable.collector.parts();
        let assistantTurn: AssistantTurnPersistence | undefined =
          input.assistantTurn;
        if (!assistantTurn && durableParts.length > 0) {
          if (!finished.messageId) {
            throw new Error(
              `Run ${input.runId} has durable assistant parts but no triggering message.`,
            );
          }
          assistantTurn = {
            chatId: finished.chatId,
            inReplyTo: finished.messageId,
            parts: durableParts,
            ...(input.synthesizedTurnTelemetry && {
              telemetry: input.synthesizedTurnTelemetry,
            }),
          };
        }
        const assistantMessage = await this.persistAssistantMessage(
          tx,
          input.userId,
          assistantTurn,
        );
        await events.append(
          input.runId,
          `run.${input.status}`,
          input.runPayload,
        );
        return {
          outcome: 'won' as const,
          assistantMessage,
        };
      });
    } catch (error) {
      this.logger.error(
        `Failed to finish run ${input.runId}`,
        error instanceof Error ? error.stack : String(error),
      );
      // The whole turn rolled back, including an answer the user already
      // watched stream. Atomicity is a guarantee about what readers can
      // OBSERVE, not a reason to throw the answer away when the bookkeeping
      // half is what failed — so salvage it in its own transaction, which is
      // exactly what this path did before the two writes were joined. The run
      // stays non-terminal either way (the single-flight admission path expires
      // it on the chat's next message), so this can only add back a readable
      // answer, never publish a terminal run without one.
      return {
        outcome: 'errored',
        assistantMessage: await this.salvageAssistantMessage(input),
      };
    }
  }

  /** Best-effort standalone persist after the terminal transaction rolled back. */
  private async salvageAssistantMessage(input: {
    userId: string;
    runId: string;
    assistantTurn?: AssistantTurnWrite;
  }): Promise<Message | undefined> {
    if (!input.assistantTurn) {
      return undefined;
    }
    try {
      return await this.tenantDb.runAs(input.userId, (tx) =>
        this.persistAssistantMessage(tx, input.userId, input.assistantTurn),
      );
    } catch (error) {
      this.logger.error(
        `Failed to salvage the assistant turn for run ${input.runId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return undefined;
    }
  }

  /**
   * Work that must NOT share the terminal transaction: it is best-effort, and
   * a failure here must not roll back the committed turn. No-op when nothing
   * was persisted (dual-fire, or the chat vanished mid-stream).
   */
  /**
   * Bump the chat's activity time so an in-place assistant-reply update
   * (which leaves messages.created_at unchanged) still moves the search
   * staleness high-water mark — the reindex sweep's backstop for a lost
   * enqueue — and so the chat list reflects the latest turn. Its own
   * single-row transaction, called BEFORE the reindex rather than in the
   * terminal one: the finalizer never holds the chat row (see the lock-order
   * note there), and a touch landing after the reindex would leave every
   * completed turn looking stale (`indexed_at < updated_at`) and re-enqueue
   * it for nothing.
   */
  private async touchChatActivity(
    chatId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.tenantDb.runAs(userId, (tx) =>
        new ChatsRepository(tx).touch(chatId, userId),
      );
    } catch (error) {
      this.logger.error(
        `Failed to bump activity time for chat ${chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Tier-1 synchronous lexical index: rebuild inline on the worker path
   * (already post-model-call, so a rebuild is cheap) so the finished turn is
   * searchable at once. Post-commit + best-effort: a chunker failure must
   * never fail the run — on error fall back to the async reindex queue (a
   * producer of the general per-chat reindex job).
   */
  private async reindexAfterTurn(
    chatId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.searchIndex.reindexChat(chatId, userId);
      // chat-search-embeddings design D5: the inline Tier-1 rebuild is one of
      // the three enqueue sites embed work must fire from — the reindex
      // worker only runs on the fallback/fork/sweep paths below, so an
      // ordinary turn would otherwise produce no embedding work until a
      // sweep noticed. Best-effort + off-by-default; see the dispatch
      // service's own contract.
      void this.embedDispatch.enqueueChatEmbed(chatId, userId);
    } catch (error) {
      this.logger.error(
        `Inline reindex failed for chat ${chatId}; falling back to async`,
        error instanceof Error ? error.stack : String(error),
      );
      void this.reindexDispatch.enqueueChatReindex(chatId, userId);
    }
  }

  private async afterAssistantTurn(
    assistantMessage: Message | undefined,
    userId: string,
    telemetry?: AssistantTurnTelemetry,
  ): Promise<void> {
    if (!assistantMessage) {
      return;
    }

    await this.touchChatActivity(assistantMessage.chatId, userId);
    await this.reindexAfterTurn(assistantMessage.chatId, userId);

    if (!telemetry || !assistantMessage.inReplyTo) {
      return;
    }
    emitCompletedTurnTelemetryLog(turnTelemetryLogger, {
      chatId: assistantMessage.chatId,
      messageId: assistantMessage.id,
      inReplyTo: assistantMessage.inReplyTo,
      telemetry,
      onError: (error) => {
        this.logger.error(
          `Failed to emit assistant turn telemetry for chat ${assistantMessage.chatId}`,
          error instanceof Error ? error.stack : String(error),
        );
      },
    });
  }

  /**
   * Caller-supplied `tx`: normally the terminal transaction, or a standalone
   * one on the salvage path.
   */
  private async persistAssistantMessage(
    tx: Db,
    userId: string,
    write: AssistantTurnPersistence | undefined,
  ): Promise<Message | undefined> {
    if (!write) {
      return undefined;
    }

    const messagesRepo = new MessagesRepository(tx);
    const turn = await messagesRepo.findTurnState(
      write.chatId,
      userId,
      write.inReplyTo,
    );

    if (turn.assistantMessage) {
      if (isCompletedAssistantTurn(turn.assistantMessage)) {
        return undefined;
      }
      return messagesRepo.updateAssistantReply({
        id: turn.assistantMessage.id,
        chatId: write.chatId,
        inReplyTo: write.inReplyTo,
        parts: write.parts,
        usage: write.telemetry,
      });
    }
    if (!turn.userMessage) {
      // The user turn must still exist (it was persisted before streaming). If
      // it's gone — e.g. the chat was deleted mid-stream — skip rather than hit
      // an in_reply_to FK error.
      return undefined;
    }
    return messagesRepo.createAssistantReplyIfAbsent({
      chatId: write.chatId,
      parts: write.parts,
      usage: write.telemetry,
      inReplyTo: write.inReplyTo,
    });
  }
}
