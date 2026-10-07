import { realpath, stat } from 'node:fs/promises';

import { isBashTool, isHostCapabilityTool } from '../tools/bash';
import { isNativeFileTool } from '../tools/native-files';
import { NativeFilesRepository } from './native-files-repository';
import { serializeNativeModelOutput } from '@workspace/native-file-tools';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  tool,
  type LanguageModelUsage,
  type ProviderMetadata,
  type ToolSet,
} from 'ai';

import { canonicalJson, compareCodePoints } from '../canonical-json';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  type Chat,
  type Compaction,
  type Message,
  type ModelToolDeclaration,
  type Run,
  type RunContextItem,
  type RunStatus,
  type SkillCatalogBaseline,
  type TurnToolAvailabilityEntry,
} from '../db/schema';
import {
  buildContext,
  partsToText,
  type BuiltContext,
  type MessagePart,
} from '../chats/context-builder';
import {
  type PromptUserInput,
  type SystemModelCatalogEntry,
} from '../models/model-catalog';
import { type ModelClient } from '../models/model-client';
import { ModelStreamIdleError } from '../models/stream-idle-watchdog';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
  findLiveWindow,
  isCompletedAssistantTurn,
} from '../chats/chats-repository';
import {
  CompactionService,
  toStoredMessages,
  type CompactionCapability,
  type CompactionSummary,
} from '../compaction/compaction.service';
import {
  countedContextTokens,
  estimateContinuationTokens,
  estimateModelRequestTokens,
  planCompactionCheckpoint,
  requestFitsContextWindow,
  resolveCompactionThreshold,
  type CompactionPlan,
} from '../compaction/compaction';
import { SearchIndexService } from '../search/search-index.service';
import {
  ChatSearchQueryEmbedder,
  type QueryEmbedderPort,
} from '../search/chat-search-query-embedder';
import {
  SearchEmbedDispatchService,
  type ChatEmbedDispatcher,
} from '../search/search-embed-dispatch.service';
import {
  SearchReindexDispatchService,
  type ChatReindexDispatcher,
} from '../search/search-reindex-dispatch.service';
import {
  createWorkspaceDetachNoticeItem,
  createWorkspaceSnapshotItem,
  createModelChangeItem,
  createRecencyDigestDeltaItem,
  createRecencyDigestSupersessionItem,
  createToolAvailabilityItem,
  createTemporalItem,
  deriveToolAvailabilityPayload,
  deriveToolAvailabilityPayloadFromStates,
} from '../chats/context-item-producers';
import {
  CONTEXT_ITEM_PRODUCERS,
  isContextItemPart,
  resolveForm,
  type AuthoredContextItemPart,
} from '../chats/context-item';
import { neutralizeToolResult } from '../chats/tool-observation-part';
import { createDeltaBuffer } from './delta-buffer';
import {
  MAX_ADDRESS_DECISIONS,
  MAX_DERIVED_DECISIONS,
  createAssistantPartCollector,
  reconstructDurableAssistant,
  toolActivityPart,
  withoutContextItems,
} from './assistant-transcript';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { type ProductIdentityReader } from '../instance-config/product-identity';
import { resolveConfigPath } from '../instance-config/config-loader';
import {
  createToolPromptRenderer,
  type ToolPromptRenderer,
} from '../instance-config/prompt-loader';
import {
  BASH_SETTLEMENT_GRACE_MS,
  invalidCallResult,
  refusalResult,
  runTool,
} from '../tools/runner';
import { toFlexibleSchema } from '../tools/schema-utils';
import {
  AttemptToolAdditions,
  type AttemptToolBinding,
} from '../tools/attempt-tool-additions';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { TOOL_PERMISSION_POLICY } from '../tools/permissions/permission-policy.module';
import {
  type CompiledPolicy,
  type PermissionDecision,
} from '../tools/permissions/types';
import {
  type DerivedDecision,
  type DerivedDecisionRecord,
} from '../tools/web-read/admission';
import {
  ORIGIN_INSTRUCTIONS,
  ORIGIN_SKILL_ACTIVATION,
  type ToolActivityOrigin,
} from './tool-activity-origin';
import { activateSkills } from '../skills/skill-activation';
import { parseSkillMentions } from '../skills/skill-mention';
import { ActivationPartsRepository } from '../chats/activation-parts.repository';
import { nativeReadTool } from '../tools/native-files';
import {
  type KnowledgeToolResolver,
  type Tool,
  type ToolContext,
  type ToolResult,
} from '../tools/types';
import { createKnowledgeInstructionProbe } from '../knowledge/knowledge-instruction-probe';
import { KnowledgeToolRuntimeResolver } from '../knowledge/knowledge-tool-runtime-resolver';
import { SkillCatalog, type SkillCatalogPort } from '../skills/skill-catalog';
import {
  toolTerminationMessage,
  toolTerminationResult,
} from './tool-settlement';
import {
  RunEventsRepository,
  RunsRepository,
  type RunEventType,
} from './runs-repository';
import {
  IN_RUN_CONTEXT_PRODUCER,
  createInRunContextItems,
  type InRunAttemptProducer,
  type InRunContextProducer,
} from './in-run-context-items';
import type { ReadPage } from '../instructions/instruction-files';
import { instructionsSeenPaths } from '../chats/instructions-item';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';
import { TitleService, type TitleCapability } from '../titles/title.service';
import {
  aggregateTurnTelemetry,
  emitCompletedTurnTelemetryLog,
  turnTelemetryLogger,
  type TurnTelemetry,
} from '../chats/turn-telemetry';
import {
  ContextIncompatibleError,
  DYNAMIC_TOOL_EXECUTOR_RESOLVER,
  type BoundExecutableTool,
  type DynamicToolExecutorResolver,
  ModelContextExecutionError,
  constrainDynamicToolResolver,
  resolveBoundExecutableTools,
} from './snapshot-tool-execution';
import {
  composeAttemptToolCatalog,
  finalizeEffectiveContext,
  type AttemptToolCatalog,
  type SystemPromptReceiptInput,
} from './effective-context-resolver';
import {
  SystemPromptsService,
  type SystemPromptRenderInput,
} from '../system-prompts/system-prompts.service';
import {
  PersonalizationService,
  type PromptUserResolver,
} from '../personalization/personalization.service';
import {
  ModelsService,
  type ModelSelectionValidator,
} from '../models/models.service';
import {
  KnowledgeToolCandidateResolver,
  type KnowledgeToolCandidateResolverPort,
} from '../knowledge/knowledge-tool-candidate-resolver';
import { McpRuntimeService } from '../mcp/mcp-runtime.service';
import {
  WorkspaceMcpClients,
  type WorkspaceMcpKey,
} from '../mcp/workspace-mcp-clients';
import { ToolDescriptionRenderError } from '../tools/turn-tool-catalog';
import {
  MemoryService,
  type MemorySettingsBindingResolver,
  type ResolvedMemorySettings,
} from '../memory/memory.service';
import {
  RecencyDigestService,
  deriveRecencyDigestDelta,
  type RecencyDigestDelta,
  type RecencyDigestResolution,
  type RecencyDigestResolver,
} from '../chats/recency-digest.service';
import { isToolPromptId } from '../prompts/tool-descriptions';
import {
  resolveTurnSkillState,
  type SkillTurnState,
} from '../chats/skill-turn-state';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import {
  isWorkspaceDetachReason,
  type WorkspaceDetachReason,
} from '../chats/workspace-binding';
import {
  createWorkspaceRootCell,
  type WorkspaceRootCell,
} from '../tools/workspace-path';
import { workspaceSkillSources } from '../skills/workspace-skill-sources';
import { evaluatePermission } from '../tools/permissions/evaluator';
import {
  formatTemporalAnchor,
  resolveInstanceTimezone,
  type TemporalAnchor,
} from '../prompts/temporal-anchor';
type AssistantTurnTelemetry = TurnTelemetry & {
  runId: string;
  complete?: boolean;
};

type AssistantTurnPersistence = {
  chatId: string;
  inReplyTo: string;
  parts: Array<MessagePart>;
  telemetry?: AssistantTurnTelemetry;
};

type AssistantTurnWrite = AssistantTurnPersistence & {
  telemetry: AssistantTurnTelemetry;
};

type SkillCatalogFreeze = NonNullable<SkillTurnState['freeze']>;

/**
 * The skill-catalog writes a turn establishes, applied by the terminal
 * transaction of the attempt that completes it: the baseline to freeze when the
 * turn starts an epoch, and the names it leaves the chat told about. Both are
 * optional because most turns establish neither.
 */
type SkillCatalogWrites = {
  readonly freeze?: SkillCatalogFreeze;
  readonly told?: NonNullable<Chat['skillCatalogTold']>;
};
type WorkspaceWrites = {
  readonly told: Chat['workspaceTold'];
  readonly toldFrom: Chat['workspaceToldFrom'];
  readonly clearDetachReason: boolean;
};
type WorkspacePreparation = {
  readonly root: string | undefined;
  readonly chat: Chat | undefined;
};

type WorkspaceStagedContext = {
  readonly parts: Array<MessagePart>;
  readonly writes?: WorkspaceWrites;
};

/**
 * The accepted-turn instructions load: what the turn's binding could stage
 * before its first request, plus the read identity every later system read of
 * the same Run reuses. `part` and `seenCanonicalPaths` are replaced whenever
 * the effective request history is rebuilt.
 */
type TurnInstructions = {
  /** The bound root the accepted-turn trigger loads; undefined without one. */
  readonly root: string | undefined;
  /** The turn's audited page reader; undefined when the `read` gate bars it. */
  readonly readPage: ReadPage | undefined;
  /** Allocates the attempt-scoped tool-call id of one audited read. */
  readonly nextToolCallId: () => string;
  part: AuthoredContextItemPart | undefined;
  seenCanonicalPaths: ReadonlySet<string>;
};

/** Context resolved inside the worker transaction before the model request. */
type PreparedAttemptContext = BuiltContext & {
  /** Receipt-only data persisted before target-model I/O. */
  effectiveContext: SystemPromptReceiptInput;
  /** The bound model catalog entry this pass resolved and rendered for. */
  model: SystemModelCatalogEntry;
  toolCatalog: AttemptToolCatalog;
  stagedParts: Array<MessagePart>;
  /** The stored rows this request was built from; the trigger plans on them. */
  historyRows: Array<Message>;
  /**
   * The active checkpoint for this attempt — always the latest one whose
   * absorbed-through sequence is below the triggering user message's, so the
   * prompt anchor, the skill and workspace epochs, and the history cut all read
   * one boundary.
   */
  latestCompaction: Compaction | undefined;
  /** Canonical instruction paths the effective history already discloses. */
  seenInstructionPaths: ReadonlySet<string>;
  recencyDigestInitialization?: RecencyDigestInitialization;
  recencyDigestTold?: NonNullable<Chat['recencyDigestTold']>;
  /** The skill-catalog writes this turn establishes; see `SkillCatalogWrites`. */
  skillCatalogWrites: SkillCatalogWrites;
  workspaceWrites?: WorkspaceWrites;
  untitled: boolean;
};
type CompactionTriggerInput = {
  run: ExecuteRunInput;
  prepared: PreparedExecutionContext;
  stagedParts: ReadonlyArray<MessagePart>;
  historyRows: ReadonlyArray<Message>;
  boundarySeq: number;
};

/**
 * Everything the Run sends on its first model step (design D5): the request the
 * attempt actually dispatches, its prepared context, and the turn instructions
 * that complete it.
 */
type PreparedFirstStep = {
  readonly request: {
    readonly prepared: PreparedExecutionContext;
    readonly contextItems: Array<RunContextItem>;
  };
  readonly context: PreparedAttemptContext;
  readonly turnInstructions: TurnInstructions;
};
type AttemptDigestContext = {
  shareRecentChats: ResolvedMemorySettings;
  promptDigestBaseline: Chat['recencyDigestBaseline'];
  recencyDigestInitialization?: RecencyDigestInitialization;
  digestDelta: RecencyDigestDelta | null;
};

type AttemptPromptInputs = AttemptDigestContext & {
  chat: Chat;
  model: SystemModelCatalogEntry;
  user: PromptUserInput | undefined;
  compaction: Compaction | undefined;
  instanceTimezone: string;
  anchor: TemporalAnchor;
  /** This turn's skill-catalog decision: the rendered baseline and the notice. */
  skillState: SkillTurnState;
};

type AttemptPromptContext = AttemptPromptInputs & {
  systemPrompt: string;
};

type AttemptStagedContext = {
  stagedParts: Array<MessagePart>;
  recencyDigestTold?: NonNullable<Chat['recencyDigestTold']>;
  skillCatalogTold?: NonNullable<Chat['skillCatalogTold']>;
  workspaceWrites?: WorkspaceWrites;
};

type FinishRunInput = {
  userId: string;
  runId: string;
  status: TerminalRunStatus;
  attemptId?: string;
  modelCompleted?: {
    usage?: unknown;
    finishReason: unknown;
    telemetry?: AssistantTurnTelemetry;
  };
  runPayload?: unknown;
  error?: unknown;
  assistantTurn?: AssistantTurnWrite;
  synthesizedTurnTelemetry?: AssistantTurnTelemetry;
  attemptContextParts?: ReadonlyArray<MessagePart>;
  /**
   * The completed Run's rail record: the dispatched request's items followed
   * by the attempt's in-Run items in emission order. Supplied only for a
   * completed outcome, because only a completed attempt publishes an in-Run
   * item; every other settlement keeps whatever the pre-dispatch write
   * recorded.
   */
  runContextItems?: Array<RunContextItem>;
  recencyDigestInitialization?: RecencyDigestInitialization;
  recencyDigestTold?: NonNullable<Chat['recencyDigestTold']>;
  skillCatalogWrites?: SkillCatalogWrites;
  workspaceWrites?: WorkspaceWrites;
  turnToolAvailability?: Array<TurnToolAvailabilityEntry>;
};

type FinishRunResult =
  | { outcome: 'won' | 'errored'; assistantMessage?: Message }
  | { outcome: 'lost'; finalStatus?: string; assistantMessage?: Message };

/** The assembled context+tools an execution attempt runs against. */
type PreparedExecutionContext = {
  system: string;
  messages: BuiltContext['messages'];
  untitled: boolean;
  toolDeclarations: Array<ModelToolDeclaration>;
  tools: Array<BoundExecutableTool>;
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

/** Adapter locator decisions have their own cap and cannot crowd out hops or probes. */
const MAX_ADAPTER_DECISIONS = 16;
/**
 * AbortSignal.abort(reason) tag for the worker's own in-process wall-clock
 * timeout (design D7 mechanism 1). Both a timeout and a user-requested cancel
 * (RunAbortRegistry.abort(), no reason) share the same AbortController/signal
 * plumbing — this is how classifyAbortedRun tells them apart so only a
 * timeout is recorded as run.expired, never run.cancelled.
 */
export const RUN_TIMEOUT_ABORT_REASON = 'run-timeout';
/**
 * AbortSignal.abort(reason) tag for the worker's execution ceiling — the
 * substrate bound a run reaches when no budget is configured. It settles as
 * `expired` exactly like a budget overrun, but its message names the ceiling,
 * never a budget the operator did not configure.
 */
export const RUN_CEILING_ABORT_REASON = 'run-ceiling';
export const NATIVE_MUTATION_ABORT_REASON = 'native-mutation-unknown';

/**
 * The terminal message for an expired run, chosen from the abort REASON
 * rather than the status: both reasons settle as run.expired, but only a
 * configured budget may be named in the message.
 */
function expiredRunMessage(signal: AbortSignal | undefined): string {
  return signal?.reason === RUN_CEILING_ABORT_REASON
    ? 'Run reached the 23 h 55 m execution ceiling.'
    : 'Run timed out: exceeded its wall-clock budget.';
}

/**
 * Classify an aborted run's terminal status from the signal that aborted it:
 * a worker-side wall-clock timeout is run.expired; any other abort (a user
 * cancel, a superseding retry) is run.cancelled. Exported standalone — pure
 * and DB-free — so the tagging is unit-testable without the full executeRun
 * path.
 */
export function classifyAbortedRun(
  signal: AbortSignal | undefined,
): 'cancelled' | 'expired' | 'failed' {
  if (signal?.reason === NATIVE_MUTATION_ABORT_REASON) return 'failed';
  return signal?.reason === RUN_TIMEOUT_ABORT_REASON ||
    signal?.reason === RUN_CEILING_ABORT_REASON
    ? 'expired'
    : 'cancelled';
}
/**
 * Resolve the permission mode accepted on a Run against the modes available
 * to the worker. Kept standalone so the worker's frozen mode decision can be
 * unit-tested without constructing the full execution service.
 */
export function resolveEffectivePermissionMode(
  accepted: PermissionMode,
  workerModes: ReadonlyArray<PermissionMode>,
): PermissionMode {
  return accepted === 'bypass' && workerModes.includes('bypass')
    ? 'bypass'
    : 'default';
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

function turnStatusForTerminalRun(
  status: TerminalRunStatus,
): TurnTelemetry['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'error';
  return 'aborted';
}

type RecencyDigestInitialization = {
  baseline: NonNullable<Chat['recencyDigestBaseline']>;
  told: NonNullable<Chat['recencyDigestTold']>;
};

function toRunContextItems(
  parts: ReadonlyArray<MessagePart>,
): Array<RunContextItem> {
  return parts.flatMap((part) => {
    if (!isContextItemPart(part)) return [];
    const form = resolveForm(part);
    return [
      {
        producer: part.data.producer,
        ...(form !== undefined && { form }),
        residency: 'rail' as const,
        text: part.data.text ?? '',
      },
    ];
  });
}

function toTurnToolAvailability(
  manifest: AttemptToolCatalog['availabilityManifest'],
): Array<TurnToolAvailabilityEntry> {
  return [...manifest.entries]
    .map(({ id, state }) => ({ id, state }))
    .sort((left, right) => compareCodePoints(left.id, right.id));
}

/**
 * Places a staged instructions item at its rail position: directly after every
 * item whose producer precedes it — the workspace snapshot is the last of
 * those — and before the notices that follow (design D10).
 */
function placeInstructionsPart(
  parts: Array<MessagePart>,
  part: AuthoredContextItemPart | undefined,
): void {
  if (part === undefined) return;
  const rank = CONTEXT_ITEM_PRODUCERS.indexOf('instructions');
  const index = parts.findLastIndex(
    (staged) =>
      isContextItemPart(staged) &&
      CONTEXT_ITEM_PRODUCERS.findIndex(
        (known) => known === staged.data.producer,
      ) < rank,
  );
  parts.splice(index + 1, 0, part);
}

/** A durably recorded tool request, with safe decision metadata once admitted. */
type ToolRequestedEventPayload = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  permission?: PermissionDecision;
  /** Absent means model-origin; see tool-activity-origin.ts. */
  origin?: ToolActivityOrigin;
};

/** A durably recorded tool completion, carrying the decision for history. */
type ToolCompletedEventPayload = {
  toolCallId: string;
  toolName: string;
  status: ToolResult['status'];
  output: ToolResult;
  permission?: PermissionDecision;
  /**
   * The decisions this call's derived locators (redirect hops, announced
   * alternates, suffix and `llms.txt` candidates) received before their
   * requests, each with the kind of locator it judged. Recorded here rather
   * than on the request, because they are not known until the executor has
   * run; owner-scoped like `permission`, and never part of the model-visible
   * result.
   */
  derivedDecisions?: ReadonlyArray<DerivedDecisionRecord>;
  /** Mirrors the request's origin, so recovery needs no second lookup. */
  origin?: ToolActivityOrigin;
};

/**
 * RunExecutionService (#48/#50, SPEC §9.5) — executes one run: context
 * assembly, the model call, and every durable side effect (assistant turn,
 * run lifecycle + model.delta events, pre-step checkpointing and titling).
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

/**
 * The injected instance configuration, plus the boot-time product identity
 * when the value is the real service. A test double that carries only
 * `config` leaves the identity unset, and a web read fails closed rather
 * than issuing a request with no `User-Agent`.
 */
type InstanceConfigWithIdentity = InstanceConfigReader &
  Partial<ProductIdentityReader>;

@Injectable()
export class RunExecutionService {
  private readonly logger = new Logger(RunExecutionService.name);
  private readonly toolPromptRenderer: ToolPromptRenderer;

  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(CompactionService)
    private readonly compaction: CompactionCapability,
    @Inject(TitleService)
    private readonly titles: TitleCapability,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigWithIdentity,
    @Inject(SearchIndexService)
    private readonly searchIndex: ChatSearchIndexer,
    @Inject(SearchReindexDispatchService)
    private readonly reindexDispatch: ChatReindexDispatcher,
    @Inject(KnowledgeToolRuntimeResolver)
    private readonly knowledgeResolver: KnowledgeToolResolver,
    @Inject(SkillCatalog)
    private readonly skillCatalog: SkillCatalogPort,
    @Inject(SearchEmbedDispatchService)
    private readonly embedDispatch: ChatEmbedDispatcher,
    @Inject(ChatSearchQueryEmbedder)
    private readonly queryEmbedder: QueryEmbedderPort,
    @Inject(TOOL_PERMISSION_POLICY)
    private readonly permissionPolicy: CompiledPolicy,
    // --- Worker-owned prompt/catalog resolution dependencies ---
    @Inject(ModelsService)
    private readonly models: ModelSelectionValidator,
    private readonly systemPrompts: SystemPromptsService,
    @Inject(PersonalizationService)
    private readonly personalization: PromptUserResolver,
    @Inject(KnowledgeToolCandidateResolver)
    private readonly knowledgeCandidates: KnowledgeToolCandidateResolverPort,
    @Inject(McpRuntimeService)
    private readonly mcpRuntime: Pick<McpRuntimeService, 'snapshotCandidates'>,
    @Inject(MemoryService)
    private readonly memory: MemorySettingsBindingResolver,
    @Inject(RecencyDigestService)
    private readonly recencyDigest: RecencyDigestResolver,
    @Optional()
    @Inject(DYNAMIC_TOOL_EXECUTOR_RESOLVER)
    private readonly dynamicToolResolver?: DynamicToolExecutorResolver,
    @Optional()
    @Inject(WorkspaceMcpClients)
    private readonly workspaceMcp?: WorkspaceMcpClients,
    // Producer that authors context items between model steps; none is
    // required for a Run to execute.
    @Optional()
    @Inject(IN_RUN_CONTEXT_PRODUCER)
    private readonly inRunProducer?: InRunContextProducer,
  ) {
    this.toolPromptRenderer = createToolPromptRenderer({
      configPath: this.instanceConfig.configPath ?? resolveConfigPath(),
      instancePromptFiles: this.instanceConfig.config.tools.promptFiles,
      models: this.instanceConfig.config.models,
    });
  }

  /**
   * Terminalize work that can outlive its executor (notably retry exhaustion)
   * through the same durable settlement transaction as executor callbacks.
   * Throws when that transaction cannot commit so callers never acknowledge
   * queue work whose terminal state is not durable.
   *
   * Every caller settles a NON-completed status (retry exhaustion expires,
   * pre-start cancellation cancels), and the live collector is the only
   * carrier of an attempt's in-Run context item: a settlement after a worker
   * restart therefore publishes no in-Run part (design D1).
   */
  async settleTerminalRun(input: {
    userId: string;
    runId: string;
    status: TerminalRunStatus;
    /** Fence the terminal write by this attempt when one is known. */
    attemptId?: string;
    runPayload?: unknown;
    error?: unknown;
    telemetry?: AssistantTurnTelemetry;
  }) {
    const { telemetry, ...terminalInput } = input;
    const settlement = await this.finishRun({
      ...terminalInput,
      ...(telemetry !== undefined && {
        modelCompleted: {
          finishReason: telemetry.finishReason,
          telemetry,
        },
      }),
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
    request: ExecuteRunInput,
  ): Promise<ReturnType<ModelClient['streamText']>> {
    const nativeAbort = this.instanceConfig.config.tools.nativeExecutorId
      ? new AbortController()
      : undefined;
    const input = nativeAbort
      ? {
          ...request,
          abortSignal: request.abortSignal
            ? AbortSignal.any([request.abortSignal, nativeAbort.signal])
            : nativeAbort.signal,
        }
      : request;
    const { client } = input;

    // Claim before any context preparation can invoke a model. Pre-step
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
          {
            error: {
              message: this.abortedRunMessage(status, input.abortSignal),
            },
          },
        );
        if (finished) {
          await events.append(input.runId, `run.${status}`, {
            message: this.abortedRunMessage(status, input.abortSignal),
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
              message: this.abortedRunMessage('cancelled', input.abortSignal),
            });
          }
        }
        return false;
      }

      if (await new NativeFilesRepository(tx).hasMutation(input.runId)) {
        return {
          nativeRecovery: true as const,
          attemptId: started.activeAttemptId!,
        };
      }

      // The claim returns the persisted effort rather than setting an outer
      // variable: it is read inside the transaction (the run row is the single
      // source of truth for what this run executes at, not the queue payload)
      // and can only be reached on the path that actually claimed the run.
      // Deliberately never re-resolved or re-validated against current
      // configuration — a level the operator has since withdrawn is still sent
      // verbatim, and a run that stored none sends no provider option at all.
      const startedEvent = await events.append(input.runId, 'run.started');
      return {
        effort: started.effort ?? undefined,
        permissionMode: started.permissionMode,
        attemptId: started.activeAttemptId!,
        nativeDeliverySequence: startedEvent.sequence,
      };
    });
    if (!claim) {
      throw new RunNotRunnableError(input.runId);
    }
    if ('nativeRecovery' in claim) {
      const message =
        'A previous host command, file mutation, or MCP dispatch may have executed. This Run will not replay it.';
      await this.settleTerminalRun({
        userId: input.userId,
        runId: input.runId,
        status: 'failed',
        attemptId: claim.attemptId,
        error: { code: 'outcome_unknown', message },
        runPayload: { code: 'outcome_unknown', message },
      });
      throw new RunNotRunnableError(input.runId);
    }
    const { effort, permissionMode, attemptId } = claim;
    const effectivePermissionMode =
      this.resolveEffectivePermissionMode(permissionMode);
    if (input.abortSignal?.aborted) {
      await this.settleAbortedRun(input, attemptId);
    }

    // Workspace validation is the first accepted-turn preparation step. Load
    // the owner-scoped Chat row once here and derive the binding from it; pass
    // that same row into prompt preparation instead of issuing another read.
    const workspaceChat = await this.tenantDb.runAs(input.userId, (tx) =>
      new ChatsRepository(tx).findById(input.chatId, input.userId),
    );
    const workspacePreparation = await this.prepareWorkspace(
      input,
      claim.nativeDeliverySequence,
      workspaceChat,
      effectivePermissionMode,
    );
    const workspaceRoot = createWorkspaceRootCell(workspacePreparation.root);
    const workspaceMcpKey = this.workspaceMcpKey(workspacePreparation);
    await this.startWorkspaceMcp(input.chatId, workspaceMcpKey);
    const attemptDynamicResolver = this.attemptDynamicResolver(workspaceMcpKey);

    // Explicit `$skill` activation runs BEFORE context assembly, because the
    // instructions it loads are part of the request the model receives on its
    // first step — not a tool result it reacts to afterwards. It persists its
    // items onto the triggering user message, so the assembly below reads them
    // back through the ordinary path and recovery replays the stored text.
    const skillSelection = await this.activateMentionedSkills(
      input,
      claim.nativeDeliverySequence,
      workspaceRoot,
      effectivePermissionMode,
    );
    // Prompt/catalog resolution, the single pre-step compaction trigger, and the
    // request this Run actually sends (design D4/D5): both prompt surfaces come
    // from the current owner state, admitted catalog, and boot-loaded
    // templates, and the receipt binds last, after any checkpoint published.
    let prepared: PreparedExecutionContext;
    let attemptStagedParts: Array<MessagePart>;
    // The request's rail record as dispatched, kept for the completed
    // outcome's finish-time write (extended there with the in-Run items).
    let attemptContextItems: Array<RunContextItem>;
    let attemptRecencyDigestTold:
      | NonNullable<Chat['recencyDigestTold']>
      | undefined;
    let attemptRecencyDigestInitialization:
      | RecencyDigestInitialization
      | undefined;
    let attemptSkillCatalogWrites: SkillCatalogWrites | undefined;
    let attemptWorkspaceWrites: WorkspaceWrites | undefined;
    let attemptToolAvailability: Array<TurnToolAvailabilityEntry>;
    let turnInstructions: TurnInstructions;
    try {
      const firstStep = await this.prepareAttemptForFirstStep({
        run: input,
        attemptId,
        workspacePreparation,
        workspaceMcpKey,
        dynamicResolver: attemptDynamicResolver,
        effectivePermissionMode,
        nativeDeliverySequence: claim.nativeDeliverySequence,
        workspaceRootCell: workspaceRoot,
        effort,
      });
      prepared = firstStep.request.prepared;
      attemptContextItems = firstStep.request.contextItems;
      attemptStagedParts = firstStep.context.stagedParts;
      attemptRecencyDigestTold = firstStep.context.recencyDigestTold;
      attemptRecencyDigestInitialization =
        firstStep.context.recencyDigestInitialization;
      attemptSkillCatalogWrites = firstStep.context.skillCatalogWrites;
      attemptWorkspaceWrites = firstStep.context.workspaceWrites;
      attemptToolAvailability = toTurnToolAvailability(
        firstStep.context.toolCatalog.availabilityManifest,
      );
      turnInstructions = firstStep.turnInstructions;
      // Recorded only once the request is final: a preparation failure means no
      // request was ever made, and recording earlier would durably assert a
      // request the model never received. Fenced by activeAttemptId.
      const recorded = await this.tenantDb.runAs(input.userId, (tx) =>
        new RunsRepository(tx).updateForAttempt(
          input.runId,
          input.userId,
          attemptId,
          { contextItems: attemptContextItems },
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
        await this.settleAbortedRun(input, attemptId);
      }
      if (error instanceof ModelContextExecutionError) {
        const message = error.message;
        // Fenced by the claim: the failure that ends preparation may BE the
        // reclaim (`persistAttemptPromptReceipt` refuses a stale attempt), and
        // an unfenced write here would let that stale attempt mark a run
        // another attempt is actively executing as failed.
        await this.finishRun({
          userId: input.userId,
          runId: input.runId,
          status: 'failed',
          attemptId,
          runPayload: { status: 'failed', message, code: error.code },
          error: { message, code: error.code },
        });
      }
      throw error;
    }
    const { system, messages, untitled, tools: executableTools } = prepared;
    const boundExecutables = new Map<string, AttemptToolBinding>(
      executableTools.map(({ declaration, executor, server }) => [
        declaration.id,
        {
          declaration,
          executor,
          ...(server !== undefined && { server, available: true }),
        },
      ]),
    );

    if (input.abortSignal?.aborted) {
      await this.settleAbortedRun(input, attemptId);
    }

    const streamStartedAt = Date.now();
    const requestUsageReceipts: Array<LanguageModelUsage> = [];
    const buildAssistantTelemetry = (
      finishReason: TurnTelemetry['finishReason'],
      status: TurnTelemetry['status'],
      stepCount?: number,
    ): AssistantTurnTelemetry => ({
      ...aggregateTurnTelemetry({
        receipts: requestUsageReceipts,
        finishReason,
        status,
        modelId: client.model,
        effort,
        permissionMode: effectivePermissionMode,
        latencyMs: Date.now() - streamStartedAt,
        price: client.pricing,
        billing: client.billing,
        stepCount,
      }),
      runId: input.runId,
    });

    // `model.requested` describes the target inference, not the summary
    // inference that may have preceded it. Record it only after preparation
    // succeeds and immediately before the target call.
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
    // In-Run rail items for this attempt: staged at step boundaries, spliced
    // into every later step by the model client's step callback, and published
    // only with a completed turn (design D1).
    const inRunItems = createInRunContextItems();
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
    // collected (assistantPartCollector) and persisted as `reasoning` parts in
    // occurrence order, so thinking survives a reload — but `partsToText`
    // strips reasoning, so it is still NEVER re-fed to the model.
    //
    // Accumulated from EACH onReasoningDelta chunk (not the SDK's
    // onFinish.reasoningText, which is only the FINAL step's reasoning and would
    // silently drop step-1 thinking on a multi-step tool turn — master has no
    // tool loop today, so every turn is one step, but the accumulation is
    // correct regardless of step count and matches the persistence branch).
    //
    // Each buffered `reasoning.delta` event carries the adapter part id of the
    // text it holds, so the durable reconstructor can rebuild the same part
    // boundaries the live collector saw (design D8). The buffer is drained
    // before the id is switched, so one event never spans two ids.
    //
    // A reasoning part's opaque provider metadata (design D15) is recorded on
    // its own `reasoning.delta` event: a wire attaches it to a part's start, to
    // an empty delta (the withheld block's signature), or to the part's END, so
    // there is nothing to buffer — only the part id the metadata is bound to,
    // and — for a part that delivery starts (D18) — the text it must land
    // behind.
    const reasoningDeltas = createDeltaBuffer();
    let reasoningPartId: string | undefined;
    const persistReasoning = (text: string | null) => {
      if (text !== null) {
        enqueueEvent('reasoning.delta', {
          text,
          ...(reasoningPartId !== undefined && { partId: reasoningPartId }),
        });
      }
    };
    const persistReasoningMetadata = (
      partId: string | undefined,
      providerMetadata: ProviderMetadata,
    ) => {
      enqueueEvent('reasoning.delta', {
        ...(partId !== undefined && { partId }),
        providerMetadata,
      });
    };

    // Trusted execution context for tools — built from the RUN's fields,
    // NEVER from model input, so a tool's data scope can't be widened by the
    // model (authorization identity from a trusted source only). Matches
    // ToolContext (tools/types.ts) exactly.
    const toolContext: ToolContext = {
      runId: input.runId,
      nativeExecutorId: this.instanceConfig.config.tools.nativeExecutorId,
      nativeDeliverySequence: claim.nativeDeliverySequence,
      onNativeMutationUnknown: () =>
        nativeAbort?.abort(NATIVE_MUTATION_ABORT_REASON),
      productUserAgent: this.instanceConfig.productUserAgent,
      userId: input.userId,
      chatId: input.chatId,
      workspaceRoot,
      workspaceMcp: this.workspaceMcp,
      tenantDb: this.tenantDb,
      abortSignal: input.abortSignal,
      knowledgeResolver: this.knowledgeResolver,
      skillCatalog: this.skillCatalog,
      // A manual-only skill the user named stays readable for this Run's tool
      // calls, references and scripts included; a turn that did not name it
      // carries an empty set and refuses again.
      skillSelection,
      queryEmbedder: this.queryEmbedder,
      permissionPolicy: this.permissionPolicy,
      webAdapters: this.instanceConfig.config.tools.webAdapters,
      permissionMode: effectivePermissionMode,
    };
    const { maxStepsPerRun, callTimeoutSeconds } =
      this.instanceConfig.config.tools;

    // The step cap actually reached, or `null` when no cap is configured (the
    // opt-in default) or none was reached — the value both cap reporting paths
    // publish, so neither can ever name a cap the operator did not set.
    let cappedAt: number | null = null;

    // Tool activity accumulated in occurrence order, for persistence on the
    // assistant message (design D5) — both genuinely-executed calls and
    // gate-refused/hallucinated calls push here, so both render through the
    // exact same ToolCallPart component web-side.

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
      {
        toolName: string;
        toolInput: unknown;
        permission?: PermissionDecision;
        /** Derived-locator decisions, collected while the executor runs. */
        derivedDecisions?: Array<DerivedDecisionRecord>;
        /** Absent means model-origin (tool-activity-origin.ts). */
        origin?: ToolActivityOrigin;
      }
    >();
    // Reserve the persisted part and the open-call entry at request time (before
    // admission), so part order stays correct even if the call is later
    // rejected and settled by the completion path.
    // System-origin calls (skill activation) are recorded durably but are NOT
    // assistant activity: they take no collector slot, so no tool part is
    // persisted and no fabricated call enters the transcript the UI replays.
    // The origin rides on the payload, so recovery on another worker reaches
    // the same conclusion.
    const reserveToolRequest = (
      toolCallId: string,
      toolName: string,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- the AI SDK's own inputSchema validation (`toFlexibleSchema`, wired into `tool({...})` below) already ran before this callback fires; `toolInput` here is that already-admitted, per-tool-schema-shaped value forwarded for durable recording.
      toolInput: unknown,
      origin?: ToolActivityOrigin,
    ) => {
      openToolCalls.set(toolCallId, { toolName, toolInput, origin });
      if (origin === undefined)
        assistantPartCollector.toolRequested(toolCallId);
    };
    // Emit `tool.requested` with the trusted decision once admission resolves.
    // Its durable write is awaited before `tool.started`, so a rejection never
    // produces a false start and an allowed call cannot dispatch first.
    const emitToolRequested = (
      toolCallId: string,
      toolName: string,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- same rationale as `reserveToolRequest` above.
      toolInput: unknown,
      permission: PermissionDecision | undefined,
      origin?: ToolActivityOrigin,
    ) => {
      const payload: ToolRequestedEventPayload = {
        toolCallId,
        toolName,
        input: toolInput,
      };
      if (permission !== undefined) payload.permission = permission;
      if (origin !== undefined) payload.origin = origin;
      enqueueEvent('tool.requested', payload);
    };
    // Ids whose outcome has already been durably recorded. At-most-once per
    // call across BOTH the event log and the persisted part — the collector
    // has its own guard, but without this one enqueueEvent fires a second
    // tool.completed for a call the collector correctly ignored.
    const settledToolCallIds = new Set<string>();
    // A derived-locator decision (a hop, probe candidate, adapter target, or
    // refused address) reaches run execution through the tool context while
    // the executor runs — after `tool.requested` is already durable — so it
    // is collected on the open call and recorded at settlement. A call that
    // never settles loses its records with its result. Address and adapter
    // refusals have their own bounds and cannot displace hop or probe records.
    const recordDerivedDecision = (
      toolCallId: string,
      decision: DerivedDecision,
    ): void => {
      const open = openToolCalls.get(toolCallId);
      if (open === undefined) return;
      const decisions = (open.derivedDecisions ??= []);
      const isAddress = decision.kind === 'address';
      const isAdapter = decision.kind === 'adapter';
      let recordedCount = 0;
      for (const recorded of decisions) {
        const sameAddress = isAddress && recorded.kind === 'address';
        const sameAdapter = isAdapter && recorded.kind === 'adapter';
        const sameGeneric =
          !isAddress &&
          !isAdapter &&
          recorded.kind !== 'address' &&
          recorded.kind !== 'adapter';
        if (sameAddress || sameAdapter || sameGeneric) recordedCount += 1;
      }
      const limit = isAddress
        ? MAX_ADDRESS_DECISIONS
        : isAdapter
          ? MAX_ADAPTER_DECISIONS
          : MAX_DERIVED_DECISIONS;
      if (recordedCount >= limit) return;
      decisions.push({ ...decision.decision, kind: decision.kind });
    };
    const recordToolCompleted = (
      toolCallId: string,
      toolName: string,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- same rationale as `reserveToolRequest` above: the AI SDK's inputSchema validation already ran before this value ever reaches either function.
      toolInput: unknown,
      result: ToolResult,
    ) => {
      if (settledToolCallIds.has(toolCallId)) {
        return;
      }
      settledToolCallIds.add(toolCallId);
      const open = openToolCalls.get(toolCallId);
      const permission = open?.permission;
      const derivedDecisions = open?.derivedDecisions;
      openToolCalls.delete(toolCallId);
      const payload: ToolCompletedEventPayload = {
        toolCallId,
        toolName,
        status: result.status,
        output: result,
      };
      if (permission !== undefined) payload.permission = permission;
      if (derivedDecisions !== undefined && derivedDecisions.length > 0) {
        payload.derivedDecisions = derivedDecisions;
      }
      if (open?.origin !== undefined) payload.origin = open.origin;
      enqueueEvent('tool.completed', payload);
      // A system-origin call is durable audit, not assistant activity.
      if (open?.origin !== undefined) return;
      assistantPartCollector.tool(
        toolActivityPart({
          toolCallId,
          toolName,
          input: toolInput,
          result,
          permission,
          derivedDecisions,
        }),
      );
    };

    /**
     * Settle selected still-open tool calls when the run terminates (#293).
     * Runs through recordToolCompleted so each settlement emits its durable
     * `tool.completed` event AND fills its reserved part — the live stream,
     * the event log and history then agree. Host bash calls stay open during
     * the bounded parent-abort grace so a known result can win; the fallback
     * from toolTerminationResult records unknown effects after that grace.
     * The part collector ignores a genuine late result for an already-settled
     * call.
     */
    const settleOpenToolCalls = (
      status: 'cancelled' | 'expired' | 'failed',
      shouldSettle: (toolName: string) => boolean = () => true,
    ) => {
      // recordToolCompleted deletes the current key; removing the entry being
      // visited is well-defined for a Map iterator.
      for (const [toolCallId, { toolName, toolInput }] of openToolCalls) {
        if (!shouldSettle(toolName)) continue;
        recordToolCompleted(
          toolCallId,
          toolName,
          toolInput,
          toolTerminationResult(status, toolName),
        );
      }
    };

    const settleOpenToolsAndDrain = async (
      status: Exclude<TerminalRunStatus, 'completed'>,
      telemetry: AssistantTurnTelemetry,
    ): Promise<boolean> => {
      settleOpenToolCalls(status);
      // settleOpenToolCalls enqueued new events via recordToolCompleted.
      // Without this await, finishRun's terminal event can commit before the
      // settlement events, and a process kill in that window permanently loses them.
      await deltaWrites;
      if (!progressWriteFailed) return true;
      await this.settleProgressWriteFailure({
        userId: input.userId,
        runId: input.runId,
        attemptId,
        telemetry,
      });
      return false;
    };

    // Set only when a parent abort lands while at least one tool call is open.
    // The tool continuation awaits it, so a failed durable terminal write is
    // surfaced to the stream/worker instead of becoming a detached rejection.
    let parentAbortSettlement: Promise<void> | undefined;

    // The admission outcome every tool call commits — the model's own calls
    // and the system-origin instruction reads alike: record the trusted
    // decision on the open call, emit `tool.requested`, emit `tool.started`
    // only for an allowed call and only after the request is durable, and
    // surface a failed durable write to the caller.
    const admitToolCall = async (
      toolCallId: string,
      toolName: string,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- the AI SDK's own inputSchema validation already ran before this callback fires; `args` is that already-admitted value forwarded for durable recording.
      args: unknown,
      decision: PermissionDecision,
      origin?: ToolActivityOrigin,
    ): Promise<void> => {
      const open = openToolCalls.get(toolCallId);
      if (open !== undefined) open.permission = decision;
      emitToolRequested(toolCallId, toolName, args, decision, origin);
      if (decision.decision === 'allow') {
        enqueueEvent('tool.started', { toolCallId, toolName });
      }
      await deltaWrites;
      if (progressWriteFailed) {
        throw new Error('Tool activity could not be recorded.');
      }
    };

    // Instruction reads go through the same closure as the model's own calls:
    // reserved before admission, settled through `recordToolCompleted`, and
    // carrying the `instructions` origin so abort and finish settlement close
    // them and the assistant transcript never gains a fabricated tool part.
    // The attempt-scoped allocator is shared with the accepted-turn load, so
    // the two never collide in the event log.
    const readInstructionPage = async (
      selectorPath: string,
    ): Promise<ToolResult> => {
      const toolCallId = turnInstructions.nextToolCallId();
      const toolInput = { path: selectorPath };
      reserveToolRequest(toolCallId, 'read', toolInput, ORIGIN_INSTRUCTIONS);
      const result = await runTool(
        nativeReadTool,
        toolInput,
        { ...toolContext, toolCallId },
        callTimeoutSeconds,
        (decision) =>
          admitToolCall(
            toolCallId,
            'read',
            toolInput,
            decision,
            ORIGIN_INSTRUCTIONS,
          ),
      );
      recordToolCompleted(toolCallId, 'read', toolInput, result);
      return result;
    };
    const inRunProducer = this.beginInRunAttempt(
      input,
      turnInstructions,
      readInstructionPage,
    );

    let toolAdditions: AttemptToolAdditions;
    const executeBoundTool = async (
      declaration: ModelToolDeclaration,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- the AI SDK validates tool arguments against the declaration schema before this trusted wrapper runs.
      args: unknown,
      toolCallId: string,
    ) => {
      persistDelta(deltas.flush());
      reserveToolRequest(toolCallId, declaration.id, args);
      const executor = toolAdditions.executorFor(declaration.id);
      if (executor === undefined) {
        throw new Error(`Tool "${declaration.id}" has no executor.`);
      }
      const result = await runTool(
        executor,
        args,
        {
          ...toolContext,
          toolCallId,
          onDerivedDecision: (decision) =>
            recordDerivedDecision(toolCallId, decision),
        },
        callTimeoutSeconds,
        async (decision) => {
          await admitToolCall(toolCallId, declaration.id, args, decision);
          if (decision.decision === 'allow') {
            // The trigger follows admission, not the result: a call that is
            // allowed loads its directory whether or not it then failed, and a
            // denied or never-admitted call loads nothing.
            inRunProducer?.observeToolCall?.({
              toolName: declaration.id,
              input: args,
              workspaceRoot: workspaceRoot.current(),
            });
          }
        },
      );
      return { executor, result };
    };

    const settleBoundTool = async (
      declaration: ModelToolDeclaration,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- this value is the already schema-validated tool observation forwarded to settlement.
      args: unknown,
      toolCallId: string,
      executor: Tool,
      result: ToolResult,
    ) => {
      // The settled observation is what names an entry's canonical root: only
      // the result knows whether the binding was established or switched.
      inRunProducer?.observeToolCall?.({
        toolName: declaration.id,
        input: args,
        workspaceRoot: workspaceRoot.current(),
        result,
      });
      if (input.abortSignal?.aborted) {
        // Bash gets a bounded chance to report its own proven result after
        // cancellation. Other tools are settled synchronously by the
        // parent-abort listener. An unknown bash result remains owned by
        // that listener's synthetic settlement.
        const settledAfterAbort =
          isBashTool(executor) &&
          !(result.status === 'error' && result.type === 'outcome_unknown');
        if (settledAfterAbort) {
          recordToolCompleted(toolCallId, declaration.id, args, result);
        } else {
          await parentAbortSettlement;
        }
      } else {
        recordToolCompleted(toolCallId, declaration.id, args, result);
      }
      if (
        (isHostCapabilityTool(executor) || executor.id.startsWith('mcp__')) &&
        result.status === 'error' &&
        result.type === 'outcome_unknown'
      ) {
        await deltaWrites;
        throw new Error(
          isHostCapabilityTool(executor)
            ? 'Host command or mutation outcome is unknown; the Run cannot continue.'
            : 'MCP operation outcome is unknown; the Run cannot continue.',
        );
      }
      return isNativeFileTool(executor) ? result : neutralizeToolResult(result);
    };

    const createModelToolDefinition = (
      declaration: ModelToolDeclaration,
    ): ToolSet[string] => {
      const initialExecutor = boundExecutables.get(declaration.id)?.executor;
      if (initialExecutor === undefined) {
        throw new Error(`Tool "${declaration.id}" has no executor.`);
      }
      const nativeOutput = isNativeFileTool(initialExecutor)
        ? {
            toModelOutput: ({ output }: { output: unknown }) => ({
              type: 'text' as const,
              value: serializeNativeModelOutput(output),
            }),
          }
        : {};
      const definition = tool({
        description: declaration.description,
        inputSchema: toFlexibleSchema(declaration.inputSchema)!,
        execute: async (
          // eslint-disable-next-line anti-slop/no-unknown-parameters -- the AI SDK validates this input against the declaration schema before this callback runs.
          args: unknown,
          { toolCallId }: { toolCallId: string },
        ) => {
          const { executor, result } = await executeBoundTool(
            declaration,
            args,
            toolCallId,
          );
          return settleBoundTool(
            declaration,
            args,
            toolCallId,
            executor,
            result,
          );
        },
        ...nativeOutput,
      });
      return definition.type === 'provider'
        ? definition
        : { ...definition, strict: false };
    };

    toolAdditions = new AttemptToolAdditions({
      allowedToolRules: this.instanceConfig.config.tools.allowed,
      callTimeoutSeconds,
      boundExecutables,
      createTool: createModelToolDefinition,
    });
    Object.assign(toolContext, { toolAdditions });

    // The attempt-local catalog is the authority for what the model sees.
    const toolSet: ToolSet = Object.fromEntries(
      executableTools.map(({ declaration }) => [
        declaration.id,
        createModelToolDefinition(declaration),
      ]),
    );
    const hasTools = Object.keys(toolSet).length > 0;

    // Reserve termination settlement synchronously on the PARENT run signal.
    // Ordinary tools settle immediately. Bash stays open for the bounded grace
    // so a proven cancellation can persist its own result before the unknown
    // fallback. A per-call timeout aborts only runTool's derived signal and
    // never reaches this listener, so ordinary timeout completions are
    // unchanged.
    const settleToolsOnParentAbort = () => {
      if (openToolCalls.size === 0 || parentAbortSettlement) {
        return;
      }
      const status = classifyAbortedRun(input.abortSignal);
      // An expired run's terminal message names its abort REASON (a configured
      // budget or the execution ceiling) rather than "a tool was interrupted",
      // so it reads like every other expired settlement.
      const message =
        status === 'expired'
          ? expiredRunMessage(input.abortSignal)
          : toolTerminationMessage(status);
      const hasBashCall = [...openToolCalls.values()].some(
        ({ toolName }) => toolName === 'bash',
      );
      settleOpenToolCalls(status, (toolName) => toolName !== 'bash');
      parentAbortSettlement = (async () => {
        if (hasBashCall) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, BASH_SETTLEMENT_GRACE_MS);
          });
        }
        settleOpenToolCalls(status);
        await deltaWrites;
        if (progressWriteFailed) {
          await this.failRunProgressPersistence({
            userId: input.userId,
            runId: input.runId,
            attemptId,
            telemetry: buildAssistantTelemetry(null, 'error'),
          });
          return;
        }
        const assistantTelemetry = buildAssistantTelemetry(
          null,
          turnStatusForTerminalRun(status),
        );
        try {
          await this.settleTerminalRun({
            userId: input.userId,
            runId: input.runId,
            status,
            attemptId,
            telemetry: assistantTelemetry,
            runPayload: { status, message },
            error: { message },
          });
        } catch {
          await this.failRunProgressPersistence({
            userId: input.userId,
            runId: input.runId,
            attemptId,
            telemetry: buildAssistantTelemetry(null, 'error'),
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

    const endWorkspaceAttempt = this.beginWorkspaceAttempt(
      input.chatId,
      workspaceMcpKey,
    );
    try {
      return client.streamText({
        onRequestUsage: (usage) => {
          requestUsageReceipts.push(usage);
        },
        system,
        messages,
        chat: { id: input.chatId, lane: 'main' },
        abortSignal: input.abortSignal,
        // Absent → no provider option at all, leaving the provider default.
        ...(effort !== undefined && { effort }),
        // Tool loop: pass the pre-filtered set + the operator step cap.
        // Absent when no tool is available → the answer-only single-
        // generation path (today's pre-tool-loop behavior).
        ...(hasTools && {
          tools: toolSet,
          onToolSet: (record) => toolAdditions.bindToolRecord(record),
          maxSteps: maxStepsPerRun,
          onStepStart: async ({ messages, stepNumber }) => {
            workspaceRoot.beginStep();
            inRunItems.beginStep(messages);
            await inRunProducer?.prepareStep({
              messages,
              stepNumber,
              stage: (part) => {
                inRunItems.stage(part);
                assistantPartCollector.contextItem(part);
              },
            });
            // Recomputed from the step's own messages on every step, so a
            // retained override is replaced rather than accumulated (D1).
            return inRunItems.applyToStep(messages);
          },
          // Fires once, the moment the model client disables tools for
          // the next step because maxStepsPerRun tool-requesting steps
          // already ran (D6) — record it as a distinct run event; the
          // cap-marker PART is persisted in onFinish once the run
          // actually completes (a run that errors mid-loop after
          // capping does not claim to have "completed with the cap").
          onCapReached: () => {
            cappedAt = maxStepsPerRun;
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
            // started in between). No permission decision: an unavailable or
            // invalid call is not a permission rejection.
            reserveToolRequest(toolCallId, toolName, callInput);
            emitToolRequested(toolCallId, toolName, callInput, undefined);
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
          // Text intervened: the next reasoning delta opens a new part, so the
          // id it carries is not the one the drained buffer belonged to.
          reasoningPartId = undefined;
          persistDelta(deltas.push(text, Date.now()));
        },
        onReasoningDelta: (text, partId, providerMetadata) => {
          // A metadata-only delivery: a reasoning part's start/end carries the
          // opaque provider metadata but no delta of its own (design D15/D18).
          // Drain the buffer first so the durable log keeps the part's text
          // before its metadata, then record the metadata under the id the
          // adapter named — which can differ from the open part's id when one
          // reasoning item has several summaries.
          if (text.length === 0 && providerMetadata !== undefined) {
            // D18: when this delivery starts a part no collected part carries
            // (a signed block whose text the provider withheld, a reasoning
            // item whose summary is empty), any text buffered before it must
            // land first — else the durable replay would place the empty part
            // ahead of text the live collector already recorded in order.
            if (
              assistantPartCollector.startsReasoningPart(
                partId,
                providerMetadata,
              )
            ) {
              persistDelta(deltas.flush());
            }
            persistReasoning(reasoningDeltas.flush());
            persistReasoningMetadata(partId, providerMetadata);
            assistantPartCollector.reasoning('', partId, providerMetadata);
            return;
          }
          // Drain before adopting a new id so a buffered event never spans
          // two adapter parts (the collector splits on the same transition).
          if (partId !== reasoningPartId) {
            persistReasoning(reasoningDeltas.flush());
            reasoningPartId = partId;
          }
          // A text-bearing delivery is recorded as text alone. The opaque
          // metadata a wire may also attach to a delta (Responses repeats the
          // item id on every summary delta) is not the delivery a later
          // request replays from: the part's own metadata delivery carries it
          // in full under the same id — the Responses item's end (id, plus the
          // encrypted content on the item's last part), the Messages withheld
          // block's empty signature delta or redacted start — so binding it
          // here would only duplicate plumbing, and buffering stays coalesced
          // exactly as the live collector's part does.
          assistantPartCollector.reasoning(text, partId);
          persistDelta(deltas.flush());
          persistReasoning(reasoningDeltas.push(text, Date.now()));
        },
        onError: async ({ error }) => {
          endWorkspaceAttempt();
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

          const status = input.abortSignal?.aborted
            ? classifyAbortedRun(input.abortSignal)
            : 'failed';
          const assistantTelemetry = buildAssistantTelemetry(
            null,
            turnStatusForTerminalRun(status),
          );
          const progressFailureTelemetry =
            status === 'failed'
              ? assistantTelemetry
              : buildAssistantTelemetry(null, 'error');
          persistReasoning(reasoningDeltas.flush());
          persistDelta(deltas.flush());
          await deltaWrites;
          if (progressWriteFailed) {
            await this.settleProgressWriteFailure({
              userId: input.userId,
              runId: input.runId,
              attemptId,
              telemetry: progressFailureTelemetry,
            });
            return;
          }
          // A stalled model stream is a model-level failure, not an abort: it
          // ends the run terminally `failed` under its own error code so the
          // cause survives on the run and its event (the same treatment
          // `outcome_unknown` gets), and the job succeeds without a retry.
          const idleCode =
            error instanceof ModelStreamIdleError ? error.code : undefined;
          const message =
            status === 'expired'
              ? expiredRunMessage(input.abortSignal)
              : error instanceof Error
                ? error.message
                : String(error);
          // Settle before reading parts: a call still open here was rendered
          // as running live, and an unsettled part is filtered out of
          // history — so without this the live view and the reload disagree.
          if (
            !(await settleOpenToolsAndDrain(status, progressFailureTelemetry))
          ) {
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
            attemptId,
            modelCompleted: {
              finishReason: null,
              telemetry: assistantTelemetry,
            },
            runPayload: {
              status,
              message,
              ...(idleCode !== undefined && { code: idleCode }),
            },
            error: {
              message,
              ...(idleCode !== undefined && { code: idleCode }),
            },
            assistantTurn: turn,
          });

          await this.afterAssistantTurn(
            finish.assistantMessage,
            input.userId,
            turn.telemetry,
          );
        },
        onFinish: async ({ text, usage, finishReason, stepCount }) => {
          endWorkspaceAttempt();
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
          const status = input.abortSignal?.aborted
            ? classifyAbortedRun(input.abortSignal)
            : finishReason === 'error'
              ? 'failed'
              : 'completed';
          const assistantTelemetry = buildAssistantTelemetry(
            finishReason,
            turnStatusForTerminalRun(status),
            stepCount,
          );
          const progressFailureTelemetry =
            status === 'failed'
              ? assistantTelemetry
              : buildAssistantTelemetry(finishReason, 'error', stepCount);
          // Drain buffered reasoning + deltas BEFORE the terminal events so the
          // log reads in stream order: …model.delta, model.completed, run.completed.
          persistReasoning(reasoningDeltas.flush());
          persistDelta(deltas.flush());
          await deltaWrites;
          if (progressWriteFailed) {
            await this.settleProgressWriteFailure({
              userId: input.userId,
              runId: input.runId,
              attemptId,
              telemetry: progressFailureTelemetry,
            });
            return;
          }
          // Persist the collected thinking as reasoning parts in occurrence
          // order (display only — partsToText strips it, so it is never
          // re-fed to the model and never enters a compaction summary).
          // Only turns reaching onFinish (normal completion + the narrow
          // finish-races-abort case) get this; the common event-driven abort
          // goes through onError → the streamedText-only parts above (reasoning
          // dropped, like text-in-progress today).
          if (cappedAt !== null) {
            assistantPartCollector.capNotice({
              type: 'data-cap-notice',
              data: { stepsUsed: cappedAt, maxSteps: cappedAt },
            });
          }
          // Normally a no-op — a completed run settled every call through the
          // toolSet wrapper. It fires for the narrow finish-races-abort case,
          // where a call can still be open when this path wins.
          if (
            status !== 'completed' &&
            !(await settleOpenToolsAndDrain(status, progressFailureTelemetry))
          ) {
            return;
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
            attemptId,
            modelCompleted: {
              usage,
              finishReason,
              // Carry the FULL turn telemetry (tokens + cost + latency + model) so
              // the stream bridge can surface per-turn usage as message metadata
              // live and on resume — the same object persisted on the message.
              telemetry: assistantTelemetry,
            },
            assistantTurn: turn,
            ...(status === 'completed' && {
              attemptContextParts: attemptStagedParts,
              // The dispatched request's items, then this attempt's in-Run
              // items in emission order (D1/publication requirement).
              runContextItems: [
                ...attemptContextItems,
                ...toRunContextItems(inRunItems.parts()),
              ],
              ...(attemptRecencyDigestInitialization !== undefined && {
                recencyDigestInitialization: attemptRecencyDigestInitialization,
              }),
              ...(attemptRecencyDigestTold !== undefined && {
                recencyDigestTold: attemptRecencyDigestTold,
              }),
              ...(attemptSkillCatalogWrites !== undefined && {
                skillCatalogWrites: attemptSkillCatalogWrites,
              }),
              ...(attemptWorkspaceWrites !== undefined && {
                workspaceWrites: attemptWorkspaceWrites,
              }),
              turnToolAvailability: attemptToolAvailability,
            }),
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
          if (assistantTelemetry.status === 'completed') {
            await this.postCompletedRunWork({
              chatId: input.chatId,
              userId: input.userId,
              untitled,
              userMessage: input.userMessage,
            });
          }
        },
      });
    } catch (error) {
      endWorkspaceAttempt();
      removeParentAbortListener();
      // A synchronous throw from streamText (provider/config validation before
      // any callback can fire) would otherwise strand the claimed run at
      // 'running_model' until the deadman sweep expires it — fail it now.
      if (input.abortSignal?.aborted) {
        await this.settleAbortedRun(input, attemptId);
      }
      const message = error instanceof Error ? error.message : String(error);
      // This attempt holds the claim; a reclaim during the synchronous throw
      // must reject this write rather than let the superseded attempt publish.
      await this.finishRun({
        userId: input.userId,
        runId: input.runId,
        status: 'failed',
        attemptId,
        runPayload: { status: 'failed', message },
        error: { message },
      });
      throw error;
    }
  }

  /**
   * Loads the active checkpoint and the message history up to the run's
   * triggering message, then rebuilds the context with `systemPrompt` — the
   * shared core of the initial per-run context build and the post-publication
   * rebuild.
   *
   * The read is the chat's whole live window, so it also yields the rows the
   * compaction trigger plans on and the instruction files the history already
   * discloses (D7); no caller reads the history twice.
   */
  private async rebuildContextForChat(
    tx: Db,
    input: ExecuteRunInput,
    systemPrompt: string,
  ): Promise<{
    readonly context: ReturnType<typeof buildContext>;
    readonly historyRows: Array<Message>;
    readonly seenInstructionPaths: ReadonlySet<string>;
  }> {
    const { compaction, history } = await findLiveWindow(
      tx,
      input.chatId,
      input.userId,
      { maxSeq: input.userMessage.seq },
    );
    return {
      context: buildContext(toStoredMessages(history), {
        systemPrompt,
        // A Run's own request continues this Chat, so it replays the Chat's
        // persisted reasoning (D16).
        requestKind: 'continuation',
        ...(compaction && {
          compaction: {
            summary: compaction.summary,
            uptoSeq: compaction.uptoSeq,
            replacementHistory: compaction.replacementHistory,
          },
        }),
      }),
      historyRows: history,
      seenInstructionPaths: instructionsSeenPaths(
        history.flatMap((message) => message.parts),
      ),
    };
  }

  private beginWorkspaceAttempt(
    chatId: string,
    key: WorkspaceMcpKey | undefined,
  ): () => void {
    const clients = this.workspaceMcp;
    if (clients === undefined) return () => {};
    if (key !== undefined) clients.beginAttempt(key);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      clients.endAttempt(chatId);
    };
  }

  private async startWorkspaceMcp(
    chatId: string,
    key: WorkspaceMcpKey | undefined,
  ): Promise<void> {
    if (this.workspaceMcp === undefined) return;
    if (key === undefined) {
      await this.workspaceMcp.stopForChat(chatId);
      return;
    }
    await this.workspaceMcp.startForChat(key);
  }

  private attemptDynamicResolver(
    key: WorkspaceMcpKey | undefined,
  ): DynamicToolExecutorResolver | undefined {
    if (key === undefined || this.workspaceMcp === undefined) {
      return this.dynamicToolResolver;
    }
    return this.workspaceMcp.resolverFor(key, this.dynamicToolResolver);
  }

  private resolveEffectivePermissionMode(
    permissionMode: PermissionMode,
  ): PermissionMode {
    return resolveEffectivePermissionMode(
      permissionMode,
      this.instanceConfig.config.tools.permissionModes,
    );
  }

  private workspaceMcpKey(
    preparation: WorkspacePreparation,
  ): WorkspaceMcpKey | undefined {
    const root = preparation.root;
    const chat = preparation.chat;
    const generation = chat?.workspaceGeneration;
    if (root === undefined || chat === undefined || generation === undefined) {
      return undefined;
    }
    return { chatId: chat.id, root, generation };
  }
  private async prepareWorkspace(
    input: ExecuteRunInput,
    nativeDeliverySequence: number,
    chat: Chat | undefined,
    effectivePermissionMode: PermissionMode,
  ): Promise<WorkspacePreparation> {
    const root = chat?.workspaceRoot;
    const executorId = chat?.workspaceExecutorId;
    const generation = chat?.workspaceGeneration;
    if (root === undefined || root === null || executorId === undefined) {
      return { root: undefined, chat };
    }

    if (executorId === null || generation === undefined) {
      return { root: undefined, chat };
    }
    const reason = await this.workspaceDetachReason(
      root,
      executorId,
      effectivePermissionMode,
    );
    if (reason === undefined) return { root, chat };

    const detached = await this.tenantDb.runAs(input.userId, (tx) =>
      new WorkspaceBindingRepository(tx).detach({
        chatId: input.chatId,
        ownerUserId: input.userId,
        runId: input.runId,
        deliverySequence: nativeDeliverySequence,
        expectedGeneration: generation,
        reason,
      }),
    );
    if (detached === 'fence_lost') {
      throw new RunNotRunnableError(input.runId);
    }
    if (detached === 'detached') {
      await this.workspaceMcp?.stopForChat(input.chatId);
      return {
        root: undefined,
        chat:
          chat === undefined
            ? undefined
            : {
                ...chat,
                workspaceRoot: null,
                workspaceExecutorId: null,
                workspaceGeneration: generation + 1,
                workspaceDetachReason: reason,
              },
      };
    }
    // A concurrent enter/exit won the generation compare-and-set. Do not
    // reuse the root that failed this attempt's checks.
    return { root: undefined, chat };
  }
  private async workspaceDetachReason(
    root: string,
    executorId: string,
    effectivePermissionMode: PermissionMode,
  ): Promise<WorkspaceDetachReason | undefined> {
    const currentExecutorId = this.instanceConfig.config.tools.nativeExecutorId;
    if (currentExecutorId === undefined) return 'executor_absent';
    if (currentExecutorId !== executorId) return 'executor_mismatch';

    try {
      const entry = await stat(root);
      if (!entry.isDirectory()) return 'root_missing';
      if ((await realpath(root)) !== root) return 'root_moved';
    } catch {
      return 'root_missing';
    }

    if (!this.instanceConfig.config.tools.allowed.includes('enter_workspace')) {
      return 'tool_not_allowed';
    }
    // Deliberately mirrors admitPermission; no ToolContext exists here.
    if (effectivePermissionMode === 'bypass') return undefined;
    const decision = evaluatePermission(this.permissionPolicy, {
      toolId: 'enter_workspace',
      args: { path: root },
    });
    return decision.decision === 'allow' ? undefined : 'permission_rejected';
  }

  /**
   * Load the skills this Run's triggering user message named explicitly.
   *
   * The mention set is derived from the STORED user text — the trusted copy,
   * re-derivable at any time — and never from assistant output, tool results,
   * or context items. Loading goes through `runTool` with the bound read
   * declaration, under the same trusted context builder and permission policy
   * a model-initiated call uses, so activation can neither invent authority nor
   * bypass #763's admission.
   *
   * Returns the turn's selection set, which every later skill read in this Run
   * carries: a manual-only skill the user named stays readable for this Run's
   * tool calls and refuses again on a turn that does not name it.
   */
  private async activateMentionedSkills(
    input: ExecuteRunInput,
    nativeDeliverySequence: number,
    workspaceRoot: WorkspaceRootCell,
    effectivePermissionMode: PermissionMode,
  ): Promise<ReadonlySet<string>> {
    if (
      this.instanceConfig.config.skills.directories.length === 0 &&
      workspaceRoot.current() === undefined
    ) {
      return new Set();
    }
    // `partsToText` keeps only text parts: not context items, tool output,
    // reasoning, or attachments. Activation scans exactly the user's own words.
    const text = partsToText(input.userMessage.parts);
    const mentions = parseSkillMentions(text);
    if (mentions.length === 0) return new Set();
    const baseContext = this.buildSystemReadContext(
      input,
      nativeDeliverySequence,
      workspaceRoot,
      effectivePermissionMode,
    );
    // What a prior attempt of this Run already resolved. Reading it first is
    // what makes recovery replay stored observations rather than re-reading a
    // package that may have changed.
    const resolved = await this.tenantDb.runAs(input.userId, (tx) =>
      new ActivationPartsRepository(tx).resolvedSkillsForRun({
        id: input.userMessage.id,
        chatId: input.chatId,
        runId: input.runId,
      }),
    );
    const outcome = await activateSkills({
      mentions,
      resolved,
      runId: input.runId,
      readTool: nativeReadTool,
      toolContext: baseContext,
      callTimeoutSeconds: this.instanceConfig.config.tools.callTimeoutSeconds,
      activity: {
        admitted: (toolCallId, decision) =>
          this.recordSystemReadAdmission(
            input,
            toolCallId,
            { path: 'skill://' },
            ORIGIN_SKILL_ACTIVATION,
            decision,
          ),
        completed: (toolCallId, result) =>
          this.recordSystemReadCompletion(
            input,
            toolCallId,
            ORIGIN_SKILL_ACTIVATION,
            result,
          ),
      },
    });

    if (outcome.items.length > 0) {
      await this.tenantDb.runAs(input.userId, (tx) =>
        new ActivationPartsRepository(tx).appendForRun({
          id: input.userMessage.id,
          chatId: input.chatId,
          runId: input.runId,
          items: outcome.items,
        }),
      );
    }
    return outcome.selection;
  }

  /**
   * Whether HOST instruction files may load at all: the `read` tool must be in
   * the operator allowlist and a native executor configured, so no trigger can
   * disclose a file the model could not have read itself (spec: Read not
   * allowlisted / Missing candidates leave no audit trail).
   */
  private hostInstructionsLoadable(): boolean {
    const tools = this.instanceConfig.config.tools;
    return (
      tools.nativeExecutorId !== undefined && tools.allowed.includes('read')
    );
  }

  /**
   * Whether KNOWLEDGE SPACE instruction files may load: the same `read`
   * allowlist, and a configured `knowledge.root`. No native executor is needed,
   * because a Space candidate is resolved and read through the owner-scoped
   * Knowledge capability rather than the host executor.
   */
  private knowledgeInstructionsLoadable(): boolean {
    const config = this.instanceConfig.config;
    return (
      config.knowledge.root !== undefined &&
      config.tools.allowed.includes('read')
    );
  }

  /**
   * The trusted context for a system-origin read (skill activation, the
   * accepted-turn instructions load): the same fields the model's own tool
   * context carries, built from the RUN's identity. Deliberately no
   * `timeoutMs`: every system-origin read goes through `runTool`, whose
   * `prepareToolExecution` derives the per-call deadline from the tool or
   * `tools.callTimeoutSeconds` and overwrites whatever this context carried.
   */
  private buildSystemReadContext(
    input: ExecuteRunInput,
    nativeDeliverySequence: number,
    workspaceRoot: WorkspaceRootCell,
    effectivePermissionMode: PermissionMode,
  ): ToolContext {
    return {
      runId: input.runId,
      nativeExecutorId: this.instanceConfig.config.tools.nativeExecutorId,
      nativeDeliverySequence,
      productUserAgent: this.instanceConfig.productUserAgent,
      userId: input.userId,
      chatId: input.chatId,
      workspaceRoot,
      tenantDb: this.tenantDb,
      abortSignal: input.abortSignal,
      knowledgeResolver: this.knowledgeResolver,
      skillCatalog: this.skillCatalog,
      permissionPolicy: this.permissionPolicy,
      webAdapters: this.instanceConfig.config.tools.webAdapters,
      permissionMode: effectivePermissionMode,
    };
  }

  /**
   * The accepted-turn instructions load (D5): the live binding's root chain,
   * staged before the first request when any file of it is not already in
   * effective context. Computed outside every database transaction, because
   * probing and reading candidates is filesystem and tool work.
   */
  private async loadTurnInstructions(
    input: ExecuteRunInput,
    preparation: WorkspacePreparation,
    workspaceRoot: WorkspaceRootCell,
    effectivePermissionMode: PermissionMode,
    nativeDeliverySequence: number,
    attemptId: string,
    seenInstructionPaths: ReadonlySet<string>,
    stagedParts: Array<MessagePart>,
  ): Promise<TurnInstructions> {
    const toolContext = this.hostInstructionsLoadable()
      ? this.buildSystemReadContext(
          input,
          nativeDeliverySequence,
          workspaceRoot,
          effectivePermissionMode,
        )
      : undefined;
    // One allocator per attempt, shared by the accepted-turn load and the
    // attempt's in-Run steps, so two reads never collide in the event log.
    let ordinal = 0;
    const nextToolCallId = (): string => {
      ordinal += 1;
      return `instructions-${input.runId}-${attemptId}-${ordinal}`;
    };
    const turn: TurnInstructions = {
      root: preparation.root,
      readPage:
        toolContext === undefined
          ? undefined
          : (selectorPath) =>
              this.readTurnInstructionPage(
                input,
                toolContext,
                selectorPath,
                nextToolCallId(),
              ),
      nextToolCallId,
      part: undefined,
      seenCanonicalPaths: seenInstructionPaths,
    };
    // The load runs through the same door a compaction rebuild does, so
    // "before the first request" and "against the rebuilt history" cannot
    // drift apart.
    await this.refreshTurnInstructions(
      turn,
      stagedParts,
      input,
      seenInstructionPaths,
    );
    return turn;
  }

  /**
   * Recomputes the accepted-turn bundle against the attempt's effective
   * history before the first request and whenever that history is rebuilt. The
   * rebuild decides the seen set — the item this attempt staged can no longer
   * be what makes its files seen, and a file the rebuilt history discloses must
   * not be staged again. The staged item is replaced in place, where every
   * holder of the staged array — the request prepend, finish-time persistence,
   * and the Run record — sees the same content.
   */
  private async refreshTurnInstructions(
    turn: TurnInstructions,
    stagedParts: Array<MessagePart>,
    input: ExecuteRunInput,
    seenCanonicalPaths: ReadonlySet<string>,
  ): Promise<void> {
    const producer = this.inRunProducer;
    const readPage = turn.readPage;
    const root = turn.root;
    if (
      producer === undefined ||
      producer.prepareTurn === undefined ||
      readPage === undefined ||
      root === undefined
    ) {
      return;
    }
    const part = await producer.prepareTurn({
      runId: input.runId,
      workspaceRoot: root,
      readPage,
      seenKeys: seenCanonicalPaths,
      abortSignal: input.abortSignal,
    });
    const previous = turn.part;
    if (previous !== undefined) {
      const index = stagedParts.indexOf(previous);
      if (index >= 0) stagedParts.splice(index, 1);
    }
    turn.part = part;
    // The item's `files` payload names the canonical paths it discloses; the
    // producer keeps no per-attempt state for the caller to ask.
    turn.seenCanonicalPaths =
      part === undefined
        ? seenCanonicalPaths
        : new Set([...seenCanonicalPaths, ...instructionsSeenPaths([part])]);
    if (part !== undefined) placeInstructionsPart(stagedParts, part);
  }

  /**
   * One audited page of the accepted-turn load. Preparation has no attempt
   * tool closure to join, so this records the same requested/started/completed
   * triple a model read does directly, carrying the `instructions` origin; an
   * attempt aborted here publishes neither the item nor an open call.
   */
  private async readTurnInstructionPage(
    input: ExecuteRunInput,
    toolContext: ToolContext,
    selectorPath: string,
    toolCallId: string,
  ): Promise<ToolResult> {
    const toolInput = { path: selectorPath };
    const result = await runTool(
      nativeReadTool,
      toolInput,
      { ...toolContext, toolCallId },
      this.instanceConfig.config.tools.callTimeoutSeconds,
      (decision) =>
        this.recordSystemReadAdmission(
          input,
          toolCallId,
          toolInput,
          ORIGIN_INSTRUCTIONS,
          decision,
        ),
    );
    await this.recordSystemReadCompletion(
      input,
      toolCallId,
      ORIGIN_INSTRUCTIONS,
      result,
    );
    return result;
  }

  /**
   * Durable audit for one system-origin read (skill activation, the
   * accepted-turn instructions load).
   *
   * The `requested` write is awaited BEFORE the read dispatches — the awaited
   * admission callback #763 already supplies for model-origin calls — so an
   * audit failure prevents the file from being opened rather than trailing it.
   * Every record carries the origin discriminator, which is what keeps this
   * activity out of the assistant transcript and the live UI stream while
   * leaving it in the owner-scoped event log.
   *
   * A denied read emits requested then completed, with no `tool.started`: the
   * call never genuinely ran, and the same convention holds for the model's own
   * refused calls.
   */
  private async recordSystemReadAdmission(
    input: ExecuteRunInput,
    toolCallId: string,
    toolInput: { readonly path: string },
    origin: ToolActivityOrigin,
    decision: PermissionDecision,
  ): Promise<void> {
    await this.tenantDb.runAs(input.userId, async (tx) => {
      const events = new RunEventsRepository(tx);
      await events.append(input.runId, 'tool.requested', {
        toolCallId,
        toolName: 'read',
        input: toolInput,
        permission: decision,
        origin,
      });
      // Started only for an allowed call, and only after the request is
      // durable — the same ordering the model-initiated path uses.
      if (decision.decision === 'allow') {
        await events.append(input.runId, 'tool.started', {
          toolCallId,
          toolName: 'read',
        });
      }
    });
  }

  private async recordSystemReadCompletion(
    input: ExecuteRunInput,
    toolCallId: string,
    origin: ToolActivityOrigin,
    result: ToolResult,
  ): Promise<void> {
    await this.tenantDb.runAs(input.userId, (tx) =>
      new RunEventsRepository(tx).append(input.runId, 'tool.completed', {
        toolCallId,
        toolName: 'read',
        status: result.status,
        output: result,
        origin,
      }),
    );
  }

  /**
   * Window precedence is fixed; empty ranges are no-ops unless the request
   * does not fit.
   */
  private async evaluateCompactionTrigger(
    input: CompactionTriggerInput,
  ): Promise<
    | {
        readonly variant: 'threshold' | 'window';
        readonly plan: CompactionPlan;
      }
    | undefined
  > {
    const plan = planCompactionCheckpoint({
      rows: toStoredMessages(input.historyRows),
      boundarySeq: input.boundarySeq,
      triggeringUserSeq: input.run.userMessage.seq,
    });
    const fits = requestFitsContextWindow({
      system: input.prepared.system,
      messages: input.prepared.messages,
      toolDeclarations: input.prepared.toolDeclarations,
      contextWindowTokens: input.run.client.contextWindowTokens,
      reservedOutputTokens: this.instanceConfig.config.runs.maxOutputTokens,
    });
    if (!fits) {
      if (plan === null) {
        throw new ContextIncompatibleError(
          'The complete request exceeds the target model context window and no committed turn is left to summarize.',
        );
      }
      return { variant: 'window', plan };
    }
    const measured = await this.measureAttemptContextTokens(input);
    if (
      measured <
      resolveCompactionThreshold({
        explicitThresholdTokens: input.run.client.compactionThresholdTokens,
        contextWindowTokens: input.run.client.contextWindowTokens,
      })
    ) {
      return undefined;
    }
    return plan === null ? undefined : { variant: 'threshold', plan };
  }

  /**
   * D4's measured size: the previous completed turn's persisted final-request
   * context size plus the estimate of what this request adds after it. With no
   * countable reply the whole request is estimated instead — the same
   * provider-neutral preflight admission uses.
   */
  private async measureAttemptContextTokens(
    input: CompactionTriggerInput,
  ): Promise<number> {
    const previousCompleted = await this.tenantDb.runAs(
      input.run.userId,
      (tx) =>
        new RunsRepository(tx).findMostRecentCompletedByChatMessageSequence(
          input.run.chatId,
          input.run.userId,
          { beforeSeq: input.run.userMessage.seq },
        ),
    );
    const counted = countedContextTokens({
      previousCompleted: previousCompleted && {
        messageId: previousCompleted.run.messageId,
        triggeringUserSeq: previousCompleted.triggeringUserSeq,
      },
      rows: input.historyRows,
      boundarySeq: input.boundarySeq,
    });
    if (counted === undefined) {
      return estimateModelRequestTokens({
        system: input.prepared.system,
        messages: input.prepared.messages,
        toolDeclarations: input.prepared.toolDeclarations,
      });
    }
    return (
      counted.contextTokens +
      estimateContinuationTokens({
        rows: toStoredMessages(
          input.historyRows.filter((row) => row.seq > counted.replySeq),
        ),
        railText: stagedContextTexts(input.stagedParts)
          .map((part) => part.text)
          .join(''),
      })
    );
  }

  /**
   * The terminal message an aborted run settles with. The expired text comes
   * from the abort REASON (budget vs. execution ceiling), never from the
   * status alone — both settle as run.expired, but only a configured budget
   * may be named.
   */
  private abortedRunMessage(
    status: 'cancelled' | 'expired' | 'failed',
    signal: AbortSignal | undefined,
  ): string {
    if (status === 'failed')
      return 'Native mutation outcome is unknown; inspect the file before a new attempt.';
    return status === 'expired'
      ? expiredRunMessage(signal)
      : 'Run was cancelled before model inference.';
  }

  /** Settle an observed abort before streaming and suppress queue retries only
   * after the terminal state + matching event are durably visible. Fenced by
   * `attemptId`: only the attempt that observed the abort may settle it, so a
   * reclaimed attempt's late abort cannot cancel the live attempt's run. */
  private async settleAbortedRun(
    input: {
      userId: string;
      runId: string;
      abortSignal?: AbortSignal;
    },
    attemptId: string,
  ): Promise<never> {
    const status = classifyAbortedRun(input.abortSignal);
    const message = this.abortedRunMessage(status, input.abortSignal);
    const finish = await this.finishRun({
      userId: input.userId,
      runId: input.runId,
      status,
      attemptId,
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
    attemptId: string;
    telemetry: AssistantTurnTelemetry;
  }): Promise<void> {
    const message = 'Run progress could not be persisted.';
    await this.settleTerminalRun({
      userId: input.userId,
      runId: input.runId,
      status: 'failed',
      attemptId: input.attemptId,
      telemetry: input.telemetry,
      runPayload: { status: 'failed', message },
      error: { message },
    });
  }

  private async failRunProgressPersistence(input: {
    userId: string;
    runId: string;
    attemptId: string;
    telemetry: AssistantTurnTelemetry;
  }): Promise<void> {
    const message = 'Run progress could not be persisted.';
    try {
      await this.settleTerminalRun({
        userId: input.userId,
        runId: input.runId,
        status: 'failed',
        attemptId: input.attemptId,
        telemetry: input.telemetry,
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
  private async finishRun(input: FinishRunInput): Promise<FinishRunResult> {
    try {
      return await this.tenantDb.runAs(input.userId, (tx) =>
        this.finishRunInTransaction(tx, input),
      );
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

  /** Execute terminal bookkeeping within the caller's tenant transaction. */
  private async finishRunInTransaction(
    tx: Db,
    input: FinishRunInput,
  ): Promise<FinishRunResult> {
    const runsRepo = new RunsRepository(tx);
    const finished = await runsRepo.markFinished(
      input.runId,
      input.userId,
      input.status,
      {
        error: input.error,
        attemptId: input.attemptId,
        ...(input.status === 'completed' &&
          input.turnToolAvailability !== undefined && {
            turnToolAvailability: input.turnToolAvailability,
          }),
      },
    );
    if (!finished) {
      return this.handleLostFinish(tx, input, runsRepo);
    }

    const events = new RunEventsRepository(tx);
    const durable = reconstructDurableAssistant(
      await events.listByRunId(input.runId, input.userId),
    );
    await this.settleDurableOpenTools(tx, input, durable, events);
    const assistantTurn = this.buildAssistantTurnForFinish(
      input,
      finished,
      durable.collector.parts(),
    );
    await this.finalizeAssistantTurnTelemetry(
      tx,
      input,
      finished,
      assistantTurn,
    );
    if (input.modelCompleted) {
      await events.append(input.runId, 'model.completed', input.modelCompleted);
    }
    await this.persistFinishedContext(tx, input, finished);
    // The completed attempt appends its in-Run items to the request's record
    // in the same transaction that publishes them on the assistant message, so
    // the record can never list an item the model never received — or miss one
    // it did.
    if (input.status === 'completed' && input.runContextItems !== undefined) {
      await runsRepo.recordContextItems(
        input.runId,
        input.userId,
        input.runContextItems,
      );
    }

    const assistantMessage = await this.persistAssistantMessage(
      tx,
      input.userId,
      assistantTurn,
    );
    await events.append(input.runId, `run.${input.status}`, input.runPayload);
    return {
      outcome: 'won',
      assistantMessage,
    };
  }

  private async hasReplaceableAssistantUsage(
    tx: Db,
    userId: string,
    chatId: string | undefined,
    inReplyTo: string | null | undefined,
  ): Promise<boolean> {
    if (chatId === undefined || inReplyTo === undefined || inReplyTo === null) {
      return false;
    }
    const { assistantMessage } = await new MessagesRepository(tx).findTurnState(
      chatId,
      userId,
      inReplyTo,
    );
    return (
      assistantMessage !== undefined &&
      !isCompletedAssistantTurn(assistantMessage)
    );
  }

  /** Finalizes usage completeness against owner-scoped Run and reply state. */
  private async finalizeAssistantTurnTelemetry(
    tx: Db,
    input: Pick<
      FinishRunInput,
      'userId' | 'runId' | 'attemptId' | 'assistantTurn' | 'modelCompleted'
    >,
    run: Run | undefined,
    assistantTurn: AssistantTurnPersistence | undefined = input.assistantTurn,
  ): Promise<void> {
    // Telemetry-bearing writers share one object between the completed event
    // and assistant turn, so finalizing the event's object finalizes both.
    const telemetry = input.modelCompleted?.telemetry;
    if (!telemetry) {
      return;
    }

    const chatId = assistantTurn?.chatId ?? run?.chatId;
    const inReplyTo = assistantTurn?.inReplyTo ?? run?.messageId;
    const receipts = await new SystemPromptReceiptsRepository(
      tx,
    ).findByOwnedRun(input.runId, input.userId);
    const replacedUsage = await this.hasReplaceableAssistantUsage(
      tx,
      input.userId,
      chatId,
      inReplyTo,
    );
    telemetry.complete =
      telemetry.complete === true &&
      run?.status === 'completed' &&
      !receipts.some(({ attemptId }) => attemptId !== input.attemptId) &&
      !replacedUsage;
  }

  /**
   * A terminal race can still salvage streamed content after an expiry. A
   * cancellation or an already-recorded answer intentionally does not.
   */
  private async handleLostFinish(
    tx: Db,
    input: FinishRunInput,
    runsRepo: RunsRepository,
  ): Promise<FinishRunResult> {
    const current = await runsRepo.findById(input.runId, input.userId);
    let assistantMessage: Message | undefined;
    if (current?.status === 'expired') {
      await this.finalizeAssistantTurnTelemetry(
        tx,
        input,
        current,
        input.assistantTurn,
      );
      // A settlement someone else won publishes what the user saw: the
      // expired attempt's staged rail items stay unpublished (design D1).
      assistantMessage = await this.persistAssistantMessage(
        tx,
        input.userId,
        withoutContextItems(input.assistantTurn),
      );
    }
    return {
      outcome: 'lost',
      finalStatus: current?.status,
      assistantMessage,
    };
  }

  private async settleDurableOpenTools(
    tx: Db,
    input: FinishRunInput,
    durable: ReturnType<typeof reconstructDurableAssistant>,
    events: RunEventsRepository,
  ): Promise<void> {
    for (const [
      toolCallId,
      { toolName, toolInput, permission },
    ] of durable.openToolCalls) {
      if (input.status === 'completed') {
        throw new Error(
          `Run ${input.runId} cannot complete with durable tool calls still open.`,
        );
      }
      const nativeResult =
        toolName === 'edit' ||
        toolName === 'write' ||
        toolName === 'bash' ||
        toolName.startsWith('mcp__')
          ? await new NativeFilesRepository(tx).priorOutcome(
              input.runId,
              toolCallId,
            )
          : undefined;
      const result =
        nativeResult ?? toolTerminationResult(input.status, toolName);
      const completedPayload: ToolCompletedEventPayload = {
        toolCallId,
        toolName,
        status: result.status,
        output: result,
      };
      if (permission !== undefined) completedPayload.permission = permission;
      await events.append(input.runId, 'tool.completed', completedPayload);
      durable.collector.tool(
        toolActivityPart({
          toolCallId,
          toolName,
          input: toolInput,
          result,
          permission,
        }),
      );
    }
  }

  private async persistFinishedContext(
    tx: Db,
    input: FinishRunInput,
    finished: Run,
  ): Promise<void> {
    const chatsRepo = new ChatsRepository(tx);
    if (
      input.status === 'completed' &&
      input.recencyDigestInitialization !== undefined
    ) {
      await chatsRepo.setRecencyDigestIfAbsent(
        finished.chatId,
        input.userId,
        input.recencyDigestInitialization.baseline,
        input.recencyDigestInitialization.told,
      );
    }
    if (
      input.status === 'completed' &&
      input.attemptContextParts?.length &&
      finished.messageId
    ) {
      const messagesRepo = new MessagesRepository(tx);
      const turn = await messagesRepo.findTurnState(
        finished.chatId,
        input.userId,
        finished.messageId,
      );
      if (turn.userMessage) {
        await messagesRepo.updateUserMessageParts({
          id: turn.userMessage.id,
          chatId: finished.chatId,
          parts: [...input.attemptContextParts, ...turn.userMessage.parts],
        });
      }
    }
    if (input.status === 'completed' && input.recencyDigestTold !== undefined) {
      await chatsRepo.updateRecencyDigestTold(
        finished.chatId,
        input.userId,
        input.recencyDigestTold,
      );
    }
    // The skill-catalog state advances with the turn that showed it: a turn
    // that started an epoch freezes the baseline its prompt rendered, and a
    // turn that carried a notice records the names it disclosed. Both land in
    // this attempt-fenced terminal transaction, so a losing attempt can never
    // freeze a catalog the winner never rendered.
    if (
      input.status === 'completed' &&
      input.skillCatalogWrites !== undefined
    ) {
      const { freeze, told } = input.skillCatalogWrites;
      if (freeze !== undefined) {
        await chatsRepo.setSkillCatalogBaseline({
          chatId: finished.chatId,
          ownerUserId: input.userId,
          baseline: freeze.baseline,
          rebakedFrom: freeze.rebakedFrom,
        });
      }
      if (told !== undefined) {
        await chatsRepo.updateSkillCatalogTold(
          finished.chatId,
          input.userId,
          told,
        );
      }
    }
    if (input.status === 'completed' && input.workspaceWrites !== undefined) {
      await new WorkspaceBindingRepository(tx).setTold({
        chatId: finished.chatId,
        ownerUserId: input.userId,
        told: input.workspaceWrites.told,
        toldFrom: input.workspaceWrites.toldFrom,
        clearDetachReason: input.workspaceWrites.clearDetachReason,
      });
    }
  }

  /**
   * The configured in-Run producer's state for one attempt, if any producer is
   * registered. Each world gets its own reader: the host chain only with a
   * native executor, the Space chain only with a configured Knowledge root, so
   * a trigger whose world this Run may not load is ignored before anything is
   * probed (spec: Read not allowlisted).
   */
  private beginInRunAttempt(
    input: ExecuteRunInput,
    turn: TurnInstructions,
    readPage: ReadPage,
  ): InRunAttemptProducer | undefined {
    return this.inRunProducer?.beginAttempt({
      runId: input.runId,
      chatId: input.chatId,
      userId: input.userId,
      // The accepted-turn load's keys count as disclosed: a file it staged
      // must not reload on the attempt's first in-Run trigger.
      seenKeys: turn.seenCanonicalPaths,
      ...(this.hostInstructionsLoadable() && { readPage }),
      ...(this.knowledgeInstructionsLoadable() && {
        knowledge: {
          readPage,
          probe: createKnowledgeInstructionProbe({
            resolver: this.knowledgeResolver,
            ownerUserId: input.userId,
            signal: input.abortSignal,
          }),
        },
      }),
      abortSignal: input.abortSignal,
    });
  }

  private buildAssistantTurnForFinish(
    input: FinishRunInput,
    finished: Run,
    durableParts: Array<MessagePart>,
  ): AssistantTurnPersistence | undefined {
    if (input.assistantTurn || durableParts.length === 0) {
      // A non-completed outcome publishes what the user saw, never the rail
      // items the failed attempt staged (design D1). Reconstructed parts need
      // no stripping: no in-Run item is ever event-reconstructed.
      return input.status === 'completed'
        ? input.assistantTurn
        : withoutContextItems(input.assistantTurn);
    }
    if (!finished.messageId) {
      throw new Error(
        `Run ${input.runId} has durable assistant parts but no triggering message.`,
      );
    }
    return {
      chatId: finished.chatId,
      inReplyTo: finished.messageId,
      parts: durableParts,
      ...(input.synthesizedTurnTelemetry && {
        telemetry: input.synthesizedTurnTelemetry,
      }),
    };
  }

  /** Best-effort standalone persist after the terminal transaction rolled back. */
  private async salvageAssistantMessage(
    input: Pick<
      FinishRunInput,
      'userId' | 'runId' | 'attemptId' | 'assistantTurn' | 'modelCompleted'
    >,
  ): Promise<Message | undefined> {
    if (!input.assistantTurn) {
      return undefined;
    }
    try {
      return await this.tenantDb.runAs(input.userId, async (tx) => {
        const run = await new RunsRepository(tx).findById(
          input.runId,
          input.userId,
        );
        await this.finalizeAssistantTurnTelemetry(
          tx,
          input,
          run,
          input.assistantTurn,
        );
        // The terminal transaction rolled back, so no in-Run item was
        // published or recorded; the salvage adds back only what the user
        // saw (design D1).
        return this.persistAssistantMessage(
          tx,
          input.userId,
          withoutContextItems(input.assistantTurn),
        );
      });
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
   * Post-turn work (#78 titling) runs after the terminal result is known, and
   * only for a turn that committed something to title.
   *
   * Titling is awaited only to keep it inside the job's lifetime — the client's
   * stream already ended at `run.completed`, so a title landing here is observed
   * by a later refetch, not this turn's (#261 comment thread; #78's "before
   * stream completion" wording predates the queue split). Failures are swallowed
   * by TitleService. Compaction no longer runs here: the checkpoint publishes
   * before the Run's first model step (design D4/D5).
   */
  private async postCompletedRunWork(input: {
    chatId: string;
    userId: string;
    untitled: boolean;
    userMessage: RunUserMessage;
  }): Promise<void> {
    if (input.untitled) {
      await this.titles.maybeGenerateTitle({
        chatId: input.chatId,
        userId: input.userId,
        userText: partsToText(input.userMessage.parts),
      });
    }
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

  /**
   * Resolve prompt, catalog, context items, and message history for one
   * execution attempt. Runs inside a single tenant transaction.
   *
   * `bindReceipt` is false for the trigger's estimate pass: an attempt binds
   * exactly one receipt, and it must describe the prompt the attempt actually
   * sends — the one rendered after a pre-step checkpoint published (design D5).
   * A pass that published nothing binds it; the pass that follows a publication
   * does.
   */
  private async prepareAttemptContext(
    input: ExecuteRunInput,
    attemptId: string,
    workspaceChat: Chat | undefined,
    workspaceRoot: string | undefined,
    workspaceMcpKey: WorkspaceMcpKey | undefined,
    bindReceipt: boolean,
  ): Promise<PreparedAttemptContext> {
    return this.tenantDb.runAs(input.userId, (tx) =>
      this.prepareAttemptContextInTransaction(
        tx,
        input,
        attemptId,
        workspaceChat,
        workspaceRoot,
        workspaceMcpKey,
        bindReceipt,
      ),
    );
  }
  /** Resolve the complete attempt context, binding its receipt on request. */
  private async prepareAttemptContextInTransaction(
    tx: Db,
    input: ExecuteRunInput,
    attemptId: string,
    workspaceChat: Chat | undefined,
    workspaceRoot: string | undefined,
    workspaceMcpKey: WorkspaceMcpKey | undefined,
    bindReceipt: boolean,
  ): Promise<PreparedAttemptContext> {
    // Resolve owner/model/digest inputs before admission so descriptions and
    // the system prompt share one attempt context. Admission still completes
    // before either surface is rendered.
    const promptInputs = await this.resolveAttemptPrompt(
      tx,
      input,
      workspaceChat,
      workspaceRoot,
    );
    let catalog: AttemptToolCatalog;
    try {
      catalog = await this.composeAttemptCatalog(
        tx,
        input,
        promptInputs,
        workspaceMcpKey,
      );
    } catch (error) {
      if (error instanceof ToolDescriptionRenderError) {
        throw new ModelContextExecutionError(
          `Tool "${error.toolId}" description rendered empty.`,
        );
      }
      throw error;
    }
    const prompt: AttemptPromptContext = {
      ...promptInputs,
      systemPrompt: this.renderAttemptSystemPrompt({
        model: promptInputs.model,
        anchor: promptInputs.anchor,
        user: promptInputs.user,
        chats: promptInputs.promptDigestBaseline,
        skills: promptInputs.skillState.baseline,
        admittedToolIds: catalog.admittedIds,
      }),
    };
    const effectiveContext = this.resolveAttemptEffectiveContext(
      prompt,
      catalog,
    );
    if (bindReceipt) {
      await this.persistAttemptPromptReceipt(
        tx,
        input,
        attemptId,
        effectiveContext,
      );
    }
    const staged = await this.deriveAttemptStagedContext({
      tx,
      input,
      prompt,
      effectiveContext: catalog,
    });
    const built = await this.rebuildContextForChat(
      tx,
      input,
      prompt.systemPrompt,
    );
    return {
      ...built.context,
      seenInstructionPaths: built.seenInstructionPaths,
      historyRows: built.historyRows,
      latestCompaction: prompt.compaction,
      effectiveContext,
      model: prompt.model,
      toolCatalog: catalog,
      stagedParts: staged.stagedParts,
      recencyDigestInitialization: prompt.recencyDigestInitialization,
      recencyDigestTold: staged.recencyDigestTold,
      skillCatalogWrites: {
        ...(prompt.skillState.freeze !== undefined && {
          freeze: prompt.skillState.freeze,
        }),
        ...(staged.skillCatalogTold !== undefined && {
          told: staged.skillCatalogTold,
        }),
      },
      ...(staged.workspaceWrites !== undefined && {
        workspaceWrites: staged.workspaceWrites,
      }),
      untitled: prompt.chat.title === null,
    };
  }

  /** Re-bake after publication so the receipt binds the request actually sent. */
  private async prepareAttemptForFirstStep(input: {
    run: ExecuteRunInput;
    attemptId: string;
    workspacePreparation: WorkspacePreparation;
    workspaceMcpKey: WorkspaceMcpKey | undefined;
    dynamicResolver: DynamicToolExecutorResolver | undefined;
    effectivePermissionMode: PermissionMode;
    nativeDeliverySequence: number;
    workspaceRootCell: WorkspaceRootCell;
    effort: string | undefined;
  }): Promise<PreparedFirstStep> {
    const estimatePass = await this.prepareAttemptContext(
      input.run,
      input.attemptId,
      input.workspacePreparation.chat,
      input.workspacePreparation.root,
      input.workspaceMcpKey,
      false,
    );
    const turnInstructions = await this.loadTurnInstructions(
      input.run,
      input.workspacePreparation,
      input.workspaceRootCell,
      input.effectivePermissionMode,
      input.nativeDeliverySequence,
      input.attemptId,
      estimatePass.seenInstructionPaths,
      estimatePass.stagedParts,
    );
    const estimated = await this.assembleAttemptRequest(
      estimatePass,
      input.dynamicResolver,
    );
    const trigger = await this.evaluateCompactionTrigger({
      run: input.run,
      prepared: estimated.prepared,
      stagedParts: estimatePass.stagedParts,
      historyRows: estimatePass.historyRows,
      boundarySeq: estimatePass.latestCompaction?.uptoSeq ?? 0,
    });
    const summary =
      trigger === undefined
        ? undefined
        : await this.compaction.summarizeCheckpoint(
            trigger.variant === 'window'
              ? {
                  variant: 'window',
                  chatId: input.run.chatId,
                  userId: input.run.userId,
                  triggeringUserSeq: input.run.userMessage.seq,
                  plan: trigger.plan,
                  reservedOutputTokens:
                    this.instanceConfig.config.runs.maxOutputTokens,
                  abortSignal: input.run.abortSignal,
                }
              : {
                  variant: 'threshold',
                  chatId: input.run.chatId,
                  userId: input.run.userId,
                  triggeringUserSeq: input.run.userMessage.seq,
                  plan: trigger.plan,
                  client: input.run.client,
                  // The pre-re-bake render: the summary request continues the
                  // prefix this very pass produced, cache included.
                  system: estimated.prepared.system,
                  toolDeclarations: estimated.prepared.toolDeclarations,
                  ...(input.effort !== undefined && { effort: input.effort }),
                  abortSignal: input.run.abortSignal,
                },
          );
    let context = estimatePass;
    let request = estimated;
    if (summary !== undefined && summary !== null) {
      await this.publishPreStepCompaction({
        run: input.run,
        attemptId: input.attemptId,
        summary,
        model: estimatePass.model,
        workspaceRoot: input.workspacePreparation.root,
      });
      // Re-read rather than reuse the Workspace-prepared row: the publication
      // just moved the digest baseline, the skill baseline and the workspace
      // told-set, and this pass must render and disclose the epoch they now
      // name instead of the one it estimated with (design D5).
      const rebakedChat = await this.tenantDb.runAs(input.run.userId, (tx) =>
        new ChatsRepository(tx).findById(input.run.chatId, input.run.userId),
      );
      context = await this.prepareAttemptContext(
        input.run,
        input.attemptId,
        rebakedChat,
        input.workspacePreparation.root,
        input.workspaceMcpKey,
        true,
      );
      // The published history decides the accepted-turn bundle: the item the
      // estimate pass staged can no longer be what made its files seen.
      await this.refreshTurnInstructions(
        turnInstructions,
        context.stagedParts,
        input.run,
        context.seenInstructionPaths,
      );
      request = await this.assembleAttemptRequest(
        context,
        input.dynamicResolver,
      );
    } else {
      await this.tenantDb.runAs(input.run.userId, (tx) =>
        this.persistAttemptPromptReceipt(
          tx,
          input.run,
          input.attemptId,
          context.effectiveContext,
        ),
      );
    }
    if (
      !requestFitsContextWindow({
        system: request.prepared.system,
        messages: request.prepared.messages,
        toolDeclarations: request.prepared.toolDeclarations,
        contextWindowTokens: input.run.client.contextWindowTokens,
        reservedOutputTokens: this.instanceConfig.config.runs.maxOutputTokens,
      })
    ) {
      throw new ContextIncompatibleError(
        'The complete request still exceeds the target model context window after one compaction.',
      );
    }
    return { request, context, turnInstructions };
  }

  /** The dispatchable request for one pass, with its staged rail prepended. */
  private async assembleAttemptRequest(
    context: PreparedAttemptContext,
    dynamicResolver: DynamicToolExecutorResolver | undefined,
  ): Promise<PreparedFirstStep['request']> {
    const messages = context.messages;
    this.prependStagedContextItems(messages, context.stagedParts);
    return {
      prepared: {
        system: context.system,
        messages,
        untitled: context.untitled,
        toolDeclarations: context.toolCatalog.declarations,
        tools: await resolveBoundExecutableTools(
          context.toolCatalog.declarations,
          undefined,
          constrainDynamicToolResolver(
            dynamicResolver,
            context.toolCatalog.sourceById ?? new Map(),
          ),
        ),
      },
      contextItems: [
        ...context.contextItems,
        ...toRunContextItems(context.stagedParts),
      ],
    };
  }

  /** Publish a checkpoint and its epoch state in one transaction before dispatch. */
  private async publishPreStepCompaction(input: {
    run: ExecuteRunInput;
    attemptId: string;
    summary: CompactionSummary;
    model: SystemModelCatalogEntry;
    workspaceRoot: string | undefined;
  }): Promise<void> {
    const initialShareRecentChats = await this.tenantDb.runAs(
      input.run.userId,
      (tx) => this.memory.getForOwnerForBinding(tx, input.run.userId),
    );
    let digestCandidate: RecencyDigestResolution | null = null;
    if (initialShareRecentChats.shareRecentChats) {
      try {
        digestCandidate = await this.recencyDigest.resolveCandidate(
          input.run.userId,
          input.run.chatId,
        );
      } catch {
        // Candidate titles and excerpts are owner content; do not attach the
        // caught error to a log entry or an execution error.
        this.logger.error('recency_digest_resolution_failed');
        digestCandidate = null;
      }
    }
    await this.tenantDb.runAs(input.run.userId, async (tx) => {
      // A reclaimed or terminated attempt must not move epoch state under the
      // live one. The write fence locks the non-terminal runs row for this
      // attempt, so it serializes with a reclaim's `markStarted`. It runs
      // first, before any chats lock, in the terminal transaction's order
      // (runs, then chats), so a replacement attempt finishing concurrently
      // waits on this transaction instead of deadlocking with it.
      const fenced = await new RunsRepository(tx).updateForAttempt(
        input.run.runId,
        input.run.userId,
        input.attemptId,
        { activeAttemptId: input.attemptId },
      );
      if (!fenced) {
        throw new ModelContextExecutionError(
          `Run ${input.run.runId} was reclaimed before checkpoint publication.`,
        );
      }
      const chatsRepo = new ChatsRepository(tx);
      const compactionsRepo = new CompactionsRepository(tx);
      // Chats before memory, matching the chat loop, which locks the chats row
      // in `touch` and only then takes `FOR SHARE` on memory settings.
      const chat = await chatsRepo.touch(input.run.chatId, input.run.userId);
      const shareRecentChats = await this.memory.getForOwnerForBinding(
        tx,
        input.run.userId,
      );
      // Every publication of this chat takes the row lock above first, so this
      // read is the race verdict: a surviving row means another attempt already
      // published this cutoff and re-baked the epoch for it, so this one leaves
      // those values — and the live attempt's request — alone.
      if (
        (await compactionsRepo.findByCutoff(
          input.run.chatId,
          input.run.userId,
          input.summary.uptoSeq,
        )) !== undefined
      ) {
        return;
      }
      const compaction = await compactionsRepo.create({
        chatId: input.run.chatId,
        uptoSeq: input.summary.uptoSeq,
        parentId: input.summary.parentId,
        summary: input.summary.summary,
        replacementHistory: input.summary.replacementHistory,
        usage: input.summary.usage,
      });
      await this.rebakeCheckpointEpoch({
        tx,
        run: input.run,
        chat,
        compactionId: compaction.id,
        model: input.model,
        workspaceRoot: input.workspaceRoot,
        shareRecentChats,
        digestCandidate,
      });
    });
  }

  /** Re-bake digest, skill, and workspace epoch state for a new checkpoint. */
  private async rebakeCheckpointEpoch(input: {
    tx: Db;
    run: ExecuteRunInput;
    chat: Chat | undefined;
    compactionId: string;
    model: SystemModelCatalogEntry;
    workspaceRoot: string | undefined;
    shareRecentChats: ResolvedMemorySettings;
    digestCandidate: RecencyDigestResolution | null;
  }): Promise<void> {
    const chatsRepo = new ChatsRepository(input.tx);
    const skillState =
      input.chat === undefined
        ? undefined
        : this.resolveSkillTurnState({
            run: input.run,
            chat: input.chat,
            model: input.model,
            workspaceRoot: input.workspaceRoot,
            latestCompactionId: input.compactionId,
          });
    if (
      input.chat?.recencyDigestBaseline != null &&
      input.digestCandidate !== null &&
      input.shareRecentChats.shareRecentChats
    ) {
      await chatsRepo.setRecencyDigest({
        chatId: input.run.chatId,
        ownerUserId: input.run.userId,
        baseline: input.digestCandidate.baseline,
        told: input.digestCandidate.told,
        rebakedFrom: input.compactionId,
      });
    }
    if (skillState?.freeze !== undefined) {
      await chatsRepo.setSkillCatalogBaseline({
        chatId: input.run.chatId,
        ownerUserId: input.run.userId,
        baseline: skillState.freeze.baseline,
        rebakedFrom: input.compactionId,
      });
    }
    if (skillState?.told !== undefined) {
      await chatsRepo.updateSkillCatalogTold(
        input.run.chatId,
        input.run.userId,
        [...skillState.told],
      );
    }
    if (input.chat !== undefined) {
      // Advance the epoch identity and reset the told root, so the snapshot the
      // checkpoint absorbed is re-established by the request it precedes. A
      // pending detach reason stays: only the Run that narrates it clears it.
      await new WorkspaceBindingRepository(input.tx).setTold({
        chatId: input.run.chatId,
        ownerUserId: input.run.userId,
        told: null,
        toldFrom: input.compactionId,
        clearDetachReason: false,
      });
    }
  }

  private async resolveAttemptPrompt(
    tx: Db,
    input: ExecuteRunInput,
    workspaceChat: Chat | undefined,
    workspaceRoot: string | undefined,
  ): Promise<AttemptPromptInputs> {
    const chatsRepo = new ChatsRepository(tx);
    const chat = workspaceChat;
    if (!chat) {
      throw new ModelContextExecutionError(
        `Chat ${input.chatId} was deleted before context preparation.`,
      );
    }
    const model = this.models.validateModelSelection(input.client.model);
    const user = await this.personalization.resolvePromptUser(input.userId);
    // Bounded by the triggering turn, like the history cut and the epoch
    // markers: a pre-step checkpoint publishes above the message it was
    // published for, so an unbounded read could name an epoch this request is
    // not in (design D4, D7).
    const compaction = await new CompactionsRepository(tx).findLatestByChatId(
      input.chatId,
      input.userId,
      { beforeSeq: input.userMessage.seq },
    );
    const digest = await this.resolveAttemptDigest({
      tx,
      input,
      chatsRepo,
      chat,
    });
    const instanceTimezone = resolveInstanceTimezone(this.logger);
    const anchor = formatTemporalAnchor(
      compaction?.createdAt ?? chat.createdAt,
      instanceTimezone,
    );
    const skillState = this.resolveSkillTurnState({
      run: input,
      chat,
      model,
      workspaceRoot,
      latestCompactionId: compaction?.id ?? null,
    });
    return {
      ...digest,
      chat,
      model,
      user,
      compaction,
      instanceTimezone,
      anchor,
      skillState,
    };
  }

  /**
   * This epoch's skill-catalog decision, from the deps the attempt's own
   * resolution and a checkpoint publication share: a checkpoint re-bakes the
   * epoch the next attempt is about to start, so both must resolve it from the
   * same catalog against the same marker.
   */
  private resolveSkillTurnState(input: {
    run: ExecuteRunInput;
    chat: Chat;
    model: SystemModelCatalogEntry;
    workspaceRoot: string | undefined;
    latestCompactionId: string | null;
  }): SkillTurnState {
    return resolveTurnSkillState(
      {
        skillCatalog: this.skillCatalog,
        skillDirectories: this.instanceConfig.config.skills.directories,
        ...(input.workspaceRoot !== undefined && {
          extraSources: workspaceSkillSources(input.workspaceRoot),
        }),
        // Operator-facing: an unreadable operator catalog is logged, never
        // shown to the model. Workspace-source failures are intentionally
        // isolated by SkillCatalog and produce no diagnostic.
        reportUnavailable: (diagnostics) =>
          this.logger.warn(
            `skill_catalog_unavailable: ${diagnostics.join(' ')}`,
          ),
      },
      {
        chat: input.chat,
        runId: input.run.runId,
        latestCompactionId: input.latestCompactionId,
        modelReferencesSkills: input.model.referencesSkills,
      },
    );
  }

  private async resolveAttemptDigest(input: {
    tx: Db;
    input: ExecuteRunInput;
    chatsRepo: ChatsRepository;
    chat: Chat;
  }): Promise<AttemptDigestContext> {
    let shareRecentChats = await this.memory.getForOwnerForBinding(
      input.tx,
      input.input.userId,
    );
    let digestCandidate: RecencyDigestResolution | undefined;
    if (shareRecentChats.shareRecentChats) {
      try {
        digestCandidate = await this.recencyDigest.resolveCandidate(
          input.input.userId,
          input.input.chatId,
        );
      } catch {
        // Candidate titles and excerpts are owner content; do not attach the
        // caught error to a log entry or execution error.
        this.logger.error('recency_digest_resolution_failed');
      }
      // Consent and the chat's digest epoch are both rechecked after candidate
      // resolution and before the prompt, receipt, and staged context are
      // prepared. Resolution reads the owner's other chats, so a compaction
      // checkpoint can publish a refreshed baseline in the meantime; a
      // candidate built from the superseded baseline must not reach the target
      // model. Compare by value: a jsonb column round-trips as a fresh object,
      // so identity would report a change on every turn.
      shareRecentChats = await this.memory.getForOwnerForBinding(
        input.tx,
        input.input.userId,
      );
      const recheckedChat = await input.chatsRepo.findById(
        input.input.chatId,
        input.input.userId,
      );
      const epochAdvanced =
        recheckedChat === undefined ||
        recheckedChat.recencyDigestRebakedFrom !==
          input.chat.recencyDigestRebakedFrom ||
        canonicalJson(recheckedChat.recencyDigestBaseline ?? null) !==
          canonicalJson(input.chat.recencyDigestBaseline ?? null);
      if (!shareRecentChats.shareRecentChats || epochAdvanced) {
        digestCandidate = undefined;
      }
    }

    const hadDigestBaseline = input.chat.recencyDigestBaseline !== null;
    let promptDigestBaseline = input.chat.recencyDigestBaseline;
    let recencyDigestInitialization: RecencyDigestInitialization | undefined;
    if (
      input.chat.recencyDigestBaseline === null &&
      digestCandidate !== undefined &&
      shareRecentChats.shareRecentChats
    ) {
      promptDigestBaseline = digestCandidate.baseline;
      recencyDigestInitialization = {
        baseline: digestCandidate.baseline,
        told: digestCandidate.told,
      };
    }

    let digestDelta: RecencyDigestDelta | null = null;
    if (
      hadDigestBaseline &&
      digestCandidate !== undefined &&
      input.chat.recencyDigestTold !== null &&
      shareRecentChats.shareRecentChats
    ) {
      digestDelta = deriveRecencyDigestDelta({
        candidate: digestCandidate,
        told: input.chat.recencyDigestTold,
        pinnedChatIds: await input.chatsRepo.findPinnedChatIds(
          input.input.userId,
          input.chat.recencyDigestTold.map(({ chatId }) => chatId),
        ),
      });
    }
    return {
      shareRecentChats,
      promptDigestBaseline,
      recencyDigestInitialization,
      digestDelta,
    };
  }

  private renderAttemptSystemPrompt(input: {
    model: SystemModelCatalogEntry;
    anchor: TemporalAnchor;
    user: PromptUserInput | undefined;
    chats: Chat['recencyDigestBaseline'];
    /** The frozen catalog baseline; undefined renders no skill section. */
    skills: SkillCatalogBaseline | undefined;
    admittedToolIds: ReadonlyArray<string>;
  }): string {
    const renderInput: SystemPromptRenderInput = {
      model: input.model,
      anchor: input.anchor,
      user: input.user,
      chats: input.chats ?? undefined,
      ...(input.skills !== undefined && { skills: input.skills }),
      admittedToolIds: input.admittedToolIds,
    };
    let rendered: string;
    if (input.chats === null) {
      rendered = this.systemPrompts.render(renderInput);
    } else {
      try {
        rendered = this.systemPrompts.render(renderInput);
      } catch {
        this.logger.error('recency_digest_render_failed');
        // Do not let a renderer error carry the owner's digest text out of
        // this boundary.
        throw new Error('Failed to render system prompt');
      }
    }
    if (rendered.trim().length === 0) {
      throw new ModelContextExecutionError('System prompt rendered empty.');
    }
    return rendered;
  }

  private async composeAttemptCatalog(
    tx: Db,
    input: ExecuteRunInput,
    prompt: AttemptPromptInputs,
    workspaceMcpKey: WorkspaceMcpKey | undefined,
  ): Promise<AttemptToolCatalog> {
    const allowedToolRules = this.instanceConfig.config.tools.allowed;
    const callTimeoutSeconds =
      this.instanceConfig.config.tools.callTimeoutSeconds;
    const codeOwnedCandidates = await this.knowledgeCandidates.resolve({
      tx,
      ownerUserId: input.userId,
      allowedToolRules,
    });
    const operatorCandidates = this.mcpRuntime.snapshotCandidates();
    const dynamicCandidates =
      workspaceMcpKey !== undefined && this.workspaceMcp !== undefined
        ? this.workspaceMcp.snapshotCandidates(
            workspaceMcpKey,
            operatorCandidates,
          )
        : operatorCandidates;
    return composeAttemptToolCatalog({
      allowedToolRules,
      callTimeoutSeconds,
      codeOwnedCandidates,
      dynamicCandidates,
      descriptionRenderer: ({ id, description, source, admittedToolIds }) => {
        if (source.type !== 'code_owned' || !isToolPromptId(id)) {
          return description;
        }
        return this.toolPromptRenderer.render({
          toolId: id,
          model: prompt.model,
          anchor: prompt.anchor,
          user: prompt.user,
          chats: prompt.promptDigestBaseline ?? undefined,
          admittedToolIds,
        });
      },
    });
  }

  private resolveAttemptEffectiveContext(
    prompt: AttemptPromptContext,
    catalog: AttemptToolCatalog,
  ): SystemPromptReceiptInput {
    return finalizeEffectiveContext({
      model: prompt.model,
      systemPrompt: prompt.systemPrompt,
      catalog,
    });
  }

  private async persistAttemptPromptReceipt(
    tx: Db,
    input: ExecuteRunInput,
    attemptId: string,
    receipt: SystemPromptReceiptInput,
  ): Promise<void> {
    // Keep the receipt publication behind the same owner/active-attempt fence
    // as every other attempt-owned write. Reassigning the identical UUID is a
    // deliberate no-op update that still makes a stale attempt return no row.
    const bound = await new RunsRepository(tx).updateForAttempt(
      input.runId,
      input.userId,
      attemptId,
      { activeAttemptId: attemptId },
    );
    if (!bound) {
      throw new ModelContextExecutionError(
        `Run ${input.runId} was reclaimed before receipt publication.`,
      );
    }
    await new SystemPromptReceiptsRepository(tx).create({
      ownerUserId: input.userId,
      runId: input.runId,
      attemptId,
      source: receipt.source,
      systemPrompt: receipt.systemPrompt,
      promptHash: receipt.promptHash,
    });
  }

  private async deriveAttemptStagedContext(input: {
    tx: Db;
    input: ExecuteRunInput;
    prompt: AttemptPromptContext;
    effectiveContext: AttemptToolCatalog;
  }): Promise<AttemptStagedContext> {
    const previousRun = (
      await new RunsRepository(input.tx).findMostRecentByMessageSequence(
        input.input.chatId,
        input.input.userId,
        {
          beforeSeq: input.input.userMessage.seq,
        },
      )
    )?.run;

    // The baseline is the most recent *successful* turn, not merely the most
    // recent one: a failed run publishes no context and never establishes an
    // epoch baseline, so a failed run between two successful turns must not
    // discard the availability state those turns established — nor may it
    // mask a compaction that landed after the last successful turn. No prior
    // run at all implies no completed predecessor, so the second lookup is
    // skipped rather than issued for an answer it cannot have.
    const previousCompletedRun =
      previousRun === undefined
        ? undefined
        : await new RunsRepository(
            input.tx,
          ).findMostRecentCompletedByChatMessageSequence(
            input.input.chatId,
            input.input.userId,
            { beforeSeq: input.input.userMessage.seq },
          );

    // Every newly active compaction checkpoint starts a new disclosure epoch,
    // judged against that same successful-turn baseline by sequence rather than
    // by time: a checkpoint published inside this Run's own attempt has a later
    // createdAt but a boundary above its predecessor's turn, and a retried
    // assistant row keeps its sequence (design D7). A failed attempt after the
    // checkpoint cannot silently keep the run inside the pre-compaction epoch.
    const startsEpoch =
      previousCompletedRun === undefined ||
      (input.prompt.compaction !== undefined &&
        input.prompt.compaction.uptoSeq >=
          previousCompletedRun.triggeringUserSeq);
    // The marker reports the re-bake to the first attempt that can publish
    // after it — the new epoch's first turn — so it rides the same boundary.
    const digestRebaked =
      startsEpoch &&
      input.prompt.chat.recencyDigestRebakedFrom ===
        input.prompt.compaction?.id;

    const stagedParts: Array<MessagePart> = [];
    // Model selection is established by any run (failed runs included), so the
    // switch item keeps reading the immediately preceding run, not the
    // successful baseline the availability/epoch comparison uses.
    if (previousRun && previousRun.modelId !== input.input.client.model) {
      // The previous run records the selected id alone, and the body names the
      // model that id belonged to, so it is resolved against the operator
      // catalog this service already reads at construction. A model the
      // catalog no longer carries is named by its bare id.
      const previousModel = this.instanceConfig.config.models.find(
        (model) => model.id === previousRun.modelId,
      );
      stagedParts.push(
        createModelChangeItem({
          oldModel: previousModel ?? { id: previousRun.modelId },
          newModel: input.prompt.model,
          runId: input.input.runId,
        }),
      );
    }
    const previousSuccessfulAvailability = startsEpoch
      ? undefined
      : (previousCompletedRun?.run.turnToolAvailability ?? undefined);
    const availabilityPayload =
      previousSuccessfulAvailability === undefined
        ? deriveToolAvailabilityPayload({
            current: input.effectiveContext.availabilityManifest,
          })
        : deriveToolAvailabilityPayloadFromStates({
            current: input.effectiveContext.availabilityManifest,
            previous: previousSuccessfulAvailability,
          });
    if (availabilityPayload) {
      stagedParts.push(
        createToolAvailabilityItem({
          runId: input.input.runId,
          payload: availabilityPayload,
        }),
      );
    }
    const workspaceContext = this.deriveWorkspaceContext({
      runId: input.input.runId,
      chat: input.prompt.chat,
      latestCompactionId: input.prompt.compaction?.id ?? null,
    });
    stagedParts.push(...workspaceContext.parts);
    const workspaceWrites = workspaceContext.writes;
    // Workspace items are rail-only and precede the skill catalog notice.
    // Their text never enters the system prompt.
    const skillNotice = input.prompt.skillState.notice;
    if (skillNotice !== undefined) {
      stagedParts.push(skillNotice.item);
    }
    if (
      digestRebaked &&
      input.prompt.chat.recencyDigestBaseline !== null &&
      input.prompt.shareRecentChats.shareRecentChats
    ) {
      stagedParts.push(
        createRecencyDigestSupersessionItem({ runId: input.input.runId }),
      );
    }
    if (input.prompt.digestDelta) {
      stagedParts.push(
        createRecencyDigestDeltaItem({
          runId: input.input.runId,
          payload: {
            entries: input.prompt.digestDelta.entries,
            pinChanges: input.prompt.digestDelta.pinChanges,
          },
        }),
      );
    }
    stagedParts.push(
      createTemporalItem({
        runId: input.input.runId,
        instant: new Date(),
        timeZone: input.prompt.instanceTimezone,
      }),
    );
    return {
      stagedParts,
      recencyDigestTold: input.prompt.digestDelta?.told,
      ...(workspaceWrites !== undefined && { workspaceWrites }),
      ...(input.prompt.skillState.told !== undefined && {
        // The decision hands back a readonly list; the column holds a mutable
        // array, so the value is copied rather than shared.
        skillCatalogTold: [...input.prompt.skillState.told],
      }),
    };
  }
  private deriveWorkspaceContext(input: {
    runId: string;
    chat: Chat;
    latestCompactionId: string | null;
  }): WorkspaceStagedContext {
    const currentRoot = input.chat.workspaceRoot;
    const latestCompactionId = input.latestCompactionId;
    const toldRoot =
      input.chat.workspaceToldFrom === latestCompactionId
        ? input.chat.workspaceTold
        : null;
    const rawDetachReason = input.chat.workspaceDetachReason;
    const detachReason =
      rawDetachReason !== null && isWorkspaceDetachReason(rawDetachReason)
        ? rawDetachReason
        : null;
    const parts: Array<MessagePart> = [];
    let writes: WorkspaceWrites | undefined;

    if (
      currentRoot !== toldRoot &&
      (currentRoot !== null || toldRoot !== null)
    ) {
      parts.push(
        createWorkspaceSnapshotItem({
          runId: input.runId,
          root: currentRoot,
        }),
      );
      writes = {
        told: currentRoot,
        toldFrom: latestCompactionId,
        clearDetachReason: detachReason !== null,
      };
    }
    if (detachReason !== null) {
      parts.push(
        createWorkspaceDetachNoticeItem({
          runId: input.runId,
          reason: detachReason,
        }),
      );
      writes ??= {
        told: currentRoot,
        toldFrom: latestCompactionId,
        clearDetachReason: true,
      };
    }
    return { parts, ...(writes !== undefined && { writes }) };
  }

  /**
   * Prepend staged context-item text to the triggering user message in the
   * model request. Extracts `data.text` from each `AuthoredContextItemPart`
   * and unshifts it into the last user message's content array.
   */

  private prependStagedContextItems(
    messages: ReturnType<typeof buildContext>['messages'],
    stagedParts: ReadonlyArray<MessagePart>,
  ): void {
    const textParts = stagedContextTexts(stagedParts);
    if (textParts.length === 0) return;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'user') continue;
      if (Array.isArray(msg.content)) {
        msg.content.unshift(...textParts);
      } else {
        // User content was a plain string; replace in-place with the text
        // parts array the SDK equally accepts.
        const original = msg.content;
        const combined = [
          ...textParts,
          { type: 'text' as const, text: original },
        ];
        Object.assign(msg, { content: combined });
      }
      return;
    }
  }
}

/**
 * The text an attempt's staged rail prepends to its triggering user message.
 * Shared by the request assembly and the compaction trigger's estimate, which
 * must measure the same text the model receives — the persisted rows do not
 * carry it until the turn completes.
 */
function stagedContextTexts(
  stagedParts: ReadonlyArray<MessagePart>,
): Array<{ type: 'text'; text: string }> {
  return stagedParts.flatMap((part) => {
    if (!isContextItemPart(part)) return [];
    const text = part.data.text;
    if (text === undefined || text.length === 0) return [];
    return [{ type: 'text' as const, text }];
  });
}
