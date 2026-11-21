import { realpath, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { BashProcessLimiter } from '@workspace/bash-executor';
import { isRecord, isString } from '@workspace/runtime-safety';

import {
  hostFilesEnabled,
  reconcileArtifactFiles,
  sweepArtifactDirectories,
} from '../tools/artifacts/host-files';
import { isBashTool } from '../tools/bash';
import { isHostBashCall } from '../tools/bash-target';
import { BASH_SETTLEMENT_GRACE_MS } from '../tools/bash-limits';
import { isCancelledBeforeExecution } from '../tools/cancelled-before-execution';
import { interruptFateOf } from '../tools/registry';
import { isNativeFileTool } from '../tools/native-files';
import { NativeFilesRepository } from './native-files-repository';
import {
  INTERRUPT_ABORT_REASON,
  newSegmentControl,
  RunAbortRegistry,
  type RunSegmentRegistrar,
} from './run-abort-registry';
import {
  abortedByInterrupt,
  closedTelemetry,
  deliverPendingSteering,
  persistFirstEpochBaselines,
  type BoundaryDelivery,
  type DeliveredBoundary,
  type DeliveryInput,
  type FirstEpochBaselines,
} from './segment-delivery';
import { machineAttemptKey } from './machine-attempt';
import { probeMachinePromptTarget } from './machine-prompt-probe';
import {
  decideMachineWorkspace,
  detachedBinding,
  machineAvailabilityNarration,
  machineInstructionAvailability,
  machineInstructionWorld,
  type MachineWorkspaceState,
} from './machine-workspace';
import { MachineConnector } from '../machines/machine-connector.service';
import { ExecutorGit } from '../machines/executor-git.service';
import { parseMachineExecutorId } from '../machines/machine-locator';
import {
  createSshClient,
  SSH_CLIENT_FACTORY,
  type SshClient,
  type SshClientFactory,
} from '../ssh/ssh-client';
import { statHostPath } from '@workspace/native-file-tools';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  tool,
  type LanguageModelUsage,
  type ProviderMetadata,
  type ToolSet,
} from 'ai';

import { and, eq } from 'drizzle-orm';
import {
  canonicalJson,
  compareCodePoints,
  hashWithDomain,
} from '../canonical-json';
import { errorMessageWithoutParams, loggableError } from '../db/loggable-error';
import { pgErrorCode } from '../db/pg-error';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  runs,
  type Chat,
  type FollowUpAction,
  type Message,
  type ModelToolDeclaration,
  type Run,
  type AwaitingQuota,
  type QuotaResumeAt,
  type SkillCatalogBaseline,
  type TurnToolAvailabilityEntry,
} from '../db/schema';
import {
  buildContext,
  isReasoningPart,
  isTextPart,
  partsToText,
  projectStoredReplyParts,
  userPartsToModelContent,
  type ModelRequestContext,
  type MessagePart,
} from '../chats/context-builder';
import {
  type PromptUserInput,
  type SystemModelCatalogEntry,
} from '../models/model-catalog';
import {
  type ModelClient,
  type ModelRequestRetry,
  type SdkRefusal,
} from '../models/model-client';
import { wrapStreamTextResult } from '../models/stream-text-result-proxy';
import { ProviderFailure } from '../models/provider-failure/provider-failure';
import type { ProviderFailureSuperseded } from '../models/provider-failure/provider-failure';
import type { SupersededModelOutput } from './superseded-output';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { createJobNoticeContext } from './job-notice-context';
import {
  discardedJobNoticeIds,
  sourceSegmentJobNoticeIds,
} from './job-notice-recovery';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import {
  CompactionQuotaWait,
  compactionQuotaWait,
} from '../compaction/compaction-quota-wait';
import {
  readCompactionSet,
  type CompactionSet,
} from '../compaction/boundary-compaction';
import {
  automaticBoundaryThresholdReached,
  compactionAttemptStarted,
} from '../compaction/automatic-boundary-trigger';
import { toRunUserMessage } from '../chats/chat-message-parts';
import { type CheckpointMessage } from '../chats/messages-repository';
import { RunningReplyRepository } from '../chats/running-reply-repository';
import {
  CompactionService,
  type CompactionCapability,
  type CompactionSummary,
} from '../compaction/compaction.service';
import {
  countedContextTokens,
  estimateContinuationTokens,
  estimateModelRequestTokens,
  mediaOverflowCompacts,
  planCompactionCheckpoint,
  requestFitsContextWindow,
  resolveCompactionThreshold,
  toStoredMessages,
  type CompactionPlan,
} from '../compaction/compaction';
import {
  mediaResultRef,
  loadMediaSizing,
  submittedLocator,
  collectMediaRefs,
  isUnstoredMedia,
  type MediaAdmissionContext,
  type MediaSizing,
  type ReadMediaRef,
  type ToolMediaRef,
} from '../media/epoch-admission';
import { mediaLocator, parseMediaLocator } from '../media/media-locator';
import { MediaService } from '../media/media.service';
import {
  boundRetained,
  exceededEntry,
  mergeRetainedMedia,
  type RetainedMedia,
  type RetainedSettlement,
} from '../media/attempt-media';
import {
  continuedMediaKey,
  retainedPartsBase64,
  type RetainedMediaJson,
} from '../media/retained-media';
import { createToolMediaStore } from '../media/tool-media-store';
import {
  createRunMediaResolver,
  fileAttachmentLines,
  fileMediaIds,
  type RunMediaResolver,
} from '../media/media-descriptors';
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
  createCompactionCheckpointPart,
  toContextCheckpoint,
} from '../chats/context-item-producers';
import {
  isContextItemPart,
  type AuthoredContextItemPart,
} from '../chats/context-item';
import { createRegenerateNoticeItem } from '../chats/regenerate-notice';
import { createProviderFailureItem } from '../chats/provider-failure-notice';
import {
  createInterruptedItem,
  stoppedCallsOf,
  type StoppedCall,
} from '../chats/interrupted-notice';
import { isModelSwitchItem } from '../chats/accepted-turn-parts.repository';
import {
  continueStateFromEvents,
  continueStepOffset,
  type ContinueState,
} from '../chats/continue-projection';
import {
  boundaryStepBudgetUsed,
  readCompactionStepBudget,
} from './compaction-step-budget';
import { createDeltaBuffer } from './delta-buffer';
import {
  createAssistantPartCollector,
  toolActivityPart,
} from './assistant-transcript';
import {
  MAX_ADDRESS_DECISIONS,
  MAX_DERIVED_DECISIONS,
} from './run-event-payload';
import {
  finalizeRunReply,
  ownsLiveReply,
  persistReply,
  runningReplyUsage,
  turnStatusForTerminalRun,
  type AssistantTurnTelemetry,
  type AssistantTurnWrite,
} from './run-reply-finalizer';
import { markCompactItemsDelivered } from './mark-compact-items-delivered';
import {
  currentSegmentState,
  findEarlierSegmentBaseline,
} from './run-segment-queries';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { type ProductIdentityReader } from '../instance-config/product-identity';
import { configuredCredentials } from '../instance-config/configured-credentials';
import { resolveConfigPath } from '../instance-config/config-loader';
import {
  createToolPromptRenderer,
  type PromptChatsDisclosure,
  type PromptWebSearchInput,
  type RenderedPrompt,
  type ToolPromptRenderer,
} from '../instance-config/prompt-loader';
import {
  invalidCallResult,
  previewToolPermission,
  refusalResult,
  runTool,
} from '../tools/runner';
import { toFlexibleSchema } from '../tools/schema-utils';
import { splitToolIntent, withoutToolIntents } from '../tools/tool-intent';
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
  ORIGIN_PROMPT_IMPORT,
  ORIGIN_SKILL_ACTIVATION,
  type ToolActivityOrigin,
} from './tool-activity-origin';
import { activateSkills } from '../skills/skill-activation';
import { parseSkillMentions } from '../skills/skill-mention';
import { ActivationPartsRepository } from '../chats/activation-parts.repository';
import {
  AcceptedTurnPartsRepository,
  placeAcceptedTurnItems,
  type AcceptedTurnPlacement,
} from '../chats/accepted-turn-parts.repository';
import { PromptImportPartsRepository } from '../chats/prompt-import-parts.repository';
import {
  createPromptImportsItem,
  promptImportMarkerCount,
  promptImportMediaKey,
} from '../chats/prompt-imports-item';
import {
  PROMPT_IMPORT_KNOWLEDGE_CANCELLED,
  PROMPT_IMPORT_WORK_MS,
  resolvePromptImports as resolvePromptImportTargets,
  type PromptImportRequest,
} from '../prompt-imports/prompt-imports';
import {
  derivePromptImportTriggers,
  type PromptImportTriggerGates,
} from '../prompt-imports/prompt-import-triggers';
import { nativeReadTool } from '../tools/native-files';
import {
  type InterruptFate,
  type KnowledgeToolResolver,
  type MachineStatusReader,
  type Tool,
  type ToolClassification,
  type ToolContext,
  type ToolResult,
} from '../tools/types';
import {
  modelToolOutput,
  renderToolResultForModel,
  renderToolResultText,
} from '../tools/model-text';
import { MachinesService } from '../machines/machines.service';
import { KnowledgeFilesystemError } from '../knowledge/knowledge-filesystem';
import {
  formatKnowledgeLocator,
  KNOWLEDGE_LOCATOR_SCHEME,
  parseKnowledgeLocator,
  resolveKnowledgeLocator,
} from '../knowledge/knowledge-locator';
import { createKnowledgeInstructionProbe } from '../knowledge/knowledge-instruction-probe';
import { KnowledgeToolRuntimeResolver } from '../knowledge/knowledge-tool-runtime-resolver';
import { SkillCatalog, type SkillCatalogPort } from '../skills/skill-catalog';
import {
  interruptSettlementOf,
  toolTerminationMessage,
  toolTerminationResult,
} from './tool-settlement';
import {
  RunEventsRepository,
  RunsRepository,
  type CompletedRunWithTrigger,
  type RunEventType,
} from './runs-repository';
import { RunRowFenceRepository } from './run-row-fence.repository';
import {
  IN_RUN_CONTEXT_PRODUCER,
  createInRunContextItems,
  composeAttemptProducers,
  type InRunAttemptProducer,
  type InRunAttempt,
  type InRunGitWorld,
  type InRunContextProducer,
  type PromptImportTrigger,
} from './in-run-context-items';
import type { ReadPage } from '../instructions/instruction-files';
import { instructionsSeenPaths } from '../chats/instructions-item';
import { GIT_CONTEXT_PRODUCER } from '../git-state/git-context-producer';
import { gitToldState, type GitToldState } from '../git-state/git-item';
import { observeWorkspaceRoot } from '../git-state/git-observe-root';
import { GitSnapshotService } from '../git-state/git-snapshot.service';
import { modelGitAdmission } from '../git-state/model-git-admission';
import { type GitObservation } from '../git-state/git-state-view';
import { placeRailPart, refreshTurnGit, type TurnGit } from './turn-git';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';
import { readCreatedFlags } from './run-created-flags';
import { finalizeUsageCompleteness } from './usage-completeness';
import { TitleService, type TitleCapability } from '../titles/title.service';
import {
  aggregateTurnTelemetry,
  emitCompletedTurnTelemetryLog,
  turnTelemetryLogger,
  type TurnTelemetry,
} from '../chats/turn-telemetry';
import {
  DYNAMIC_TOOL_EXECUTOR_RESOLVER,
  type BoundExecutableTool,
  type DynamicToolExecutorResolver,
  constrainDynamicToolResolver,
  resolveBoundExecutableTools,
} from './snapshot-tool-execution';
import {
  ContextIncompatibleError,
  ModelContextExecutionError,
} from './model-context-errors';
import { modelRequestFailure } from './model-request-failure';
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
  type ModelClientFactory,
  type ModelSelectionValidator,
} from '../models/models.service';
import {
  DecisionsService,
  type DecisionJudge,
} from '../decisions/decisions.service';
import {
  KnowledgeToolCandidateResolver,
  type KnowledgeToolCandidateResolverPort,
} from '../knowledge/knowledge-tool-candidate-resolver';
import { McpRuntimeService } from '../mcp/mcp-runtime.service';
import {
  WorkspaceMcpClients,
  type WorkspaceMcpKey,
  type WorkspaceMcpListingCell,
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
  disclosedRecencyDigestEntries,
  type RecencyDigestDelta,
  type RecencyDigestResolution,
  type RecencyDigestResolver,
} from '../chats/recency-digest.service';
import { isToolPromptId } from '../prompts/tool-descriptions';
import { webSearchEngineItems } from '../tools/web-search/catalog';
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
import { decidePermission } from '../tools/permissions/admit';
import { isTerminalRunStatus, type TerminalRunStatus } from './run-status';
import { promoteNextQueueItem } from './queue-promotion';
import { RunDispatchService, type RunDispatcher } from './run-dispatch.service';
import { type RunJob } from './run-queues';
import { parseJobLocatorText } from '../jobs/job-locator';
import { retryRunTransaction } from './run-transaction';
import { RunWaitService } from './run-wait.service';
import {
  completeWaitInTransaction,
  clearQuotaAwaitingInTransaction,
  pendingWakeInTransaction,
} from './run-wait-completion';
import { wakeStateFromEvents } from './wake-projection';
import {
  quotaWakeStateFromEvents,
  quotaCompactionStateFromEvents,
  quotaRequestFromEvents,
  quotaResumeAttemptId,
  type QuotaRequestState,
} from './quota-wake-projection';
import { quotaWaitForFailure } from './quota-wait';
import { MAX_SENDS, retryable } from '../models/request-recovery';
import { WAIT_SUSPENSION, type WaitRequest } from '../tools/wait-suspension';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { BashJobRegistry } from '../jobs/bash-job-registry';
import { workerDeadAfterSeconds } from '../jobs/worker-liveness';
import {
  formatTemporalAnchor,
  resolveInstanceTimezone,
  type TemporalAnchor,
} from '../prompts/temporal-anchor';

import { JobNoticeRunService } from './job-notice-run.service';

/**
 * The skill-catalog baseline a turn that starts an epoch freezes, with the told
 * state it establishes. Applied by the terminal transaction of the attempt that
 * completes the turn: the baseline lives only in the system prompt, so no
 * history item accompanies it and a losing attempt must never freeze it.
 */

export type SkillCatalogFreeze = NonNullable<SkillTurnState['freeze']> & {
  readonly told: NonNullable<Chat['skillCatalogTold']>;
};

type WorkspaceWrites = {
  readonly told: Chat['workspaceTold'];
  readonly toldFrom: Chat['workspaceToldFrom'];
  readonly clearDetachReason: boolean;
  /**
   * The Machine availability this write narrated. Only the availability
   * notice passes one, so an ordinary snapshot leaves the recorded state
   * alone and the next attempt compares against what was actually told.
   */
  readonly available?: boolean;
};

type WorkspacePreparation = {
  readonly root: string | undefined;
  readonly chat: Chat | undefined;
  readonly detaching: boolean;
  /** The bound Machine Workspace's Machine; absent for a local binding. */
  readonly machine?: MachineWorkspaceState;
};

type PromptImportStep = {
  readonly input: ExecuteRunInput;
  readonly attemptId: string;
  readonly nativeDeliverySequence: number;
  readonly workspaceRoot: WorkspaceRootCell;
  readonly effectivePermissionMode: PermissionMode;
  readonly skillSelection: ReadonlySet<string>;
  readonly detaching: boolean;
  /** The attempt's retained media, keyed by marker. */
  readonly retainedMedia: Map<string, RetainedMedia>;
  /** Whether this Run follows up an earlier Run of the same turn. */
  readonly followUp: boolean;
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
  /**
   * The turn's audited HOST page reader; undefined when the `read` gate or the
   * native executor bars host instruction files.
   */
  readonly readPage: ReadPage | undefined;
  /** The Knowledge world; undefined without `read` and a Knowledge root. */
  readonly knowledge: InRunAttempt['knowledge'];
  /** The Machine world; undefined without `read` and a configured Machine. */
  readonly machines: InRunAttempt['machines'];
  /** Preview the read permission without recording an audit event. */
  readonly admitsRead: ((path: string) => boolean) | undefined;
  /**
   * The admitted local targets of the Run's persisted prompt imports, each
   * loading like a native `read` of its path; none on a detaching attempt.
   */
  readonly promptImportTriggers: ReadonlyArray<PromptImportTrigger>;
  /** Allocates the attempt-scoped tool-call id of one audited read. */
  readonly nextToolCallId: () => string;
  part: AuthoredContextItemPart | undefined;
  seenCanonicalPaths: ReadonlySet<string>;
};

/** Context resolved inside the worker transaction before the model request. */
type PreparedAttemptContext = ModelRequestContext & {
  /** Receipt-only data persisted before target-model I/O. */
  effectiveContext: SystemPromptReceiptInput;
  /** The bound model catalog entry this pass resolved and rendered for. */
  model: SystemModelCatalogEntry;
  toolCatalog: AttemptToolCatalog;
  /** The accepted-turn items this attempt's dispatch transaction stores. */
  stagedParts: Array<MessagePart>;
  /** Where the dispatch transaction places `stagedParts` on the trigger. */
  placement: AcceptedTurnPlacement;
  /**
   * Whether the dispatch transaction drops the stored model-switch items from
   * the trigger first — the first dispatch of a Regenerate Run, whose own
   * comparison replaces the item an earlier Run stored (turn-actions D8). The
   * request drops them too, so the model never reads both.
   */
  removesModelSwitch: boolean;
  /**
   * The triggering user row's stored parts as this pass read them; undefined
   * when the history it read lacks the row, so the request has no message of
   * its own to carry the items.
   */
  triggerParts: ReadonlyArray<unknown> | undefined;
  /** The stored rows this request was built from; the trigger plans on them. */
  historyRows: Array<Message>;
  /**
   * The active checkpoint for this attempt — always the latest one whose
   * absorbed-through sequence is below the triggering user message's, so the
   * prompt anchor, the skill and workspace epochs, and the history cut all read
   * one boundary.
   */
  latestCheckpoint: CheckpointMessage | undefined;
  /** Canonical instruction paths the effective history already discloses. */
  seenInstructionPaths: ReadonlySet<string>;
  /** What the effective history told about git, and the root it leaves bound. */
  toldGit: GitToldState;
  /** First digest baseline; written only by the attempt that completes. */
  recencyDigestInitialization?: RecencyDigestInitialization;
  /** Written by the dispatch transaction, with the items it stores. */
  recencyDigestTold?: NonNullable<Chat['recencyDigestTold']>;
  /** First-epoch catalog baseline; written only by the attempt that completes. */
  skillCatalogFreeze?: SkillCatalogFreeze;
  /** Written by the dispatch transaction that stores the catalog notice. */
  skillCatalogNoticeTold?: NonNullable<Chat['skillCatalogTold']>;
  /** Written by the dispatch transaction that stores the workspace items. */
  workspaceWrites?: WorkspaceWrites;
  untitled: boolean;
};

function boundaryCompactionPlan(
  context: PreparedAttemptContext,
  triggeringUserSeq: number,
): (CompactionPlan & { uptoSeq: number }) | null {
  const { historyRows: rows, latestCheckpoint } = context;

  const plan = planCompactionCheckpoint({
    rows: toStoredMessages(rows),
    boundarySeq: latestCheckpoint?.absorbedThroughSeq ?? 0,
    triggeringUserSeq: triggeringUserSeq + 1,
  });

  return plan === null
    ? null
    : { ...plan, uptoSeq: Math.max(0, ...rows.map((row) => row.seq)) + 1 };
}

type CompactionTriggerInput = {
  run: ExecuteRunInput;
  prepared: PreparedExecutionContext;
  stagedParts: ReadonlyArray<MessagePart>;
  historyRows: ReadonlyArray<Message>;
  /** The kept steps a Continue request adds after the trigger (D5). */
  keptMessages: ReadonlyArray<ModelRequestContext['messages'][number]>;
  /** The media references those kept steps add, counted from `keptMessages`. */
  keptRefCount: number;
  boundarySeq: number;
  /** The prepared request's media sizing for the attempt model (vision-media D6). */
  media: MediaSizing | undefined;
};

/**
 * Everything the Run sends on its first model step (design D5): the request the
 * attempt actually dispatches, its prepared context, and the turn instructions
 * that complete it.
 */
type PreparedFirstStep = {
  readonly request: PreparedExecutionContext;
  readonly context: PreparedAttemptContext;
  readonly turnInstructions: TurnInstructions;
  readonly turnGit: TurnGit;
  readonly preStepCompactionStarted: boolean;
};

type AttemptDigestInputs = {
  shareRecentChats: ResolvedMemorySettings;
  promptDigestBaseline: Chat['recencyDigestBaseline'];
  /** Present only under consent and an unchanged digest epoch. */
  digestCandidate: RecencyDigestResolution | undefined;
};

/** Digest state derived from what this attempt's renders actually emitted. */
type AttemptDigestDisclosure = {
  recencyDigestInitialization?: RecencyDigestInitialization;
  digestDelta: RecencyDigestDelta | null;
};

type AttemptPromptInputs = AttemptDigestInputs & {
  chat: Chat;
  model: SystemModelCatalogEntry;
  user: PromptUserInput | undefined;
  checkpoint: CheckpointMessage | undefined;
  instanceTimezone: string;
  anchor: TemporalAnchor;
  /** This turn's skill-catalog decision: the rendered baseline and the notice. */
  skillState: SkillTurnState;
};

type AttemptPromptContext = AttemptPromptInputs &
  AttemptDigestDisclosure & {
    systemPrompt: string;
  };

type AttemptStagedContext = {
  stagedParts: Array<MessagePart>;
  placement: AcceptedTurnPlacement;
  /** Whether the dispatch drops the stored model-switch items before storing. */
  removesModelSwitch: boolean;
  recencyDigestTold?: NonNullable<Chat['recencyDigestTold']>;
  skillCatalogNoticeTold?: NonNullable<Chat['skillCatalogTold']>;
  workspaceWrites?: WorkspaceWrites;
};

/** The turns an attempt's staged items are judged against. */
type DisclosureBaseline = {
  /** This Run's availability record, written once an attempt dispatched. */
  readonly ownAvailability: Run['turnToolAvailability'];
  /** `usage.modelId` of the latest prior reply in the Chat (design D5). */
  readonly previousReplyModelId: string | undefined;
  /** The most recent dispatched predecessor turn (design D11). */
  readonly previousDispatched: CompletedRunWithTrigger | undefined;
  /** Whether an earlier Run of this same turn dispatched (turn-actions D8). */
  readonly priorTurnDispatched: boolean;
  /** Whether this turn opens a new disclosure epoch (design D7). */
  readonly startsEpoch: boolean;
};

type CompactionCompletionInput = {
  runId: string;
  chatId: string;
  userId: string;
  attemptId: string;
  expectedQueueIdentity: NonNullable<FinishRunInput['expectedQueueIdentity']>;
  summary: CompactionSummary | undefined;
  abortSignal: AbortSignal;
  focus: string | null;
  quotaRequest?: QuotaRequestState;
};

type FinishRunInput = {
  userId: string;
  runId: string;
  status: TerminalRunStatus;
  attemptId?: string;
  /** Fence a queue-originated terminal write by its observed queue identity. */
  expectedQueueIdentity?: {
    currentJobId: string | null;
    wakeGeneration: number;
  };
  modelCompleted?: {
    usage?: unknown;
    finishReason: unknown;
    telemetry?: AssistantTurnTelemetry;
  };
  runPayload?: unknown;
  error?: unknown;
  assistantTurn?: AssistantTurnWrite;
  synthesizedTurnTelemetry?: AssistantTurnTelemetry;
  recencyDigestInitialization?: RecencyDigestInitialization;
  skillCatalogFreeze?: SkillCatalogFreeze;
  boundaryCompaction?: NonNullable<DeliveryInput['boundaryCompaction']>;
  quotaRequest?: QuotaRequestState;
  stepBudgetUsed?: number;
  /**
   * The cut a failed send left, written in this terminal transaction
   * (continue-after-broken-send D6): the reply already holds the kept parts
   * and the notice, and this event names the dropped output.
   */
  superseded?: SupersededModelOutput;
};

type FinishRunResult =
  | {
      outcome: 'won' | 'errored';
      assistantMessage?: Message;
      /** The Run a completed Run's transaction created for a queue item. */
      promoted?: RunJob;
    }
  | { outcome: 'lost'; finalStatus?: string; assistantMessage?: Message }
  | {
      /**
       * A pending item kept the Run live: the segment's reply is closed and
       * the Run moved onto the delivered message under a new attempt.
       */
      outcome: 'delivered';
      assistantMessage?: Message;
      delivery: DeliveredBoundary;
    };

function hasNoCommittedAssistantTurn(finish: FinishRunResult): boolean {
  return (
    (finish.outcome === 'errored' && !finish.assistantMessage) ||
    (finish.outcome === 'lost' && finish.finalStatus !== 'expired')
  );
}

function startsAutomaticCompaction(
  firstSegment: boolean,
  wakeCompaction: boolean,
): boolean {
  return firstSegment && !wakeCompaction;
}

function completesBoundaryCompaction(
  status: TerminalRunStatus,
  wakeCompaction: boolean,
): boolean {
  return status === 'completed' && !wakeCompaction;
}

/**
 * The identity of a boundary summary's request prefix: the exact system prompt
 * and tool declarations it would send. A resumed summary compares this against
 * the fingerprint its suspension stored, because a wake attempt rebuilds both
 * from current configuration — substituting either would summarize under a
 * prefix the original answer never rendered.
 */
export function compactionSummaryPrefixFingerprint(input: {
  system: string;
  toolDeclarations: ReadonlyArray<ModelToolDeclaration>;
}): string {
  return hashWithDomain(
    'llame:compaction:summary-prefix:v1',
    canonicalJson({
      system: input.system,
      toolDeclarations: input.toolDeclarations,
    }),
  );
}

/** The assembled context+tools an execution attempt runs against. */
type PreparedExecutionContext = {
  system: string;
  messages: ModelRequestContext['messages'];
  untitled: boolean;
  toolDeclarations: Array<ModelToolDeclaration>;
  tools: Array<BoundExecutableTool>;
};

export type RunClaimInput = {
  runId: string;
  chatId: string;
  userId: string;
  abortSignal?: AbortSignal;
  expectedQueueIdentity?: {
    currentJobId: string | null;
    wakeGeneration: number;
  };
};

export type RunClaimResult =
  | { settledReply: Message | undefined }
  | { nativeRecovery: true; attemptId: string }
  | {
      effort?: string;
      permissionMode: Run['permissionMode'];
      attemptId: string;
      messageId: string | null;
      nativeDeliverySequence: number;
      wakeState?: ContinueState;
      quotaRequest?: QuotaRequestState;
      quotaWake?: boolean;
    };

type ExecuteRunInput = {
  runId: string;
  chatId: string;
  userId: string;
  userMessage: RunUserMessage;
  client: ModelClient;
  abortSignal?: AbortSignal;
  /**
   * The follow-up action that started this Run, read from its row at pickup:
   * only a Continue Run resumes kept parts, so every other Run skips that read.
   */
  followUpAction?: FollowUpAction | null;
  /** Identity observed by a queue worker at pickup; direct callers omit it. */
  expectedQueueIdentity?: {
    currentJobId: string | null;
    wakeGeneration: number;
  };
};

type ExecuteAttemptInput = {
  input: ExecuteRunInput;
  nativeAbort: AbortController | undefined;
  effort: string | undefined;
  permissionMode: PermissionMode;
  attemptId: string;
  nativeDeliverySequence: number;
  firstSegment: boolean;
  wakeState?: ContinueState;
  quotaRequest?: QuotaRequestState;
  quotaWake: boolean;
  createdMessage: RunUserMessage;
};

type PreparedAttemptExecution = {
  startDelivered: (delivery: DeliveredBoundary) => Promise<AttemptRun>;
  quotaRequest?: QuotaRequestState;
  stepBudgetOffset: number;
  wakeStepOffset: number;
  compactionDisabledAtStart: boolean;
  continued: ContinueState | undefined;
  effectivePermissionMode: PermissionMode;
  wakeCompactionSet: CompactionSet | undefined;
  wakeCompaction: boolean;
  workspaceRoot: ReturnType<typeof createWorkspaceRootCell>;
  workspaceMcpKey: WorkspaceMcpKey | undefined;
  workspaceMcpListing: WorkspaceMcpListingCell;
  skillSelection: ReadonlySet<string>;
  media: RunMediaResolver;
  prepared: PreparedExecutionContext;
  attemptContext: PreparedAttemptContext;
  compactionStartedThisAttempt: boolean;
  compactionThreshold: number;
  turnInstructions: TurnInstructions;
  turnGit: TurnGit;
};

type AttemptPreparationOutcome =
  | { kind: 'ready'; execution: PreparedAttemptExecution }
  | { kind: 'delivered'; attempt: AttemptRun };

type QuotaResumeAttemptResult =
  | { kind: 'delivered'; attempt: AttemptRun }
  | { kind: 'continue'; compactionFailure?: 'automatic' | 'manual' };

type ModelStreamResult = ReturnType<ModelClient['streamText']>;

type ConsumeStreamOptions = Parameters<ModelStreamResult['consumeStream']>[0];

/**
 * One model call of an attempt and what it hands on. `nextCall` returns the
 * following call or segment when this call ended at a step boundary instead of
 * the Run; the segment loop starts it once this call is drained (run-steering
 * D3).
 */
type AttemptRun = {
  result: ModelStreamResult;
  nextCall: () => Promise<AttemptRun> | undefined;
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
 * The dispatch found the reply already completed: a salvaged answer stored it
 * while the Run stayed live. The dispatch transaction rolls back on it.
 */
class ReplyAlreadyCompletedError extends Error {
  constructor(readonly runId: string) {
    super(`Run ${runId} already has a completed reply.`);
    this.name = 'ReplyAlreadyCompletedError';
  }
}

/**
 * The dispatch found a cancellation recorded on the Run: no request of this
 * attempt goes out. The dispatch transaction rolls back on it.
 */
class CancellationRecordedError extends Error {
  constructor(readonly runId: string) {
    super(`Run ${runId} records a cancellation.`);
    this.name = 'CancellationRecordedError';
  }
}

function noop(): void {}

/** What a step end finds, or nothing: the Run's own record decides (D3). */
type StepEndSignal = 'cancel' | 'delivery' | 'suspend' | undefined;

/**
 * The decided cause of a failed step's boundary: the Run's own record, or the
 * step-boundary compaction that step owes (D4 step 3).
 */
type FailedStepCause = StepEndSignal | 'compact';

/** The status a failed send's Run ends with: a completed Run never failed. */
type FailedSendStatus = Exclude<TerminalRunStatus, 'completed'>;

/**
 * Where a send's kept output ends, captured at its last complete tool-call
 * part (continue-after-broken-send D3): the sequence a `model.superseded`
 * event names, and how many text and reasoning parts the reply held through
 * that part.
 *
 * The count, never an array index: a call's part is a `pending-tool` slot that
 * `parts()` hides until the call settles, and settling replaces it in place —
 * so an index taken before that shifts every part after it, while text and
 * reasoning parts are only ever appended and keep their order.
 */
type CutAnchor = {
  readonly sequence: Promise<number>;
  readonly keptOutput: number;
};

/** A send that failed after it streamed a complete tool-call part (D1). */
type FailedSend = {
  readonly failure: ProviderFailure;
  /** The reply-wide step that failed, in the call's own numbering. */
  readonly step: number;
  readonly anchor: CutAnchor;
};

/** The cut a failed send leaves: its window, and the notice to store (D3). */
type FailedSendCut = {
  readonly superseded: SupersededModelOutput;
  readonly notice: AuthoredContextItemPart;
};

/**
 * The result of a `wait` call whose send failed after a started call (A7): the
 * wait never opened, so the Run does not suspend for it.
 */
const FAILED_WAIT_RESULT: ToolResult = {
  status: 'error',
  type: 'cancelled',
  message:
    'The wait did not start, because the provider failed. Call `wait` again if you still need it.',
};

/**
 * Whether the failed send's request continues under the shared count (D4): a
 * send is left before the cap, and the shipped in-process rule retries this
 * class now — a quota or rate limit within a minute counts as one.
 */
function continuesFailedSend(failure: ProviderFailure): boolean {
  return (
    failure.sends !== undefined &&
    failure.sends < MAX_SENDS &&
    retryable(failure, Date.now())
  );
}

/** The Run's own signal, with a call's interrupt signal when its fate is `cancel`. */
function callAbortSignal(
  run: AbortSignal | undefined,
  interrupt: AbortSignal | undefined,
): AbortSignal | undefined {
  if (run === undefined) return interrupt;

  return interrupt === undefined ? run : AbortSignal.any([run, interrupt]);
}

const noNextCall: AttemptRun['nextCall'] = () => undefined;

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
export function expiredRunMessage(signal: AbortSignal | undefined): string {
  return signal?.reason === RUN_CEILING_ABORT_REASON
    ? 'Run reached the 23 h 55 m execution ceiling.'
    : 'Run timed out: exceeded its wall-clock budget.';
}

function terminalStatus(
  signal: AbortSignal | undefined,
  finishReason: string,
  stopped: string | undefined,
): TerminalRunStatus {
  if (signal?.aborted) return classifyAbortedRun(signal);

  if (finishReason === 'error') return 'failed';

  if (stopped === 'cancel') return 'cancelled';

  return 'completed';
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
 *
 * `read-only` never downgrades: a process that has withdrawn it from
 * `tools.permissionModes` would widen a queued Run if it resolved `default`,
 * and all processes run one release, so every worker knows the mode. The
 * enabled list gates acceptance at the API, not execution.
 */
export function resolveEffectivePermissionMode(
  accepted: PermissionMode,
  workerModes: ReadonlyArray<PermissionMode>,
): PermissionMode {
  if (accepted === 'read-only') return 'read-only';

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

export type RecencyDigestInitialization = {
  baseline: NonNullable<Chat['recencyDigestBaseline']>;
  told: NonNullable<Chat['recencyDigestTold']>;
};

function toTurnToolAvailability(
  manifest: AttemptToolCatalog['availabilityManifest'],
): Array<TurnToolAvailabilityEntry> {
  return [...manifest.entries]
    .map(({ id, state }) => ({ id, state }))
    .sort((left, right) => compareCodePoints(left.id, right.id));
}

/** A durably recorded tool request, with safe decision metadata once admitted. */
type ToolRequestedEventPayload = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  intent?: string;
  /**
   * The AI SDK step that requested this call. A Continue Run groups the kept
   * parts by it, so two sequential steps with no text between them stay two
   * steps (turn-actions D6).
   */
  stepNumber: number;
  permission?: PermissionDecision;
  /** Absent means model-origin; see tool-activity-origin.ts. */
  origin?: ToolActivityOrigin;
  /**
   * The call's opaque provider metadata (design A7), copied to its stored tool
   * part by the event-log rebuild so a later request sends it back unchanged.
   */
  providerMetadata?: ProviderMetadata;
};

/** A durably recorded tool completion, carrying the decision for history. */
type ToolCompletedEventPayload = {
  toolCallId: string;
  toolName: string;
  status: ToolResult['status'];
  output: ToolResult;
  /** Private server-side receipt; deliberately outside the model output. */
  consumedJobNoticeIds?: Array<string>;
  /** An owner interrupt settled the call (run-steering D7). */
  interrupted?: true;
  permission?: PermissionDecision;
  /**
   * Decisions on locators other than the submitted one: a web read's derived
   * locators (redirect hops, announced alternates, suffix and `llms.txt`
   * candidates), `enter_workspace`'s canonical root, and an instruction
   * import's canonical path. Each carries the
   * kind of locator it judged. Recorded with the completion because a web
   * read's are not known until the executor has run; owner-scoped like
   * `permission`, and never part of the model-visible result.
   */
  derivedDecisions?: ReadonlyArray<DerivedDecisionRecord>;
  /** Mirrors the request's origin, so recovery needs no second lookup. */
  origin?: ToolActivityOrigin;
  /**
   * The bytes a model `read` of an unstored file keeps beside its result, or
   * the record that its message bound is exceeded (`media-attachments`). The
   * event-log rebuild copies it into the reply's tool part.
   */
  retainedMedia?: RetainedMediaJson;
  /**
   * What the AI SDK put in the live step for a call its repair hook refused
   * (design D3, proposal A8). The event-log rebuild copies it onto the reply's
   * tool part, and every owner-facing sink strips it.
   */
  sdkRefusal?: SdkRefusal;
};

function appendDerivedDecision(
  decisions: Array<DerivedDecisionRecord>,
  decision: DerivedDecision,
): void {
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
  decisions.push(
    decision.count === undefined
      ? { ...decision.decision, kind: decision.kind }
      : { ...decision.decision, kind: decision.kind, count: decision.count },
  );
}

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

/**
 * The injected model capability: selection validation, plus the client factory
 * when the value is the real service. A test double that only validates
 * selections leaves `createClient` unset, and a model-hosted web search engine
 * fails closed rather than building a client.
 */
type RunModelCapability = ModelSelectionValidator & Partial<ModelClientFactory>;

/**
 * Retry a complete transaction only when Postgres guarantees that it aborted.
 * Re-running `work` opens a fresh transaction; connection failures are not
 * retried because their commit outcome can be ambiguous.
 */
async function retryAbortedTransaction<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const code = pgErrorCode(error);

      if (attempt >= 2 || (code !== '40P01' && code !== '40001')) {
        throw error;
      }
    }
  }
}

async function recoverHostPromotionWithRetry(
  tenantDb: TenantDbService,
  input: {
    runId: string;
    userId: string;
    attemptId: string;
    toolCallId: string;
    result: ToolResult;
  },
): Promise<ToolResult> {
  return (
    await retryAbortedTransaction(() =>
      tenantDb.runAs(input.userId, (tx) =>
        new NativeFilesRepository(tx).recoverHostPromotion(input),
      ),
    )
  ).result;
}

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

@Injectable()
export class RunExecutionService {
  private readonly logger = new Logger(RunExecutionService.name);
  private readonly toolPromptRenderer: ToolPromptRenderer;
  /**
   * The `webSearch.engines` template collection, built once from the resolved
   * configuration and handed to both prompt kinds, so the provider prompt cache
   * changes only when the operator edits engines (design D5). Absent when no
   * engine is configured.
   */
  private readonly webSearch: PromptWebSearchInput | undefined;
  /** The process-wide `ssh://` transport; absent without the `ssh` section. */
  private readonly sshClient: SshClient | undefined;

  /**
   * The Machine Workspace skill catalogs taken this process last prepared,
   * keyed by the canonical Machine root. A catalog is a snapshot of one
   * Machine's skill sources at one attempt's preparation, so a later
   * preparation for the same root replaces it; the bound keeps one worker's
   * memory flat while several Chats run.
   */
  private readonly machineSkillCatalogs = new Map<string, SkillCatalogPort>();

  /** Built on first use: every Run of this worker shares it. */
  private bashProcessLimiter: BashProcessLimiter | undefined;

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
    private readonly models: RunModelCapability,
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
    // The Machine surface tool execution reaches: the connector for every
    // request, and the status read model a bare `machine://` listing shows.
    // Both are absent when the operator configured no Machines.
    @Optional()
    @Inject(MachineConnector)
    private readonly machineConnector?: MachineConnector,
    @Optional()
    @Inject(MachinesService)
    private readonly machinesStatus?: MachineStatusReader,
    // The one seam over the `ssh://` transport: unprovided, the worker builds
    // the real client from the operator's section.
    @Optional()
    @Inject(SSH_CLIENT_FACTORY)
    private readonly sshClientFactory: SshClientFactory = createSshClient,
    // The typed git surface a worktree entry runs through. Absent in a worker
    // that serves no git, where a `worktree` call fails before any probe.
    @Optional()
    @Inject(ExecutorGit)
    private readonly executorGit?: ExecutorGit,
    // The decision lane, handed to tools as `decisions` so a rank stage can
    // rank its own candidates. Its calls are side calls: never part of the
    // Run's message usage. Absent or empty catalogue: every consumer keeps
    // its canonical order.
    @Inject(DecisionsService)
    private readonly decisions?: DecisionJudge,
    // Tells the bound repository's git state; a worker without them tells none.
    @Optional()
    @Inject(GIT_CONTEXT_PRODUCER)
    private readonly gitProducer?: InRunContextProducer,
    @Optional()
    @Inject(GitSnapshotService)
    private readonly gitSnapshots?: Pick<GitSnapshotService, 'observe'>,
    // Enqueues the Run a completed Run promotes from the Chat's queue. Absent
    // only where no queue exists (unit fixtures): nothing is promoted then.
    @Optional()
    @Inject(RunDispatchService)
    private readonly runDispatch?: Pick<RunDispatcher, 'dispatch'>,
    // The registry whose segment controllers the run-control listener aborts on
    // an owner interrupt. Absent only where no listener exists (unit fixtures):
    // the interrupt then acts as a steer at the step end.
    @Optional()
    @Inject(RunAbortRegistry)
    private readonly segmentAborts?: RunSegmentRegistrar,
    @Optional()
    @Inject(BashJobRegistry)
    private readonly bashJobs?: BashJobRegistry,
    @Inject(RunWaitService)
    private readonly runWait?: RunWaitService,
    @Optional()
    @Inject(JobNoticeRunService)
    private readonly jobNoticeRuns?: Pick<
      JobNoticeRunService,
      'startAfterRunCompletion'
    >,
  ) {
    this.webSearch = webSearchEngineItems(this.instanceConfig.config.webSearch);
    this.toolPromptRenderer = createToolPromptRenderer({
      configPath: this.instanceConfig.configPath ?? resolveConfigPath(),
      instancePromptFiles: this.instanceConfig.config.tools.promptFiles,
      models: this.instanceConfig.config.models,
      webSearch: this.webSearch,
    });
    // One generated SSH configuration per worker process, written only when a
    // call actually resolves or runs (ssh-locator D1). Without the `ssh`
    // section there is no client, so `ssh://` stays an unknown scheme.
    const ssh = this.instanceConfig.config.ssh;
    this.sshClient =
      ssh === undefined ? undefined : this.sshClientFactory({ ssh });
  }

  /**
   * Remove the generated `ssh://` configuration directory this process wrote.
   * The file holds the pinned host-key path and the llame identity, so it must
   * not outlive the worker that created it (ssh-locator D1).
   */
  onModuleDestroy(): void {
    this.sshClient?.dispose();
  }

  /** `bash` allowlisted on a process with a native executor (D10). */
  private artifactHostFilesEnabled(): boolean {
    return hostFilesEnabled(this.instanceConfig.config.tools);
  }

  /**
   * Attempt start (D10): restore this Chat's artifact files before the first
   * model request, and sweep the Chat directories no attempt touched for seven
   * days. The sweep runs in the background so it never delays the attempt; it
   * cannot reject. A failure here never fails the Run: Postgres still holds
   * every artifact, and the next reconcile writes the files again.
   */
  private async restoreArtifactFiles(
    input: ExecuteRunInput,
    chat: Chat | undefined,
  ): Promise<void> {
    if (!this.artifactHostFilesEnabled()) return;
    void sweepArtifactDirectories();

    if ((chat?.artifactSeq ?? 0) === 0) return;
    await reconcileArtifactFiles({
      tenantDb: this.tenantDb,
      userId: input.userId,
      chatId: input.chatId,
      abortSignal: input.abortSignal,
    }).catch((error: unknown) => {
      this.logger.warn(`Artifact file reconcile failed: ${String(error)}`);
    });
  }

  /**
   * Terminalize work that can outlive its executor (notably retry exhaustion)
   * through the same durable settlement transaction as executor callbacks.
   * Throws when that transaction cannot commit so callers never acknowledge
   * queue work whose terminal state is not durable.
   *
   * A settler holding the attempt's live collector (parent-abort cancellation
   * and expiry) passes `assistantTurn`; every other caller leaves the reply to
   * be rebuilt from the events of the attempt it names (design D3).
   */
  async settleTerminalRun(input: {
    userId: string;
    runId: string;
    status: TerminalRunStatus;
    /** Fence the terminal write by this attempt when one is known. */
    attemptId?: string;
    /** Fence queue-driven expiry by the queue identity it observed. */
    expectedQueueIdentity?: {
      currentJobId: string | null;
      wakeGeneration: number;
    };
    runPayload?: unknown;
    error?: unknown;
    telemetry?: AssistantTurnTelemetry;
    assistantTurn?: AssistantTurnWrite;
    /**
     * The cut this terminal write closes (continue-after-broken-send D6): the
     * reply carries the kept parts and the notice, and this names the dropped
     * output in the same transaction.
     */
    superseded?: SupersededModelOutput;
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

  async completeCompactionRun(
    input: CompactionCompletionInput,
  ): Promise<FinishRunResult> {
    const digest = await this.resolveCompactionDigest(input);

    if (input.abortSignal.aborted) {
      return this.settleCompactionAbort(input);
    }

    const result = await retryAbortedTransaction(() =>
      this.tenantDb.runAs(input.userId, async (tx) => {
        const fenced = await new RunsRepository(tx).updateForAttempt(
          input.runId,
          input.userId,
          input.attemptId,
          { activeAttemptId: input.attemptId },
        );

        if (!fenced) return { outcome: 'lost' as const };

        if (input.abortSignal.aborted) {
          const status = classifyAbortedRun(input.abortSignal);
          const message = this.abortedRunMessage(status, input.abortSignal);

          return this.finishRunInTransaction(tx, {
            runId: input.runId,
            userId: input.userId,
            status,
            attemptId: input.attemptId,
            expectedQueueIdentity: input.expectedQueueIdentity,
            runPayload: { status, message },
            error: { message },
          });
        }

        const status =
          fenced.cancelRequestedAt === null ? 'completed' : 'cancelled';

        if (status === 'completed' && input.summary !== undefined) {
          await this.publishCompactionCheckpoint(
            tx,
            {
              chatId: input.chatId,
              userId: input.userId,
              summary: input.summary,
              focus: input.focus,
            },
            digest,
          );
        }

        if (status === 'completed') {
          await this.appendQuotaRecovered(tx, input.runId, input.quotaRequest);
        }

        const finish = await this.finishRunInTransaction(tx, {
          runId: input.runId,
          userId: input.userId,
          status,
          attemptId: input.attemptId,
          expectedQueueIdentity: input.expectedQueueIdentity,
          runPayload: { status },
          ...(status === 'cancelled' && {
            error: { message: 'Run was cancelled.' },
          }),
        });

        if (
          finish.outcome === 'won' &&
          finish.promoted === undefined &&
          status === 'completed'
        ) {
          await this.jobNoticeRuns?.startAfterRunCompletion(tx, {
            chatId: input.chatId,
            ownerUserId: input.userId,
          });
        }

        return finish;
      }),
    );

    if (result.outcome === 'won' && result.promoted && this.runDispatch) {
      await this.dispatchPromotedRun(this.runDispatch, result.promoted);
    }

    return result;
  }

  private async settleCompactionAbort(
    input: CompactionCompletionInput,
  ): Promise<FinishRunResult> {
    const status = classifyAbortedRun(input.abortSignal);
    const message = this.abortedRunMessage(status, input.abortSignal);

    return this.settleTerminalRun({
      userId: input.userId,
      runId: input.runId,
      status,
      attemptId: input.attemptId,
      expectedQueueIdentity: input.expectedQueueIdentity,
      runPayload: { status, message },
      error: { message },
    });
  }

  private async resolveCompactionDigest(input: {
    userId: string;
    chatId: string;
  }): Promise<{ candidate: RecencyDigestResolution | null }> {
    const shareRecentChats = await this.tenantDb.runAs(input.userId, (tx) =>
      this.memory.getForOwnerForBinding(tx, input.userId),
    );

    let candidate: RecencyDigestResolution | null = null;

    if (shareRecentChats.shareRecentChats) {
      try {
        candidate = await this.recencyDigest.resolveCandidate(
          input.userId,
          input.chatId,
        );
      } catch {
        this.logger.error('recency_digest_resolution_failed');
      }
    }

    return { candidate };
  }

  private async publishCompactionCheckpoint(
    tx: Db,
    input: {
      chatId: string;
      userId: string;
      summary: CompactionSummary;
      focus: string | null;
    },
    digest: {
      candidate: RecencyDigestResolution | null;
    },
  ): Promise<void> {
    const summary = input.summary;
    const messages = new MessagesRepository(tx);
    const chats = new ChatsRepository(tx);

    if (
      (await messages.findCheckpointByBoundary(
        input.chatId,
        input.userId,
        summary.uptoSeq,
      )) !== undefined
    ) {
      return;
    }

    const chat = await chats.touch(input.chatId, input.userId);

    const shareRecentChats = await this.memory.getForOwnerForBinding(
      tx,
      input.userId,
    );

    const checkpoint = await messages.createCheckpoint({
      chatId: input.chatId,
      absorbedThroughSeq: summary.uptoSeq,
      part: createCompactionCheckpointPart(summary.summary, input.focus),
      usage: summary.usage,
    });

    await this.rebakeCheckpointDigest({
      tx,
      chatId: input.chatId,
      userId: input.userId,
      chat,
      checkpointId: checkpoint.id,
      shareRecentChats,
      candidate: digest.candidate,
    });

    await this.resetWorkspaceCheckpointEpoch({
      tx,
      chatId: input.chatId,
      userId: input.userId,
      checkpointId: checkpoint.id,
    });
  }

  async recordModelRetry(
    input: { runId: string; chatId: string; userId: string; attemptId: string },
    retry: ModelRequestRetry,
  ): Promise<void> {
    await retryRunTransaction(() =>
      this.tenantDb.runAs(input.userId, async (tx) => {
        if (
          !(await new RunRowFenceRepository(tx).lockForDelivery(
            input.runId,
            input.userId,
            input.attemptId,
          ))
        )
          throw new RunNotRunnableError(input.runId);

        if (!(await new ChatsRepository(tx).lock(input.chatId, input.userId)))
          throw new RunNotRunnableError(input.runId);

        await new RunEventsRepository(tx).append(
          input.runId,
          'model.retrying',
          retry,
        );
      }),
    );
  }

  private async readQuotaClaim(
    runs: RunsRepository,
    events: RunEventsRepository,
    input: RunClaimInput,
  ) {
    const queued = await runs.findById(input.runId, input.userId);

    const quotaEvents = queued?.wakeGeneration
      ? await events.listByRunId(input.runId, input.userId, {
          eventTypes: [
            'run.suspended',
            'run.resumed',
            'run.started',
            'run.delivered',
            'run.quota_recovered',
          ],
        })
      : [];

    const quotaRequest = quotaRequestFromEvents(quotaEvents);

    const quotaCompactionState = quotaCompactionStateFromEvents(
      quotaEvents,
      quotaRequest,
    );

    const quotaAttemptId =
      queued?.awaiting?.kind === 'quota'
        ? quotaResumeAttemptId(quotaEvents, queued.wakeGeneration)
        : undefined;

    if (queued?.awaiting?.kind === 'quota' && quotaAttemptId === undefined)
      throw new Error('The quota wake has no waking attempt identity.');

    return { quotaEvents, quotaRequest, quotaAttemptId, quotaCompactionState };
  }

  async claimRun(input: RunClaimInput): Promise<RunClaimResult> {
    return retryRunTransaction(() =>
      this.tenantDb.runAs(input.userId, async (tx) => {
        const runs = new RunsRepository(tx);
        const events = new RunEventsRepository(tx);

        if (input.abortSignal?.aborted) {
          const status = classifyAbortedRun(input.abortSignal);
          const message = this.abortedRunMessage(status, input.abortSignal);

          const finished = await runs.markFinished(
            input.runId,
            input.userId,
            status,
            {
              error: { message },
              ...(input.expectedQueueIdentity !== undefined && {
                expectedQueueIdentity: input.expectedQueueIdentity,
              }),
            },
          );

          return {
            settledReply: await this.settleAtClaim(
              tx,
              finished,
              status,
              message,
            ),
          };
        }

        if (!(await new ChatsRepository(tx).lock(input.chatId, input.userId))) {
          return { settledReply: undefined };
        }

        const {
          quotaEvents,
          quotaRequest,
          quotaAttemptId,
          quotaCompactionState,
        } = await this.readQuotaClaim(runs, events, input);

        const started = await runs.markStarted(input.runId, input.userId, {
          expectedQueueIdentity: input.expectedQueueIdentity,
          attemptId: quotaAttemptId,
        });

        if (!started) {
          const current = await runs.findById(input.runId, input.userId);

          if (
            current?.cancelRequestedAt == null ||
            isTerminalRunStatus(current.status)
          ) {
            return { settledReply: undefined };
          }

          const cancelled = input.expectedQueueIdentity
            ? await runs.markFinished(input.runId, input.userId, 'cancelled', {
                expectedQueueIdentity: input.expectedQueueIdentity,
              })
            : await runs.markFinished(input.runId, input.userId, 'cancelled');

          return {
            settledReply: await this.settleAtClaim(
              tx,
              cancelled,
              'cancelled',
              this.abortedRunMessage('cancelled', input.abortSignal),
            ),
          };
        }

        // A claimed turn gets one settlement opportunity for host jobs whose
        // worker died before this claim (background-jobs D9).
        await new ChatJobsRepository(tx).settleOnDeadWorkers(
          input.chatId,
          input.userId,
          workerDeadAfterSeconds(this.instanceConfig.config),
        );

        const wakeCause =
          started.awaiting === null
            ? undefined
            : await pendingWakeInTransaction(tx, started);

        if (
          wakeCause === undefined &&
          (await new NativeFilesRepository(tx).hasMutation(input.runId))
        ) {
          return {
            nativeRecovery: true as const,
            attemptId: started.activeAttemptId!,
          };
        }

        const startedEvent = await events.append(input.runId, 'run.started', {
          attemptId: started.activeAttemptId,
        });

        let wakeState: ContinueState | undefined = quotaCompactionState;

        if (wakeCause !== undefined && started.awaiting !== null) {
          if (started.awaiting.kind === 'quota') {
            await clearQuotaAwaitingInTransaction(tx, started, wakeCause);
            wakeState =
              quotaWakeStateFromEvents(
                [...quotaEvents, startedEvent],
                started.activeAttemptId!,
              ) ?? quotaCompactionState;
          } else {
            if (wakeCause === 'cancelled')
              throw new Error('A jobs wake cannot carry quota cancellation.');
            await completeWaitInTransaction(
              tx,
              started,
              started.awaiting,
              wakeCause,
            );
            wakeState = wakeStateFromEvents(
              await events.listByRunId(input.runId, input.userId, {
                eventTypes: [
                  'run.suspended',
                  'run.resumed',
                  'run.started',
                  'run.delivered',
                  'tool.requested',
                  'tool.started',
                  'tool.completed',
                ],
              }),
              started.activeAttemptId!,
            );
          }

          if (wakeState === undefined) {
            throw new Error('The resumed Run has no complete wait checkpoint.');
          }
        }

        // Effort is frozen on the Run at admission; never re-read current
        // configuration on a retry.
        return {
          effort: started.effort ?? undefined,
          permissionMode: started.permissionMode,
          attemptId: started.activeAttemptId!,
          messageId: started.messageId,
          nativeDeliverySequence: startedEvent.sequence,
          wakeState,
          quotaRequest,
          quotaWake: started.awaiting?.kind === 'quota',
        };
      }),
    );
  }

  async executeRun(
    request: ExecuteRunInput,
  ): Promise<ReturnType<ModelClient['streamText']>> {
    // Agent tracing: every model call of this Chat joins one conversation,
    // attributed to its owner's opaque id, on the job's isolation scope.
    Sentry.setConversationId(request.chatId);
    Sentry.setUser({ id: request.userId });

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

    // Claim before any context preparation can invoke a model. Pre-step
    // compaction is part of this run's execution budget and cancellation
    // lifecycle, not untracked pre-work. A cancel that won the worker pickup
    // TOCTOU is settled atomically here without spending on either model.
    const claim = await this.claimRun(input);

    if ('settledReply' in claim) {
      // A reply finalized in place keeps its creation time, so only the
      // post-commit touch and reindex make its settled content searchable.
      await this.afterAssistantTurn(claim.settledReply, input.userId);
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
    // Every attempt, a crash retry included, reads the Run's current message
    // from the Run row, not from the job: a delivery moved it (run-steering D3).

    // A delivered message resumes the same Run in a new segment; only its
    // first segment applies follow-up handling.
    const firstSegment = claim.messageId === input.userMessage.id;

    const attempt = await this.executeAttempt({
      input: firstSegment
        ? input
        : await this.currentSegmentInput(input, claim.messageId),
      nativeAbort,
      effort,
      permissionMode,
      attemptId,
      nativeDeliverySequence: claim.nativeDeliverySequence,
      firstSegment,
      wakeState: claim.wakeState,
      quotaRequest: claim.quotaRequest,
      quotaWake: claim.quotaWake === true,
      createdMessage: input.userMessage,
    });

    return this.chainSegments(attempt);
  }

  private waitService(): RunWaitService {
    if (this.runWait === undefined)
      throw new Error('The worker has no durable wait service.');

    return this.runWait;
  }

  async suspendCompactionForQuota(input: {
    run: Pick<ExecuteRunInput, 'runId' | 'chatId' | 'userId'>;
    attemptId: string;
    error: ProviderFailure | CompactionQuotaWait;
    request: QuotaRequestState | undefined;
    resumeAt: QuotaResumeAt;
    parts: Array<MessagePart>;
    assistantTurn?: AssistantTurnWrite;
    stoppedCalls?: ReadonlyArray<StoppedCall>;
    stepBudgetUsed?: number;
    boundaryMode?: 'automatic' | 'owner';
    compactionSet?: CompactionSet;
    summaryAttemptId?: string;
    summaryPrefixFingerprint?: string;
    baselines?: FirstEpochBaselines;
    /** The cut a failed send leaves; the suspension's transaction appends it. */
    superseded?: SupersededModelOutput;
  }): Promise<boolean> {
    const quotaWait = compactionQuotaWait(input.error, {
      maxSeconds: this.instanceConfig.config.runs.quotaWaitMaxSeconds,
      request: input.request,
    });

    if (quotaWait === undefined) return false;

    const result = await this.waitService().suspendForQuota({
      runId: input.run.runId,
      chatId: input.run.chatId,
      userId: input.run.userId,
      attemptId: input.attemptId,
      awaiting: { ...quotaWait.awaiting, resumeAt: input.resumeAt },
      parts: input.parts,
      steps: {},
      ...(input.stoppedCalls !== undefined && {
        stoppedCalls: input.stoppedCalls,
      }),
      ...(input.stepBudgetUsed !== undefined && {
        stepBudgetUsed: input.stepBudgetUsed,
      }),
      ...(input.boundaryMode !== undefined && {
        boundaryMode: input.boundaryMode,
      }),
      ...(input.compactionSet !== undefined && {
        compactionSet: input.compactionSet,
      }),
      ...(input.summaryAttemptId !== undefined && {
        summaryAttemptId: input.summaryAttemptId,
      }),
      ...(input.summaryPrefixFingerprint !== undefined && {
        summaryPrefixFingerprint: input.summaryPrefixFingerprint,
      }),
      ...(input.baselines !== undefined && { baselines: input.baselines }),
      ...(input.superseded !== undefined && {
        superseded: input.superseded,
      }),
    });

    if (result.kind === 'ready') {
      const current = await this.tenantDb.runAs(input.run.userId, (tx) =>
        new RunsRepository(tx).findById(input.run.runId, input.run.userId),
      );

      if (
        current?.activeAttemptId === input.attemptId &&
        current.cancelRequestedAt !== null
      ) {
        await this.settleTerminalRun({
          runId: input.run.runId,
          userId: input.run.userId,
          attemptId: input.attemptId,
          status: 'cancelled',
          runPayload: { status: 'cancelled', message: 'Run was cancelled.' },
          error: { message: 'Run was cancelled.' },
          ...(input.assistantTurn !== undefined && {
            assistantTurn: input.assistantTurn,
            telemetry: input.assistantTurn.telemetry,
          }),
        });
      }
    }

    return true;
  }
  private async appendQuotaRecovered(
    tx: Db,
    runId: string,
    request: QuotaRequestState | undefined,
  ): Promise<void> {
    if (request === undefined) return;

    await new RunEventsRepository(tx).append(runId, 'run.quota_recovered', {
      generation: request.generation,
      resumeAt: request.resumeAt,
    });
  }

  /**
   * The input of a later segment: the Run's current message in place of the
   * job's. Only the first segment applies follow-up rules (run-steering D3).
   */
  private async currentSegmentInput(
    input: ExecuteRunInput,
    messageId: string | null,
  ): Promise<ExecuteRunInput> {
    const message =
      messageId === null
        ? undefined
        : await this.tenantDb.runAs(input.userId, (tx) =>
            new MessagesRepository(tx).findById(
              input.chatId,
              input.userId,
              messageId,
            ),
          );

    if (message === undefined) throw new RunNotRunnableError(input.runId);

    return {
      ...input,
      userMessage: toRunUserMessage(message),
      followUpAction: null,
    };
  }

  /**
   * One result for the whole Run: its `consumeStream()` drains the segment's
   * call, then every call or segment that call handed on, and resolves only
   * when the Run is terminal. `text` is the last call's text. Anything else
   * reads the first call's result.
   */
  private chainSegments(first: AttemptRun): ModelStreamResult {
    let last = first;
    let drained: Promise<void> | undefined;

    const drain = (options?: ConsumeStreamOptions): Promise<void> => {
      drained ??= (async () => {
        for (;;) {
          const { result, nextCall } = last;
          await (result.consumeStream
            ? result.consumeStream(options)
            : result.text);
          const following = nextCall();

          if (following === undefined) return;
          last = await following;
        }
      })();

      return drained;
    };

    return wrapStreamTextResult(first.result, {
      consumeStream: () => ({ value: drain }),
      text: () => ({ value: drain().then(() => last.result.text) }),
    });
  }

  private async automaticCompactionDueAtBoundary(input: {
    hasBoundary: boolean;
    replyParts: ReadonlyArray<MessagePart>;
    latestRequestContextTokens: number | undefined;
    requestMessages: PreparedExecutionContext['messages'];
    system: string;
    toolDeclarations: PreparedExecutionContext['toolDeclarations'];
    thresholdTokens: number;
    client: ExecuteRunInput['client'];
    media: RunMediaResolver;
  }): Promise<boolean> {
    if (!input.hasBoundary) return false;

    const projected = projectStoredReplyParts(input.replyParts, {
      privateParts: true,
      mediaKey: continuedMediaKey,
    });

    const mediaContext = this.mediaAdmissionContext(input.client);

    const sizingMedia: RunMediaResolver = {
      ...input.media,
      retainedMedia: new Map([
        ...input.media.retainedMedia,
        ...projected.retainedMedia,
      ]),
    };

    const stepToolResultMedia = await loadMediaSizing(
      projected.messages,
      sizingMedia,
      mediaContext,
    );

    const nextRequestMedia =
      input.latestRequestContextTokens === undefined
        ? await loadMediaSizing(
            [...input.requestMessages, ...projected.messages],
            sizingMedia,
            mediaContext,
          )
        : undefined;

    return automaticBoundaryThresholdReached({
      latestRequestContextTokens: input.latestRequestContextTokens,
      system: input.system,
      requestMessages: input.requestMessages,
      stepToolResults: projected.messages,
      toolDeclarations: input.toolDeclarations,
      stepToolResultMedia,
      nextRequestMedia,
      thresholdTokens: input.thresholdTokens,
    });
  }

  private async dispatchOrSettleAttempt(input: {
    run: ExecuteRunInput;
    attemptId: string;
    context: PreparedAttemptContext;
    modelId: string;
    effort: string | undefined;
    permissionMode: PermissionMode;
    wakeState: ContinueState | undefined;
    startDelivered: (delivery: DeliveredBoundary) => Promise<AttemptRun>;
  }): Promise<AttemptRun | undefined> {
    try {
      await retryRunTransaction(() =>
        this.tenantDb.runAs(input.run.userId, (tx) =>
          this.dispatchAttempt(tx, {
            run: input.run,
            attemptId: input.attemptId,
            context: input.context,
            modelId: input.modelId,
            effort: input.effort,
            permissionMode: input.permissionMode,
            wakeState: input.wakeState,
          }),
        ),
      );

      return undefined;
    } catch (error) {
      if (error instanceof CancellationRecordedError) {
        const message = this.abortedRunMessage('cancelled', undefined);
        await this.settleTerminalRun({
          userId: input.run.userId,
          runId: input.run.runId,
          status: 'cancelled',
          attemptId: input.attemptId,
          runPayload: { status: 'cancelled', message },
          error: { message },
        });
        throw new RunNotRunnableError(input.run.runId);
      }

      if (!(error instanceof ReplyAlreadyCompletedError)) throw error;

      const settlement = await this.settleTerminalRun({
        userId: input.run.userId,
        runId: input.run.runId,
        status: 'completed',
        attemptId: input.attemptId,
      });

      if (settlement.outcome === 'delivered')
        return input.startDelivered(settlement.delivery);
      throw new RunNotRunnableError(input.run.runId);
    }
  }

  private async prepareAttemptContextForExecution(
    attempt: ExecuteAttemptInput,
  ): Promise<AttemptPreparationOutcome> {
    const {
      input,
      effort,
      permissionMode,
      attemptId,
      nativeDeliverySequence,
      firstSegment,
      createdMessage,
    } = attempt;

    const { client } = input;
    let quotaRequest = attempt.quotaRequest;

    const events = await this.tenantDb.runAs(input.userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(input.runId, input.userId, {
        eventTypes: ['run.delivered', 'run.compaction_disabled'],
      }),
    );

    const stepBudgetOffset = readCompactionStepBudget(events);

    const wakeStepOffset =
      attempt.quotaRequest?.stepBudgetUsed === undefined
        ? continueStepOffset(attempt.wakeState)
        : Math.max(0, attempt.quotaRequest.stepBudgetUsed - stepBudgetOffset);

    const compactionDisabledAtStart = events.some(
      (event) => event.eventType === 'run.compaction_disabled',
    );

    const lastDelivery = events.at(-1);

    const startsAfterCompaction =
      lastDelivery !== undefined &&
      isRecord(lastDelivery.payload) &&
      (lastDelivery.payload['cause'] === 'compaction' ||
        lastDelivery.payload['checkpointId'] !== undefined);

    const continued =
      attempt.wakeState ??
      (firstSegment ? await this.loadContinueState(input) : undefined);

    const effectivePermissionMode =
      this.resolveEffectivePermissionMode(permissionMode);

    await this.settleIfAborted(input, attemptId);

    const startDelivered = (delivery: DeliveredBoundary): Promise<AttemptRun> =>
      this.executeAttempt({
        ...attempt,
        input: {
          ...input,
          userMessage: toRunUserMessage(delivery.message),
          followUpAction: null,
        },
        attemptId: delivery.attemptId,
        firstSegment: false,
        wakeState: undefined,
        quotaRequest: undefined,
        quotaWake: false,
        createdMessage,
      });

    let wakeCompactionSet: CompactionSet | undefined;

    const wakeAttempt = await this.prepareWakeAttempt({
      run: input,
      attemptId,
      wakeState: attempt.wakeState,
      quotaRequest: attempt.quotaRequest,
      startDelivered,
      onCompactionSet: (set) => {
        wakeCompactionSet = set;
      },
    });

    const deliveredWakeAttempt = this.deliveredWakeAttempt(wakeAttempt);

    if (deliveredWakeAttempt !== undefined)
      return { kind: 'delivered', attempt: deliveredWakeAttempt };
    const wakeCompaction = wakeAttempt === 'compact';

    const workspaceChat = await this.tenantDb.runAs(input.userId, (tx) =>
      new ChatsRepository(tx).findById(input.chatId, input.userId),
    );

    const workspacePreparation = await this.prepareWorkspace(
      input,
      nativeDeliverySequence,
      attemptId,
      workspaceChat,
      effectivePermissionMode,
    );

    const workspaceRoot = createWorkspaceRootCell(workspacePreparation.root);

    const gitObservation = this.startGitObservation(
      input,
      nativeDeliverySequence,
      workspacePreparation,
      workspaceRoot,
      effectivePermissionMode,
    );

    const workspaceMcpListing: WorkspaceMcpListingCell = {};
    const boundWorkspaceMcpKey = this.workspaceMcpKey(workspacePreparation);
    await this.restoreArtifactFiles(input, workspaceChat);

    const workspaceMcpKey = await this.startWorkspaceMcp(
      input.chatId,
      boundWorkspaceMcpKey,
      effectivePermissionMode,
      workspaceMcpListing,
    );

    const attemptDynamicResolver = this.attemptDynamicResolver(workspaceMcpKey);

    const skillSelection = await this.activateMentionedSkills(
      input,
      nativeDeliverySequence,
      workspaceRoot,
      effectivePermissionMode,
      continued !== undefined,
    );

    const media = createRunMediaResolver(this.tenantDb, input.userId);
    await this.resolvePromptImports({
      input,
      attemptId,
      nativeDeliverySequence,
      workspaceRoot,
      effectivePermissionMode,
      skillSelection,
      detaching: workspacePreparation.detaching,
      retainedMedia: media.retainedMedia,
      followUp: continued !== undefined,
    });

    const { firstStep, quotaRequest: preparedQuotaRequest } =
      await this.prepareQuotaFirstStep({
        run: input,
        attemptId,
        workspacePreparation,
        workspaceMcpKey,
        dynamicResolver: attemptDynamicResolver,
        effectivePermissionMode,
        nativeDeliverySequence,
        workspaceRootCell: workspaceRoot,
        effort,
        media,
        continued,
        gitObservation,
        firstSegment,
        wakeCompaction,
        quotaRequest,
        stepBudgetUsed: stepBudgetOffset + wakeStepOffset,
      });

    quotaRequest = preparedQuotaRequest;

    const compactionStartedThisAttempt =
      firstStep.preStepCompactionStarted ||
      compactionAttemptStarted({
        wakeCompaction,
        startsAfterCompaction,
        isWakeAttempt: attempt.wakeState !== undefined,
      });

    return {
      kind: 'ready',
      execution: {
        startDelivered,
        quotaRequest,
        stepBudgetOffset,
        wakeStepOffset,
        compactionDisabledAtStart,
        continued,
        effectivePermissionMode,
        wakeCompactionSet,
        wakeCompaction,
        workspaceRoot,
        workspaceMcpKey,
        workspaceMcpListing,
        skillSelection,
        media,
        prepared: firstStep.request,
        attemptContext: firstStep.context,
        compactionStartedThisAttempt,
        compactionThreshold: resolveCompactionThreshold({
          explicitThresholdTokens: client.compactionThresholdTokens,
          contextWindowTokens: client.contextWindowTokens,
        }),
        turnInstructions: firstStep.turnInstructions,
        turnGit: firstStep.turnGit,
      },
    };
  }

  private async executeAttempt(
    attempt: ExecuteAttemptInput,
  ): Promise<AttemptRun> {
    const outcome = await this.prepareAttemptContextForExecution(attempt);

    if (outcome.kind === 'delivered') return outcome.attempt;

    const {
      startDelivered,
      quotaRequest: preparedQuotaRequest,
      stepBudgetOffset,
      wakeStepOffset,
      compactionDisabledAtStart,
      continued,
      effectivePermissionMode,
      wakeCompactionSet,
      wakeCompaction,
      workspaceRoot,
      workspaceMcpKey,
      workspaceMcpListing,
      skillSelection,
      media,
      prepared,
      attemptContext,
      compactionStartedThisAttempt,
      compactionThreshold,
      turnInstructions,
      turnGit,
    } = outcome.execution;

    let quotaRequest = preparedQuotaRequest;

    const {
      input,
      nativeAbort,
      effort,
      attemptId,
      nativeDeliverySequence,
      createdMessage,
    } = attempt;

    const { client } = input;
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

    await this.settleIfAborted(input, attemptId);

    const streamStartedAt = Date.now();
    const requestUsageReceipts: Array<LanguageModelUsage> = [];
    let discardedSend = false;
    // Stream performance for the turn (#155): the first streamed output delta's
    // offset, how many arrived, and the generation time the throughput divides
    // by. The first two are stamped from the SAME baseline `streamStartedAt`
    // that `latencyMs` is measured from, so the usage card's Total and First
    // token rows are comparable. A delta counts (and stamps the first) only
    // when it carries text: an empty reasoning delivery is a part boundary
    // whose text the provider withheld, not streamed output. `generationMs` is
    // the model client's own sum over the attempt's provider requests — each
    // one's window from its first delta, or from the request itself when it
    // streamed none, to that request's finish — so the rate measures
    // generation, not the wall clock a step spent waiting on its tools.
    let firstOutputDeltaMs: number | undefined;
    let outputDeltaCount = 0;
    let generationMs = 0;

    const noteOutputDelta = (text: string): void => {
      if (text.length === 0) return;
      firstOutputDeltaMs ??= Date.now() - streamStartedAt;
      outputDeltaCount += 1;
    };

    const buildAssistantTelemetry = (
      finishReason: TurnTelemetry['finishReason'],
      status: TurnTelemetry['status'],
      stepCount?: number,
    ): AssistantTurnTelemetry => {
      const telemetry = aggregateTurnTelemetry({
        receipts: requestUsageReceipts,
        finishReason,
        status,
        modelId: client.model,
        effort,
        permissionMode: effectivePermissionMode,
        latencyMs: Date.now() - streamStartedAt,
        firstTokenMs: firstOutputDeltaMs,
        chunkCount: outputDeltaCount,
        generationMs,
        price: client.pricing,
        billing: client.billing,
        stepCount,
      });

      if (discardedSend) {
        telemetry.complete = false;
        delete telemetry.tokensPerSecond;
      }

      return { ...telemetry, runId: input.runId, attemptId };
    };

    let assistantPartCollector = createAssistantPartCollector();

    // The kept parts are the transcript's prefix, so every terminal writer of
    // this attempt persists them once, ahead of its own parts (D5). The kept
    // boundary ends on a settled tool part or an in-Run item, which is why no
    // live delta can merge into a kept part.
    if (continued !== undefined) assistantPartCollector.seed(continued.parts);

    // The step numbers this Run's own parts use. A Continue Run's parts
    // continue after the steps it kept (design D5), so the kept steps and the
    // new ones stay separate in the reply it stores.
    const stepOffset = continueStepOffset(continued);

    const wakeBoundary = await this.deliverWakeCompaction({
      run: input,
      attemptId,
      prepared,
      context: attemptContext,
      effort,
      media,
      workspaceRoot,
      compactionSet: wakeCompactionSet,
      keptPartCount: continued?.parts.length ?? 0,
      wakeCompaction,
      stepBudgetUsed: stepBudgetOffset + wakeStepOffset,
      quotaRequest,
      quotaParts: () => assistantPartCollector.parts(),
    });

    if (wakeCompaction && quotaRequest?.resumeAt === 'preDispatch')
      quotaRequest = undefined;

    if (wakeCompaction) {
      const resumedWake = await this.finishWakeCompactionBoundary({
        boundary: wakeBoundary,
        userId: input.userId,
        runId: input.runId,
        attemptId,
        startDelivered,
      });

      if (resumedWake !== undefined) return resumedWake;
    }

    this.applyCompactionFailure({
      failure:
        wakeBoundary?.kind === 'nothing-pending' &&
        wakeBoundary.compactionFailed
          ? 'manual'
          : undefined,
      assistantPartCollector,
      disableAutomaticCompaction: () => disableAutomaticCompaction(),
    });

    // A boundary or final-answer quota wake finishes the summary the
    // suspension interrupted BEFORE the target request is dispatched. When
    // that boundary delivers or stops, this Run never sent the request, so the
    // accepted-turn items, told state and `model.requested` must not be
    // committed for it; a summary that resolves without a delivery then
    // dispatches the request it actually sends. The summary itself runs under
    // the existing active-attempt fence inside `prepareBoundaryCompaction`.
    let quotaResumeFailure: 'automatic' | 'manual' | undefined;

    if (
      quotaRequest?.resumeAt === 'boundary' ||
      quotaRequest?.resumeAt === 'finalAnswer'
    ) {
      const closingStatus =
        quotaRequest.stoppedCalls === undefined ? 'completed' : 'aborted';

      const resumed = await this.resumeQuotaAttempt({
        run: input,
        attemptId,
        context: attemptContext,
        prepared,
        effort,
        media,
        workspaceRoot,
        replyParts: [],
        keptPartCount: continued?.parts.length ?? 0,
        stepBudgetUsed: stepBudgetOffset + wakeStepOffset,
        quotaRequest,
        resumeAt: quotaRequest.resumeAt,
        quotaParts: () => assistantPartCollector.parts(),
        telemetry: buildAssistantTelemetry(null, closingStatus),
        createdMessage,
        quotaAssistantTurn: () => ({
          chatId: input.chatId,
          inReplyTo: input.userMessage.id,
          parts: assistantPartCollector.parts(),
          telemetry: buildAssistantTelemetry(null, closingStatus),
        }),
        ...(quotaRequest.stoppedCalls !== undefined && {
          quotaStoppedCalls: quotaRequest.stoppedCalls,
        }),
        userId: input.userId,
        runId: input.runId,
        startDelivered,
      });

      if (resumed.kind === 'delivered') return resumed.attempt;

      // Applied once the disabled state it may change exists, ahead of the
      // target call this summary failure did not prevent.
      quotaResumeFailure = resumed.compactionFailure;

      quotaRequest = undefined;
    }

    // One fenced transaction stores the accepted-turn items this request
    // carries, with the told and baseline state they account for, creates or
    // resets the reply as `running`, and records `model.requested` immediately
    // before the target call (design D1). The request already carries the
    // trigger's history row with the same items placed by the same placement,
    // so it equals the parts the trigger stores.

    const dispatched = await this.dispatchOrSettleAttempt({
      run: input,
      attemptId,
      context: attemptContext,
      modelId: client.model,
      effort,
      permissionMode: effectivePermissionMode,
      wakeState: attempt.wakeState,
      startDelivered,
    });

    if (dispatched !== undefined) return dispatched;

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
    // The retained base64 this reply's message already holds: the kept parts
    // of a Continue Run, which the settled reads below add to. A read past the
    // rest of the bound keeps no bytes and records that instead (D5).
    let retainedBytesUsed = retainedPartsBase64(continued?.parts ?? []);
    // In-Run rail items for this attempt: staged at step boundaries, written
    // onto the running reply with the collector's snapshot before the step's
    // request, and spliced into every later step by the model client's step
    // callback (design D3).
    let inRunItems = createInRunContextItems();
    let deltaWrites: Promise<void> = Promise.resolve();
    let progressWriteFailed = false;

    const enqueueEvent = <Payload extends object>(
      eventType: RunEventType,
      payload: Payload,
      payloadInTransaction?: (tx: Db) => Promise<Payload>,
    ) => {
      deltaWrites = deltaWrites.then(async () => {
        const append = async (tx: Db) => {
          const storedPayload = payloadInTransaction
            ? await payloadInTransaction(tx)
            : payload;

          await new RunEventsRepository(tx).append(
            input.runId,
            eventType,
            storedPayload,
          );
        };

        let recorded: boolean;

        if (payloadInTransaction) {
          try {
            await retryRunTransaction(() =>
              this.tenantDb.runAs(input.userId, append),
            );
            recorded = true;
          } catch (error) {
            this.logger.error(
              `Failed to record run progress for run ${input.runId}`,
              loggableError(error),
            );
            recorded = false;
          }
        } else {
          recorded = await this.recordRunProgress(
            input.userId,
            input.runId,
            append,
          );
        }

        if (!recorded) progressWriteFailed = true;
      });
    };

    const persistFencedModelEvent = (
      eventType: 'model.retrying' | 'model.superseded' | 'run.quota_recovered',
      payload:
        | ModelRequestRetry
        | SupersededModelOutput
        | Pick<QuotaRequestState, 'generation' | 'resumeAt'>,
    ): void => {
      enqueueEvent(eventType, payload, async (tx) => {
        if (progressWriteFailed)
          throw new Error('A preceding model progress write failed.');

        if (
          !(await new RunRowFenceRepository(tx).lockForDelivery(
            input.runId,
            input.userId,
            attemptId,
          ))
        )
          throw new RunNotRunnableError(input.runId);

        if (!(await new ChatsRepository(tx).lock(input.chatId, input.userId)))
          throw new RunNotRunnableError(input.runId);

        return payload;
      });
    };

    const recordQuotaRecovery = async (
      status: TerminalRunStatus,
    ): Promise<void> => {
      if (
        status !== 'completed' ||
        input.abortSignal?.aborted ||
        quotaRequest === undefined
      )
        return;
      const { generation, resumeAt } = quotaRequest;
      quotaRequest = undefined;
      persistFencedModelEvent('run.quota_recovered', { generation, resumeAt });
      await deltaWrites;

      if (progressWriteFailed)
        throw new Error('The quota recovery could not be recorded.');
    };

    /**
     * Queues a `latestSequence() + 1` read behind every progress write already
     * made, so the number it reports is the one the next event will carry, and
     * hands it to `record` once it is known. A failed read fails the Run's
     * progress writes, as every other queued write does.
     */
    const queueNextSequence = (
      label: string,
      record: (sequence: number) => void,
    ): Promise<void> =>
      (deltaWrites = deltaWrites.then(async () => {
        try {
          record(
            await retryRunTransaction(() =>
              this.tenantDb.runAs(
                input.userId,
                async (tx) =>
                  (await new RunEventsRepository(tx).latestSequence(
                    input.runId,
                    input.userId,
                  )) + 1,
              ),
            ),
          );
        } catch (error) {
          progressWriteFailed = true;
          this.logger.error(
            `Failed to record the ${label} for run ${input.runId}`,
            loggableError(error),
          );
        }
      }));

    const persistStepStartSequence = async (): Promise<number> => {
      await queueNextSequence('model request boundary', (sequence) => {
        stepStartSequence = sequence;
      });

      if (progressWriteFailed)
        throw new Error('Failed to record the model request boundary.');

      return stepStartSequence;
    };

    let automaticCompactionDisabled = compactionDisabledAtStart;

    const markCompactionDisabled = (): boolean => {
      if (automaticCompactionDisabled) return false;

      automaticCompactionDisabled = true;
      assistantPartCollector.compactionNote({
        type: 'data-compaction-disabled',
        data: {},
      });

      return true;
    };

    const disableAutomaticCompaction = (): void => {
      if (markCompactionDisabled()) {
        enqueueEvent('run.compaction_disabled', {});
      }
    };

    // The boundary summary a quota wake resumed failed without stopping the
    // Run: the target call below still runs, under the failure class the
    // original request carried.
    this.applyCompactionFailure({
      failure: quotaResumeFailure,
      assistantPartCollector,
      disableAutomaticCompaction,
    });

    // Each buffered `model.delta` event carries the part id of the text it
    // holds, so the durable reconstructor rebuilds the same part boundaries
    // the live collector saw (design A7) and the live bridge can open the same
    // parts. The buffer is drained before the id is switched, so one event
    // never spans two ids.
    //
    // A wire may keep one text id for a whole step (Chat Completions sends
    // `0` across a tool call), while a tool-call part always ends the text part
    // (D3). Text the wire streams after a call then gets an id of its own, so
    // the part it opens starts at its own sequence and a failed send's cut can
    // name it in the live view too.
    let textPartId: string | undefined;
    // The id the wire itself carries for the open text part (undefined = none).
    let wireTextPartId: string | undefined;
    // Whether a complete tool-call part ended the text part since its last
    // delivery: the next text starts a new part even under the same wire id.
    let textPartEnded = false;
    let textPartEpoch = 0;

    const persistDelta = (text: string | null) => {
      if (text !== null) {
        enqueueEvent('model.delta', {
          text,
          ...(textPartId !== undefined && { partId: textPartId }),
          stepNumber: currentStepNumber,
        });
      }
    };

    // A text part's opaque provider metadata (design A7) rides its own
    // `model.delta`, keyed by the part's adapter id: the Responses wire
    // attaches the item id to the part's start and end, never to a delta, so
    // there is nothing to buffer — only the id the metadata binds to.
    const persistTextMetadata = (
      partId: string | undefined,
      providerMetadata: ProviderMetadata,
    ) => {
      enqueueEvent('model.delta', {
        ...(partId !== undefined && { partId }),
        providerMetadata,
        stepNumber: currentStepNumber,
      });
    };

    // Reasoning ("thinking") deltas: coalesced in their own buffer, appended
    // through the SAME chain as model.delta so reasoning and text land in
    // stream order (reasoning precedes text). The full reasoning text is ALSO
    // collected (assistantPartCollector) and persisted as `reasoning` parts in
    // occurrence order, so thinking survives a reload and replays to the
    // reply's own model under the model rule (D7); `partsToText` strips it, so
    // text-only surfaces never carry it.
    //
    // Accumulated from EACH onReasoningDelta chunk (not the SDK's
    // onFinish.reasoningText, which is only the FINAL step's reasoning and would
    // silently drop step-1 thinking on a multi-step tool turn — the tool loop
    // caps steps rather than replacing them, so a turn is several steps, and
    // the accumulation is correct regardless of step count and matches the
    // persistence branch).
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
          stepNumber: currentStepNumber,
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
        stepNumber: currentStepNumber,
      });
    };

    let waitCallIdInStep: string | undefined;
    let waitRequest: WaitRequest | undefined;
    let pendingWait = false;
    let deferredWaitStep = false;
    let deferredWaitDeclaration: ModelToolDeclaration | undefined;
    const deferredWaitCalls: Array<Promise<PromiseSettledResult<void>>> = [];

    // Trusted execution context for tools — built from the RUN's fields,
    // NEVER from model input, so a tool's data scope can't be widened by the
    // model (authorization identity from a trusted source only). Matches
    // ToolContext (tools/types.ts) exactly.
    const toolContext: ToolContext = {
      runId: input.runId,
      nativeExecutorId: this.instanceConfig.config.tools.nativeExecutorId,
      nativeDeliverySequence,
      attemptId,
      onNativeMutationUnknown: () =>
        nativeAbort?.abort(NATIVE_MUTATION_ABORT_REASON),
      productUserAgent: this.instanceConfig.productUserAgent,
      userId: input.userId,
      chatId: input.chatId,
      workspaceRoot,
      workspaceMcp: this.workspaceMcp,
      workspaceMcpListing,
      tenantDb: this.tenantDb,
      abortSignal: input.abortSignal,
      knowledgeResolver: this.knowledgeResolver,
      skillCatalog: this.skillCatalogFor(workspaceRoot.current()),
      // A manual-only skill the user named stays readable for this Run's tool
      // calls, references and scripts included; a turn that did not name it
      // carries an empty set and refuses again.
      skillSelection,
      // The Run owner's media, for image reads and `media://` (vision-media
      // D7); an image read is held in this attempt's memory only.
      media: createToolMediaStore(
        new MediaService(this.tenantDb),
        input.userId,
        media.retainedMedia,
      ),
      queryEmbedder: this.queryEmbedder,
      permissionPolicy: this.permissionPolicy,
      configuredCredentials: configuredCredentials(this.instanceConfig.config),
      webAdapters: this.instanceConfig.config.tools.webAdapters,
      webSearch: this.instanceConfig.config.webSearch,
      grepBounds: this.instanceConfig.config.tools.grep,
      ...this.artifactReadContext(),
      bashProcessLimiter: this.hostBashLimiter(),
      bashJobs: this.bashJobs,
      jobSettings: {
        modelId: client.model,
        effort,
        permissionMode: effectivePermissionMode,
      },
      allowUnlimitedJobs: this.instanceConfig.config.tools.jobs.allowUnlimited,
      bashBackgroundAfterSeconds:
        this.instanceConfig.config.tools.bash.backgroundAfterSeconds,
      callTimeoutSeconds: this.instanceConfig.config.tools.callTimeoutSeconds,
      workerDeadAfterSeconds: workerDeadAfterSeconds(
        this.instanceConfig.config,
      ),
      modelClients: this.models,
      decisions: this.decisions,
      permissionMode: effectivePermissionMode,
      machines: this.machineConnector,
      machineStatus: this.machinesStatus,
      machineAttemptKey: machineAttemptKey(input.runId, nativeDeliverySequence),
      sshClient: this.sshClient,
      executorGit: this.executorGit,
      beginWaitCall: (toolCallId) => {
        if (waitCallIdInStep !== undefined) return waitCallIdInStep;
        waitCallIdInStep = toolCallId;

        return undefined;
      },
      onWaitRequested: (request) => {
        waitRequest = request;
      },
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
    // The step the live stream is in, for `tool.requested`'s step number
    // (turn-actions D6). `onStepStart` stamps it before each step's request, so
    // every call a step makes carries that step. A stored part carries the
    // reply-wide number instead: `stepOffset + currentStepNumber`, so a
    // Continue Run's own parts continue after the steps it kept (design D5)
    // and a run with no tool step at all still numbers its parts from the
    // offset.
    let currentStepNumber = 0;

    const openToolCalls = new Map<
      string,
      {
        toolName: string;
        toolInput: unknown;
        intent?: string;
        /** The step of the reply that requested the call (design D5). */
        step: number;
        /**
         * The SDK's own error text and input for a call its repair hook
         * refused, on the path that never ran the tool (design D3, A8).
         */
        sdkRefusal?: SdkRefusal;
        permission?: PermissionDecision;
        /** Derived-locator decisions, collected while the executor runs. */
        derivedDecisions?: Array<DerivedDecisionRecord>;
        /** Absent means model-origin (tool-activity-origin.ts). */
        origin?: ToolActivityOrigin;
        /**
         * The executing tool's classification, recorded only for a call that
         * started; a rejected call stores `classification: null` on its part
         * (turn-actions D10).
         */
        classification?: ToolClassification;
        /** The signal an owner interrupt aborts, for a call whose fate is `cancel`. */
        interruptSignal?: AbortSignal;
        /** What an interrupt does to this call, decided from its target. */
        fate?: InterruptFate;
        /** `tool.requested` was emitted for the call. */
        requested?: true;
        /** The call recorded its MCP `native.attempt`, so it was sent. */
        mcpDispatched?: boolean;
        /** Settles when the tool body returns; an interrupt waits on `finish` calls. */
        done?: Promise<void>;
      }
    >();

    // The opaque provider metadata each call's stream part carried (design
    // A7), keyed by its id. A SEPARATE map from `openToolCalls`: the consumer
    // reports the metadata before the SDK executes the call, i.e. before
    // `reserveToolRequest` and admission, so the entry exists first and the
    // request records what it holds. The call's settlement consumes it.
    const pendingToolMetadata = new Map<string, ProviderMetadata>();

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
      {
        origin,
        sdkRefusal,
        intent,
      }: {
        origin?: ToolActivityOrigin;
        sdkRefusal?: SdkRefusal;
        intent?: string;
      } = {},
    ) => {
      openToolCalls.set(toolCallId, {
        toolName,
        toolInput,
        ...(intent !== undefined && { intent }),
        step: stepOffset + currentStepNumber,
        ...(origin !== undefined && { origin }),
        ...(sdkRefusal !== undefined && { sdkRefusal }),
      });

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
        ...(openToolCalls.get(toolCallId)?.intent !== undefined && {
          intent: openToolCalls.get(toolCallId)?.intent,
        }),
        // The step the call was requested in, stamped by `onStepStart` in the
        // SDK's own numbering (it restarts at 0 in every request). A call
        // outside any step (the step cap's forced answer) keeps the last one.
        // The stored part carries the reply-wide number instead (design D5).
        stepNumber: currentStepNumber,
      };

      if (permission !== undefined) payload.permission = permission;

      if (origin !== undefined) payload.origin = origin;
      const providerMetadata = pendingToolMetadata.get(toolCallId);

      if (providerMetadata !== undefined) {
        payload.providerMetadata = providerMetadata;
      }

      enqueueEvent('tool.requested', payload);
      const open = openToolCalls.get(toolCallId);

      if (open !== undefined) open.requested = true;
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
      appendDerivedDecision(decisions, decision);
    };

    const recordToolCompleted = (
      toolCallId: string,
      toolName: string,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- same rationale as `reserveToolRequest` above: the AI SDK's inputSchema validation already ran before this value ever reaches either function.
      toolInput: unknown,
      result: ToolResult,
      interrupted = false,
    ) => {
      if (settledToolCallIds.has(toolCallId)) {
        return;
      }

      settledToolCallIds.add(toolCallId);
      stepToolsCompleted += 1;
      const open = openToolCalls.get(toolCallId);
      const { permission, derivedDecisions, intent } = open ?? {};
      // Stored once, on the call (design A7): the request event already
      // carries it, and every settlement path copies it from here.
      const providerMetadata = pendingToolMetadata.get(toolCallId);
      pendingToolMetadata.delete(toolCallId);
      openToolCalls.delete(toolCallId);

      // A model `read` of an unstored file keeps its bytes on the result's
      // part and event; the bound is decided here, once, before either is
      // written, so the live step, the event, the stored part, and a rebuilt
      // reply all agree (D5). A call that records no bytes names no marker:
      // its entry (a failed read, a dropped import, an instruction read) would
      // only hold base64 for the rest of the attempt.
      const retained = settleRetainedMedia({
        retainedMedia: media.retainedMedia,
        toolCallId,
        toolName,
        origin: open?.origin,
        status: result.status,
        used: retainedBytesUsed,
      });

      retainedBytesUsed = retained.used;

      if (retained.record === undefined) {
        media.retainedMedia.delete(toolCallId);
      }

      const payload: ToolCompletedEventPayload = {
        toolCallId,
        toolName,
        status: result.status,
        output: result,
        ...(retained.record !== undefined && {
          retainedMedia: retained.record,
        }),
        // Model-only, so a reply rebuilt from the log carries it too (D3/A8).
        ...(open?.sdkRefusal !== undefined && {
          sdkRefusal: open.sdkRefusal,
        }),
        ...(interrupted && { interrupted: true as const }),
      };

      if (permission !== undefined) payload.permission = permission;

      if (derivedDecisions?.length) {
        payload.derivedDecisions = derivedDecisions;
      }

      if (open?.origin !== undefined) payload.origin = open.origin;
      enqueueEvent(
        'tool.completed',
        payload,
        toolName === 'stop' && result.status === 'success'
          ? async (tx) => {
              const fenced = await new RunsRepository(tx).updateForAttempt(
                input.runId,
                input.userId,
                attemptId,
                { activeAttemptId: attemptId },
              );

              if (
                !fenced ||
                fenced.cancelRequestedAt !== null ||
                !(await new ChatsRepository(tx).lock(
                  input.chatId,
                  input.userId,
                ))
              ) {
                return { ...payload, consumedJobNoticeIds: [] };
              }

              const reportedJobs =
                isRecord(result) && Array.isArray(result['jobs'])
                  ? result['jobs']
                  : [];

              const settledJobIds: Array<string> = [];
              const jobs = new ChatJobsRepository(tx);

              for (const entry of reportedJobs) {
                if (
                  !isRecord(entry) ||
                  !isString(entry['job']) ||
                  !isString(entry['state']) ||
                  (entry['state'] !== 'succeeded' &&
                    entry['state'] !== 'failed' &&
                    entry['state'] !== 'cancelled' &&
                    entry['state'] !== 'timed_out' &&
                    entry['state'] !== 'lost')
                ) {
                  continue;
                }

                const locator = parseJobLocatorText(entry['job']);

                if (!locator) continue;

                const job = await jobs.findByLocator(
                  input.chatId,
                  input.userId,
                  locator.executor,
                  locator.seq,
                );

                if (
                  job &&
                  job.state !== 'running' &&
                  job.state === entry['state']
                ) {
                  settledJobIds.push(job.id);
                }
              }

              const consumedJobNoticeIds = await new ChatDeliveriesRepository(
                tx,
              ).consumeJobNotices({
                chatId: input.chatId,
                ownerUserId: input.userId,
                runId: input.runId,
                jobIds: settledJobIds,
              });

              return { ...payload, consumedJobNoticeIds };
            }
          : undefined,
      );

      // A system-origin call is durable audit, not assistant activity.
      if (open?.origin !== undefined) return;
      assistantPartCollector.tool(
        toolActivityPart({
          toolCallId,
          toolName,
          input: toolInput,
          intent,
          result,
          step: open?.step ?? stepOffset + currentStepNumber,
          sdkRefusal: open?.sdkRefusal,
          providerMetadata,
          permission,
          derivedDecisions,
          classification: open?.classification ?? null,
          retainedMedia: retained.record,
          interrupted,
        }),
      );
    };

    const completePendingWait = async (
      request: WaitRequest,
      cause: 'settled' | 'interrupted' | 'timeout',
    ): Promise<void> => {
      const open = openToolCalls.get(request.toolCallId);

      const result = await retryRunTransaction(() =>
        this.tenantDb.runAs(input.userId, async (tx) => {
          if (!(await new ChatsRepository(tx).lock(input.chatId, input.userId)))
            throw new RunNotRunnableError(input.runId);

          const run = await new RunsRepository(tx).findById(
            input.runId,
            input.userId,
          );

          if (run?.activeAttemptId !== attemptId)
            throw new RunNotRunnableError(input.runId);

          return completeWaitInTransaction(tx, run, request, cause);
        }),
      );

      settledToolCallIds.add(request.toolCallId);
      openToolCalls.delete(request.toolCallId);
      const providerMetadata = pendingToolMetadata.get(request.toolCallId);
      pendingToolMetadata.delete(request.toolCallId);
      assistantPartCollector.tool(
        toolActivityPart({
          toolCallId: request.toolCallId,
          toolName: 'wait',
          input: open?.toolInput ?? request.toolInput,
          intent: open?.intent,
          result,
          step: open?.step ?? stepOffset + currentStepNumber,
          providerMetadata,
          permission: open?.permission,
          classification: 'read_only',
        }),
      );
    };

    /**
     * Settle selected still-open tool calls when the run terminates (#293).
     * Runs through recordToolCompleted so each settlement emits its durable
     * `tool.completed` event AND fills its reserved part — the live stream,
     * the event log and history then agree. Host bash calls stay open during
     * the bounded parent-abort grace so a known result can win; after it, a
     * Run-row-fenced `native.result` arbitrates with any pending promotion
     * before the tool activity is completed.
     * The part collector ignores a genuine late result for an already-settled
     * call.
     */
    const settleOpenToolCalls = async (
      status: 'cancelled' | 'expired' | 'failed',
      shouldSettle: (toolName: string) => boolean = () => true,
    ) => {
      // recordToolCompleted deletes the current key; removing the entry being
      // visited is well-defined for a Map iterator.
      for (const [
        toolCallId,
        { toolName, toolInput, classification },
      ] of openToolCalls) {
        if (!shouldSettle(toolName)) continue;

        let result = toolTerminationResult(status, toolName);

        if (
          toolName === 'bash' &&
          classification !== undefined &&
          isRecord(toolInput) &&
          isHostBashCall(toolInput, toolContext)
        ) {
          await deltaWrites;
          result = await recoverHostPromotionWithRetry(this.tenantDb, {
            runId: input.runId,
            userId: input.userId,
            attemptId,
            toolCallId,
            result,
          });
        }

        recordToolCompleted(toolCallId, toolName, toolInput, result);
      }
    };

    const settleOpenToolsAndDrain = async (
      status: Exclude<TerminalRunStatus, 'completed'>,
      telemetry: AssistantTurnTelemetry,
    ): Promise<boolean> => {
      await settleOpenToolCalls(status);
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

    // --- A send that broke after a started tool call (design D1-D3) ---
    // `callStream` resets these per call. The cut is applied once per failed
    // send, so the abort and finish writers cannot cut twice.
    let cutAnchor: CutAnchor | undefined;
    let sendFailure: FailedSend | undefined;
    let failedSendCut: FailedSendCut | undefined;

    /**
     * Records a send that failed after it streamed its complete tool-call part
     * (D1), while the send's calls still run. A send without such a part, and
     * a failure that arrives before this step's first call, keep the shipped
     * retry and failure paths.
     */
    const noteSendFailure = (error: unknown): void => {
      if (sendFailure !== undefined) return;

      if (!(error instanceof ProviderFailure) || !error.toolCallStarted) return;

      if (cutAnchor === undefined) return;

      sendFailure = {
        failure: error,
        step: currentStepNumber,
        anchor: cutAnchor,
      };
    };

    /**
     * Captures the cut anchor of a just-arrived complete tool-call part (D3):
     * both delta buffers flush first, so a short text prefix before the call
     * stays outside the cut, and the sequence read queues behind every event
     * written so far, exactly as `persistStepStartSequence` does.
     */
    const persistCutAnchor = (): void => {
      persistReasoning(reasoningDeltas.flush());
      persistDelta(deltas.flush());
      // The call is a structurally distinct part, so the text the send
      // streams after it is a new part even under the id the wire kept (D3).
      textPartEnded = true;

      // Only the output parts the reply held: a call settled later takes its
      // placeholder's slot in place, so a full count would move the boundary.
      const keptOutput = assistantPartCollector
        .parts()
        .filter((part) => isTextPart(part) || isReasoningPart(part)).length;

      let sequence = 0;

      const read = queueNextSequence('cut anchor', (next) => {
        sequence = next;
      });

      cutAnchor = { sequence: read.then(() => sequence), keptOutput };
    };

    /**
     * The cut of the failed send (D3/D6): drops the text and reasoning it
     * streamed after its last complete tool-call part, keeps its tool parts,
     * and stores the `provider-failure` notice directly after the last of them.
     * Applied at most once per send; every writer that persists the reply
     * awaits it first.
     */
    const applyFailedSendCut = async (): Promise<FailedSendCut | undefined> => {
      if (sendFailure === undefined) return undefined;

      if (failedSendCut !== undefined) return failedSendCut;

      const { failure, step, anchor } = sendFailure;
      const fromSequence = await anchor.sequence;

      // A failed progress write settles the Run through its shipped path.
      if (progressWriteFailed) return undefined;

      // Keep the output the send streamed through its last complete call: the
      // first parts its anchor counted, since text and reasoning only ever
      // append. Every other part — calls, context items — is kept regardless
      // of where a later settled call placed it.
      let outputSeen = 0;

      const kept = assistantPartCollector.parts().filter((part) => {
        if (!isTextPart(part) && !isReasoningPart(part)) return true;
        outputSeen += 1;

        return outputSeen <= anchor.keptOutput;
      });

      const notice = createProviderFailureItem({
        runId: input.runId,
        failureClass: failure.code,
      });

      const lastToolPart = kept.findLastIndex(
        (part) => isRecord(part) && isString(part['toolCallId']),
      );

      assistantPartCollector = createAssistantPartCollector();
      assistantPartCollector.seed([
        ...kept.slice(0, lastToolPart + 1),
        notice,
        ...kept.slice(lastToolPart + 1),
      ]);
      // The failed send reported no usage, so the reply is not complete.
      discardedSend = true;
      failedSendCut = {
        superseded: { fromSequence, step: stepOffset + step },
        notice,
      };

      return failedSendCut;
    };

    /**
     * Ends the Run an `onError` error that is not the failed send itself
     * leaves: it settles the open calls, keeps the cut and the notice of an
     * earlier failed send, and writes the reply with the terminal events (D6).
     */
    const settleErrorOutcome = async (
      error: unknown,
      status: FailedSendStatus,
      assistantTelemetry: AssistantTurnTelemetry,
      progressFailureTelemetry: AssistantTurnTelemetry,
    ): Promise<void> => {
      // A stalled model stream is a model-level failure, not an abort: it
      // ends the run terminally `failed` under its own error code so the
      // cause survives on the run and its event (the same treatment
      // `outcome_unknown` gets), and the job succeeds without a retry.
      const failure = modelRequestFailure(error);

      const message =
        status === 'expired'
          ? expiredRunMessage(input.abortSignal)
          : errorMessageWithoutParams(error);

      // Settle before reading parts: a call still open here was rendered as
      // running live, and an unsettled part is filtered out of history — so
      // without this the live view and the reload disagree.
      if (!(await settleOpenToolsAndDrain(status, progressFailureTelemetry)))
        return;

      // A reply this error ends still keeps the cut and the notice of an
      // earlier failed send, and names the cut (D6).
      const cut = await applyFailedSendCut();

      // One record for the payload and the error: both name the same cause.
      const failureDetails = {
        message,
        ...(status === 'failed' && {
          code: failure.code,
          ...(failure.resetsAt !== undefined && {
            resetsAt: failure.resetsAt,
          }),
        }),
      };

      const turn: AssistantTurnWrite = {
        chatId: input.chatId,
        inReplyTo: input.userMessage.id,
        // Same "show what the user actually saw" honesty as streamedText:
        // reasoning and any tool activity that happened before the
        // abort/error are kept too, not silently dropped while the partial
        // answer survives. No cap notice here — the run didn't complete (see
        // onFinish), so it can't claim "answered at cap".
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
        runPayload: { status, ...failureDetails },
        error: failureDetails,
        assistantTurn: turn,
        superseded: cut?.superseded,
      });

      await this.afterAssistantTurn(
        finish.assistantMessage,
        input.userId,
        turn.telemetry,
      );
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
      classification: ToolClassification,
      origin?: ToolActivityOrigin,
    ): Promise<void> => {
      const open = openToolCalls.get(toolCallId);
      const started = decision.decision === 'allow';

      if (open !== undefined) {
        open.permission = decision;

        // Only a started call has a classification; its part records the tool
        // that ran it, and a rejected call's part records `null`.
        if (started) open.classification = classification;
      }

      emitToolRequested(toolCallId, toolName, args, decision, origin);

      if (started) {
        enqueueEvent('tool.started', { toolCallId, toolName, classification });
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
      canonicalPath?: string,
    ): Promise<ToolResult> => {
      const toolCallId = turnInstructions.nextToolCallId();
      const toolInput = { path: selectorPath };
      reserveToolRequest(toolCallId, 'read', toolInput, {
        origin: ORIGIN_INSTRUCTIONS,
      });

      const result = await runTool(
        nativeReadTool,
        toolInput,
        {
          ...toolContext,
          toolCallId,
          canonicalReadPath: canonicalPath,
          onDerivedDecision: (decision) =>
            recordDerivedDecision(toolCallId, decision),
        },
        callTimeoutSeconds,
        (decision) =>
          admitToolCall(
            toolCallId,
            'read',
            toolInput,
            decision,
            nativeReadTool.classification,
            ORIGIN_INSTRUCTIONS,
          ),
      );

      recordToolCompleted(toolCallId, 'read', toolInput, result);

      return result;
    };

    const admitsRead = (path: string): boolean =>
      previewToolPermission(nativeReadTool, { path }, toolContext);

    const inRunProducer = this.beginInRunAttempt(
      input,
      turnInstructions,
      turnGit,
      workspaceRoot,
      readInstructionPage,
      admitsRead,
    );

    let toolAdditions: AttemptToolAdditions;
    // --- Owner interrupt (run-steering D7) ---
    // The controller of the model call in flight; every call that follows a
    // withdrawn interrupt gets a new one.
    let segment: AbortController | undefined;
    // The yield signal of the same model call (background-jobs D13).
    let segmentYield: AbortSignal | undefined;
    let interruptSettlement: Promise<void> | undefined;
    // The step's interrupt settlement and delivery, recorded once per model
    // call: it reports whether the delivery ran, so a later `onFinish` on a
    // step the SDK already recorded waits for it instead of deciding the Run
    // again, and a Stop that lands during the delivery is not mistaken for a
    // delivery that never happened (D2/D6).
    let interruptOutcome: Promise<boolean> | undefined;
    // The `bash` and MCP calls that started and that the interrupt stopped.
    const stoppedCalls: Array<StoppedCall> = [];
    // `native.result` writes of MCP calls whose attempt committed mid-interrupt.
    const lateMcpWrites: Array<Promise<void>> = [];

    const settleInterrupted = (
      shouldSettle: (call: {
        toolName: string;
        started: boolean;
        fate?: InterruptFate;
      }) => boolean,
      mcpWrites: Array<Promise<void>>,
    ) => {
      for (const [toolCallId, call] of openToolCalls) {
        // System-origin reads finish on their own and are no model call.
        if (call.origin !== undefined) continue;
        const started = call.classification !== undefined;

        if (
          !shouldSettle({ toolName: call.toolName, started, fate: call.fate })
        )
          continue;

        const { result, stopped } = interruptSettlementOf({
          toolName: call.toolName,
          started,
          mcpDispatched: call.mcpDispatched === true,
        });

        if (stopped) {
          stoppedCalls.push({ toolName: call.toolName, toolCallId });

          // A later retry of a sent MCP call must not find a bare attempt.
          if (call.toolName.startsWith('mcp__')) {
            mcpWrites.push(
              this.recordInterruptedMcpResult(input, toolCallId, result),
            );
          }
        }

        // A call still waiting on admission has no request event yet; the
        // stream and the event-rebuilt reply drop a completion without one.
        // No classification is set, so the call stays not started.
        if (call.requested !== true) {
          emitToolRequested(
            toolCallId,
            call.toolName,
            call.toolInput,
            undefined,
          );
        }

        recordToolCompleted(
          toolCallId,
          call.toolName,
          call.toolInput,
          result,
          true,
        );
      }
    };

    /**
     * Settles the open calls once, by fate: a call that never started, and each
     * started `cancel` call but bash, at once; a `finish` or `background` call
     * after it completes (a host command returns when its segment yields);
     * bash after its bounded grace, so a proven result can win.
     */
    const settleOnInterrupt = (): Promise<void> =>
      (interruptSettlement ??= (async () => {
        const mcpWrites: Array<Promise<void>> = [];
        settleInterrupted(
          (call) =>
            (call.fate ?? 'cancel') === 'cancel' &&
            (call.toolName !== 'bash' || !call.started),
          mcpWrites,
        );
        await Promise.all(
          [...openToolCalls.values()].flatMap((call) =>
            call.done !== undefined && (call.fate ?? 'cancel') !== 'cancel'
              ? [call.done]
              : [],
          ),
        );

        if (
          [...openToolCalls.values()].some(
            (call) =>
              call.origin === undefined && (call.fate ?? 'cancel') === 'cancel',
          )
        ) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, BASH_SETTLEMENT_GRACE_MS);
          });
          settleInterrupted(
            (call) => (call.fate ?? 'cancel') === 'cancel',
            mcpWrites,
          );
        }

        await Promise.all(mcpWrites);
        await deltaWrites;
      })());

    const executeBoundTool = async (
      declaration: ModelToolDeclaration,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- the AI SDK validates tool arguments against the declaration schema before this trusted wrapper runs.
      args: unknown,
      toolCallId: string,
    ) => {
      // Reasoning that directly precedes a call has no text to cross-flush
      // it, so drain both buffers before the call's events.
      persistReasoning(reasoningDeltas.flush());
      persistDelta(deltas.flush());
      const executor = toolAdditions.executorFor(declaration.id);

      if (executor === undefined) {
        throw new Error(`Tool "${declaration.id}" has no executor.`);
      }

      // A `cancel` call also stops on its segment's interrupt signal, which is
      // separate from the Run's cancellation (run-steering D7).
      const open = openToolCalls.get(toolCallId);

      // The fate is decided from the call's own target, never from its tool
      // name: a host command yields, and a remote one is stopped (D13).
      const fate = interruptFateOf(executor, args, {
        ...toolContext,
        toolCallId,
      });

      const interruptSignal = fate === 'cancel' ? segment?.signal : undefined;

      if (open !== undefined) open.fate = fate;

      if (open !== undefined && interruptSignal !== undefined) {
        open.interruptSignal = interruptSignal;
      }

      const result = await runTool(
        executor,
        args,
        {
          ...toolContext,
          toolCallId,
          yieldSignal: segmentYield,
          abortSignal: callAbortSignal(input.abortSignal, interruptSignal),
          onDerivedDecision: (decision) =>
            recordDerivedDecision(toolCallId, decision),
          onMcpDispatchRecorded: () => {
            if (open !== undefined) open.mcpDispatched = true;

            // The attempt committed after the interrupt settled the call as
            // not run: record its result so a retry finds no bare attempt.
            if (settledToolCallIds.has(toolCallId)) {
              lateMcpWrites.push(
                this.recordInterruptedMcpResult(
                  input,
                  toolCallId,
                  interruptSettlementOf({
                    toolName: declaration.id,
                    started: true,
                    mcpDispatched: true,
                  }).result,
                ),
              );
            }
          },
        },
        callTimeoutSeconds,
        async (decision) => {
          // The interrupt already settled a call that was not admitted yet.
          if (settledToolCallIds.has(toolCallId)) return;
          await admitToolCall(
            toolCallId,
            declaration.id,
            args,
            decision,
            executor.classification,
          );

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
      const open = openToolCalls.get(toolCallId);

      if (open?.interruptSignal?.aborted && !input.abortSignal?.aborted) {
        // An owner interrupt aborted this call. Bash gets its bounded chance to
        // report its own proven result, which the interrupt marks; every other
        // call is settled by the interrupt settlement (run-steering D7). A
        // call the abort reached between admission and spawn never ran.
        const neverRan = isCancelledBeforeExecution(result, declaration.id);

        const provenBash =
          isBashTool(executor) &&
          !neverRan &&
          !(result.status === 'error' && result.type === 'outcome_unknown');

        if (neverRan && isBashTool(executor)) {
          recordToolCompleted(
            toolCallId,
            declaration.id,
            args,
            interruptSettlementOf({
              toolName: declaration.id,
              started: false,
              mcpDispatched: false,
            }).result,
            true,
          );
        } else if (provenBash) {
          stoppedCalls.push({ toolName: declaration.id, toolCallId });
          recordToolCompleted(toolCallId, declaration.id, args, result, true);
        } else {
          await interruptSettlement;
        }
      } else if (input.abortSignal?.aborted) {
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

      // Live bash and MCP unknowns stay observations; only uncertain native
      // file mutations (edit/write) abort the model loop here.
      if (
        isNativeFileTool(executor) &&
        executor.id !== 'read' &&
        result.status === 'error' &&
        result.type === 'outcome_unknown'
      ) {
        await deltaWrites;
        throw new Error(
          'Host command or mutation outcome is unknown; the Run cannot continue.',
        );
      }

      return result;
    };

    const executeDeclaredTool = (
      declaration: ModelToolDeclaration,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- both SDK execution and the observed-call path have passed the declaration schema.
      submitted: unknown,
      toolCallId: string,
    ): Promise<ToolResult> => {
      const { input: args, intent } = splitToolIntent(
        declaration.id,
        submitted,
      );

      reserveToolRequest(toolCallId, declaration.id, args, { intent });

      const completion = Promise.withResolvers<void>();
      const open = openToolCalls.get(toolCallId);

      if (open !== undefined) open.done = completion.promise;

      return executeBoundTool(declaration, args, toolCallId)
        .then(({ executor, result }) => {
          if (
            declaration.id === 'wait' &&
            result === WAIT_SUSPENSION &&
            waitRequest?.toolCallId === toolCallId &&
            !input.abortSignal?.aborted &&
            !open?.interruptSignal?.aborted &&
            !settledToolCallIds.has(toolCallId)
          ) {
            pendingWait = true;

            return WAIT_SUSPENSION;
          }

          return settleBoundTool(
            declaration,
            args,
            toolCallId,
            executor,
            result,
          );
        })
        .finally(completion.resolve);
    };

    const createModelToolDefinition = (
      declaration: ModelToolDeclaration,
    ): ToolSet[string] => {
      const initialExecutor = boundExecutables.get(declaration.id)?.executor;

      if (initialExecutor === undefined) {
        throw new Error(`Tool "${declaration.id}" has no executor.`);
      }

      if (declaration.id === 'wait') {
        deferredWaitDeclaration = declaration;

        return tool({
          description: declaration.description,
          inputSchema: toFlexibleSchema(declaration.inputSchema)!,
          strict: false,
        });
      }

      // Every result reaches the model through the one rendering: a native
      // file tool as its serialized text — the SDK output type its media
      // reference needs — and every other tool as its JSON value. An image
      // result adds only its reference, which the step composer projects on
      // every step (vision-media D6), so no bytes stay in the Run's response
      // messages.
      const definition = tool<unknown, ToolResult>({
        description: declaration.description,
        inputSchema: toFlexibleSchema(declaration.inputSchema)!,
        execute: (
          // eslint-disable-next-line anti-slop/no-unknown-parameters -- the SDK validates this call against the declaration schema before execution.
          args: unknown,
          { toolCallId }: { toolCallId: string },
        ) => executeDeclaredTool(declaration, args, toolCallId),
        toModelOutput: ({
          input: call,
          output,
          toolCallId,
        }: {
          input: unknown;
          output: ToolResult;
          toolCallId: string;
        }) =>
          modelToolOutput(
            renderToolResultForModel(declaration.id, output),
            // A result without a stored locator is a reference only while
            // this attempt holds its bytes: the step composer then attaches
            // them or the matching placeholder (D2).
            retainedReadRef(
              media.retainedMedia,
              toolCallId,
              mediaResultRef(output, submittedLocator(call)),
            ),
          ),
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

      parentAbortSettlement = (async () => {
        await settleOpenToolCalls(status, (toolName) => toolName !== 'bash');

        if (hasBashCall) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, BASH_SETTLEMENT_GRACE_MS);
          });
        }

        await settleOpenToolCalls(status);

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

        // A Stop or expiry during the wait for a failed send's calls keeps the
        // cut and the notice, and names the cut in the terminal write (D6).
        const cut = await applyFailedSendCut();

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
            assistantTurn: {
              chatId: input.chatId,
              inReplyTo: input.userMessage.id,
              parts: assistantPartCollector.parts(),
              telemetry: assistantTelemetry,
            },
            runPayload: { status, message },
            error: { message },
            superseded: cut?.superseded,
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

    // Each model call of the attempt is one `streamText` (the segment's first,
    // and one more whenever a step end found nothing left to deliver), so the
    // abort listener and the workspace hold belong to the call.
    let endWorkspaceAttempt = noop;

    let stopCause:
      | 'cancel'
      | 'delivery'
      | 'suspend'
      | 'compact'
      | 'superseded'
      | 'quota'
      | undefined;

    let automaticCompactionAtBoundary = false;
    let boundaryCallMessages: typeof messages = messages;
    let stepStartSequence = 1;
    let stepModelOutputStart = 0;
    let stepStreamedText = '';
    let stepFirstOutputDeltaMs: number | undefined;
    let stepOutputDeltaCount = 0;
    let stepResultStart = 0;
    let stepToolsCompleted = 0;
    let progressCheckMedia: MediaSizing | undefined;

    const compactableRange =
      boundaryCompactionPlan(attemptContext, input.userMessage.seq) !== null;

    const automaticCompactionDueAtBoundary = async (): Promise<boolean> => {
      const projectedParts = assistantPartCollector
        .parts()
        .slice(stepResultStart);

      return this.automaticCompactionDueAtBoundary({
        hasBoundary:
          stepToolsCompleted > 0 &&
          !automaticCompactionDisabled &&
          compactableRange,
        replyParts: projectedParts,
        latestRequestContextTokens: requestUsageReceipts.at(-1)?.inputTokens,
        requestMessages: boundaryCallMessages,
        system,
        toolDeclarations: prepared.toolDeclarations,
        thresholdTokens: compactionThreshold,
        client,
        media,
      });
    };

    const suspendedByThisAttempt = async (tx: Db): Promise<boolean> => {
      const events = await new RunEventsRepository(tx).listByRunId(
        input.runId,
        input.userId,
        { eventTypes: ['run.suspended'], attemptId, limit: 1 },
      );

      return events.length !== 0;
    };

    // The step end settles dead Chat jobs before checking delivery/cancellation,
    // so a lost worker's notice participates in this same boundary. A durable
    // suspension belongs to this attempt even if a waker already queued or
    // claimed the Run again.
    const resolveStepEndSignal = async (): Promise<StepEndSignal> =>
      retryRunTransaction(() =>
        this.tenantDb.runAs(input.userId, async (tx) => {
          await new ChatJobsRepository(tx).settleOnDeadWorkers(
            input.chatId,
            input.userId,
            workerDeadAfterSeconds(this.instanceConfig.config),
          );

          if (await suspendedByThisAttempt(tx)) return 'suspend';

          return new ChatDeliveriesRepository(tx).stepEndSignal({
            runId: input.runId,
            chatId: input.chatId,
            userId: input.userId,
          });
        }),
      );

    /**
     * The cause a step end records: the Run's own signal, or the compaction
     * the step owes when nothing outranks it (D1/D4). A cancellation or
     * suspension outranks the compaction, and a spent boundary leaves the
     * cause undefined.
     */
    const resolveBoundaryCause = async (): Promise<FailedStepCause> => {
      const signal = await resolveStepEndSignal();

      if (
        signal === 'cancel' ||
        signal === 'suspend' ||
        !(await automaticCompactionDueAtBoundary())
      )
        return signal;

      automaticCompactionAtBoundary = true;

      return signal ?? 'compact';
    };

    /**
     * The boundary cause of a step whose send failed after a started call,
     * decided once (D1/D4): the SDK asks `stopWhenExtra` after a started call
     * settles, but a `wait` call has no output, so the loop ends without asking
     * and `onFinish` computes the same cause here.
     */
    let failedStepBoundary: { readonly cause: FailedStepCause } | undefined;

    const resolveFailedStepBoundary = async (): Promise<FailedStepCause> => {
      failedStepBoundary ??= { cause: await resolveBoundaryCause() };

      return failedStepBoundary.cause;
    };

    const stopWhenExtra = async (): Promise<boolean> => {
      // A failed step ends the SDK loop with its own cause: the delivery,
      // cancellation, suspension, and compaction checks keep their shipped
      // meaning, `stopCause` is left alone, and no quota recovery is recorded
      // (the counts carry over, D1).
      if (sendFailure !== undefined) {
        failedStepBoundary = { cause: await resolveBoundaryCause() };

        return true;
      }

      await recordQuotaRecovery('completed');
      stopCause = await resolveBoundaryCause();

      return stopCause !== undefined;
    };

    const suspendPendingWait = async (
      telemetry: AssistantTurnTelemetry,
    ): Promise<'suspended' | 'cancelled' | 'ready'> => {
      if (
        !pendingWait ||
        waitRequest === undefined ||
        settledToolCallIds.has(waitRequest.toolCallId)
      )
        return 'ready';

      const request = waitRequest;
      const open = openToolCalls.get(request.toolCallId);

      const suspension = await this.waitService().suspend({
        runId: input.runId,
        chatId: input.chatId,
        userId: input.userId,
        attemptId,
        ...request,
        parts: assistantPartCollector.parts(),
        steps: {
          [request.toolCallId]: open?.step ?? stepOffset + currentStepNumber,
        },
        telemetry,
      });

      if (suspension.kind === 'suspended') return 'suspended';

      if (suspension.cause === 'cancelled') return 'cancelled';

      await completePendingWait(request, suspension.cause);

      return 'ready';
    };

    const callStream = async (
      callMessages: typeof messages,
      stepBase: number,
      requestRetriesUsed = 0,
      skipInitialContextPreparation = false,
      pendingFailedSend?: {
        readonly failure?: ProviderFailure;
        readonly cut?: FailedSendCut;
      },
    ): Promise<AttemptRun> => {
      let nextCall = noNextCall;
      const partsBefore = assistantPartCollector.parts().length;
      // A new call is a new send: the anchor of its first step, its failure,
      // and its cut all start over, while the collector keeps the cut the
      // previous call left.
      cutAnchor = undefined;
      sendFailure = undefined;
      failedSendCut = undefined;
      failedStepBoundary = undefined;
      let pendingCut = pendingFailedSend?.cut;

      if (input.abortSignal?.aborted) {
        settleToolsOnParentAbort();
      } else {
        input.abortSignal?.addEventListener('abort', settleToolsOnParentAbort, {
          once: true,
        });
      }

      endWorkspaceAttempt = this.beginWorkspaceAttempt(
        input.chatId,
        workspaceMcpKey,
      );

      // This call's segment controller: the run-control listener aborts it on an
      // owner interrupt while the call is in flight (run-steering D7).
      const callControl =
        this.segmentAborts?.beginSegment(input.runId, attemptId) ??
        newSegmentControl();

      const callSegment = callControl.abort;
      segment = callSegment;
      segmentYield = callControl.yield.signal;
      interruptSettlement = undefined;
      interruptOutcome = undefined;
      stoppedCalls.length = 0;
      const callSignal = callAbortSignal(input.abortSignal, callSegment.signal);

      const onInterrupt = () => {
        // The yield comes first, so a host command returns before the
        // settlement waits for it.
        callControl.yield.abort();
        settleOnInterrupt().catch(noop);
      };

      callSegment.signal.addEventListener('abort', onInterrupt, { once: true });

      const closeSegment = () => {
        callSegment.signal.removeEventListener('abort', onInterrupt);
        this.segmentAborts?.endSegment(input.runId, callControl);
      };

      const stoppedByInterrupt = (): boolean =>
        callSegment.signal.reason === INTERRUPT_ABORT_REASON &&
        !input.abortSignal?.aborted;

      let stepsStarted = 0;

      // The stop is a delivery with cause `interrupt` (run-steering D4): the
      // reply closes `aborted`, and the Run stays live on the delivered
      // message. An item the owner withdrew in the meantime continues the same
      // reply, from what the stopped call left in the transcript.
      // One fenced delivery of the pending items; a delivery moves the next
      // call onto the delivered message. Other outcomes go back to the caller.
      const deliverAtBoundary = async (
        modelCompleted: {
          usage?: unknown;
          finishReason: unknown;
          telemetry: AssistantTurnTelemetry;
        },
        extra: {
          stoppedCalls?: Array<StoppedCall>;
          baselines?: FirstEpochBaselines;
          finalAnswer?: true;
          /** The cut this boundary delivery closes (D4/D6). */
          superseded?: SupersededModelOutput;
        },
      ): Promise<BoundaryDelivery['kind'] | 'quota'> => {
        const { telemetry } = modelCompleted;

        const boundaryCompaction =
          stopCause === 'delivery' ||
          stopCause === 'compact' ||
          automaticCompactionAtBoundary ||
          extra.stoppedCalls !== undefined
            ? await this.prepareQuotaBoundary({
                resumeAt: 'boundary',
                quotaParts: () => assistantPartCollector.parts(),
                quotaAssistantTurn: () => ({
                  chatId: input.chatId,
                  inReplyTo: input.userMessage.id,
                  parts: assistantPartCollector.parts(),
                  telemetry,
                }),
                ...(extra.stoppedCalls !== undefined && {
                  quotaStoppedCalls: extra.stoppedCalls,
                }),
                quotaRequest,
                run: input,
                attemptId,
                context: attemptContext,
                prepared,
                effort,
                media,
                workspaceRoot,
                replyParts: assistantPartCollector
                  .parts()
                  .slice(continued?.parts.length ?? 0),
                keptPartCount: continued?.parts.length ?? 0,
                stepBudgetUsed: boundaryStepBudgetUsed({
                  stepBudgetOffset,
                  stepBase,
                  stepsStarted,
                  wakeStepOffset,
                }),
                ...((stopCause === 'compact' ||
                  automaticCompactionAtBoundary) && {
                  ...(stopCause !== 'delivery' && {
                    compactionSet: { ids: [], focus: null },
                  }),
                  automatic: true as const,
                }),
                ...extra,
              })
            : undefined;

        if (boundaryCompaction === 'quota') {
          stopCause = 'quota';

          return 'quota';
        }

        if (input.abortSignal?.aborted) return 'cancelled';

        const boundary = await retryAbortedTransaction(() =>
          this.tenantDb.runAs(input.userId, (tx) =>
            deliverPendingSteering(tx, {
              run: { runId: input.runId, userId: input.userId },
              attemptId,
              modelCompleted,
              live: {
                chatId: input.chatId,
                inReplyTo: input.userMessage.id,
                parts: assistantPartCollector.parts(),
                telemetry,
              },
              models: this.instanceConfig.config.models,
              deadWorkerAfterSeconds: workerDeadAfterSeconds(
                this.instanceConfig.config,
              ),
              boundaryCompaction,
              ...extra,
            }),
          ),
        );

        if (
          boundary.kind === 'nothing-pending' &&
          (stopCause === 'compact' || automaticCompactionAtBoundary)
        ) {
          markCompactionDisabled();
        }

        this.applyCompactionFailure({
          failure:
            boundary.kind === 'nothing-pending' &&
            boundary.compactionFailed === true &&
            stopCause !== 'compact' &&
            !automaticCompactionAtBoundary
              ? 'manual'
              : undefined,
          assistantPartCollector,
          disableAutomaticCompaction,
        });

        automaticCompactionAtBoundary = false;

        if (boundary.kind === 'delivered') {
          await this.afterAssistantTurn(
            boundary.closedReply,
            input.userId,
            closedTelemetry(boundary, telemetry),
          );
          nextCall = () => startDelivered(boundary);
        }

        return boundary.kind;
      };

      const continueAfterWait = async (
        finishReason: TurnTelemetry['finishReason'],
        segmentSteps: number,
      ): Promise<boolean> => {
        const boundary = await deliverAtBoundary(
          {
            finishReason,
            telemetry: buildAssistantTelemetry(
              finishReason,
              turnStatusForTerminalRun('completed'),
              segmentSteps,
            ),
          },
          {},
        );

        if (boundary === 'delivered' || boundary === 'quota') return true;

        if (boundary === 'cancelled') return false;

        if (boundary === 'fenced') throw new RunNotRunnableError(input.runId);

        const produced = projectStoredReplyParts(
          assistantPartCollector.parts().slice(partsBefore),
          {
            privateParts: true,
            mediaKey: (index) => continuedMediaKey(partsBefore + index),
          },
        );

        mergeRetainedMedia(media.retainedMedia, produced.retainedMedia);
        inRunItems = createInRunContextItems();
        nextCall = () =>
          callStream([...callMessages, ...produced.messages], segmentSteps);

        return true;
      };

      /**
       * Settles the calls of the failed step that have no result once the SDK
       * loop ends (D2). A `wait` call never opened, so the Run does not enter
       * `awaiting_jobs` for it; any other open call settles on the shipped
       * termination terms. Calls of another step are untouched.
       */
      const settleFailedStepCalls = async (): Promise<void> => {
        const failure = sendFailure;

        if (failure === undefined) return;
        const step = stepOffset + failure.step;
        let settledWait = false;

        for (const [toolCallId, call] of openToolCalls) {
          if (call.origin !== undefined || call.step !== step) continue;

          if (call.toolName === 'wait') settledWait = true;

          recordToolCompleted(
            toolCallId,
            call.toolName,
            call.toolInput,
            call.toolName === 'wait'
              ? FAILED_WAIT_RESULT
              : toolTerminationResult('failed', call.toolName),
          );
        }

        if (settledWait) {
          pendingWait = false;
          waitRequest = undefined;
        }

        await deltaWrites;
      };

      /** The status a failed send's Run ends with: an abort that landed first
       * decides (Stop, expiry, a recorded cancellation), else the failure. */
      const failedSendStatus = (): FailedSendStatus => {
        if (input.abortSignal?.aborted)
          return classifyAbortedRun(input.abortSignal);

        return failedStepBoundary?.cause === 'cancel' ? 'cancelled' : 'failed';
      };

      /**
       * The terminal message a failed send's Run carries: a Stop or expiry
       * names its own cause, as the shipped abort settlement does, and only
       * the Run's own failure names the send.
       */
      const failedSendMessage = (
        status: FailedSendStatus,
        failure: ProviderFailure,
      ): string => {
        if (status === 'expired') return expiredRunMessage(input.abortSignal);

        if (status === 'failed') return errorMessageWithoutParams(failure);

        return input.abortSignal?.aborted
          ? toolTerminationMessage(status)
          : 'Run was cancelled.';
      };

      /** Ends the Run with the provider failure, the cut, and the notice (D6). */
      const settleFailedSend = async (
        cut: FailedSendCut,
        finishReason: TurnTelemetry['finishReason'],
        status: FailedSendStatus = failedSendStatus(),
      ): Promise<void> => {
        const failure = sendFailure?.failure;

        if (failure === undefined) return;

        const assistantTelemetry = buildAssistantTelemetry(
          finishReason,
          turnStatusForTerminalRun(status),
        );

        persistReasoning(reasoningDeltas.flush());
        persistDelta(deltas.flush());
        await deltaWrites;

        if (progressWriteFailed) {
          await this.settleProgressWriteFailure({
            userId: input.userId,
            runId: input.runId,
            attemptId,
            telemetry: assistantTelemetry,
          });

          return;
        }

        if (!(await settleOpenToolsAndDrain(status, assistantTelemetry)))
          return;

        const stored = modelRequestFailure(failure);
        const message = failedSendMessage(status, failure);

        const failureDetails = {
          message,
          ...(status === 'failed' && {
            code: stored.code,
            ...(stored.resetsAt !== undefined && { resetsAt: stored.resetsAt }),
          }),
        };

        const turn: AssistantTurnWrite = {
          chatId: input.chatId,
          inReplyTo: input.userMessage.id,
          parts: assistantPartCollector.parts(),
          telemetry: assistantTelemetry,
        };

        this.logger.error(
          `Stream error for chat ${input.chatId}`,
          loggableError(failure),
        );

        const finish = await this.finishRun({
          userId: input.userId,
          runId: input.runId,
          status,
          attemptId,
          modelCompleted: { finishReason, telemetry: assistantTelemetry },
          runPayload: { status, ...failureDetails },
          error: failureDetails,
          assistantTurn: turn,
          superseded: cut.superseded,
        });

        await this.afterAssistantTurn(
          finish.assistantMessage,
          input.userId,
          turn.telemetry,
        );
      };

      /**
       * Continues after the failed send's calls settled (D4). A delivery at
       * the boundary starts a new segment with no carried count and no retry
       * delay; otherwise the next step's first send stores the cut and waits
       * the retry delay of the carried count.
       */
      const continueFailedSend = async (
        cut: FailedSendCut,
        cause: FailedStepCause,
        finishReason: TurnTelemetry['finishReason'],
        stepCount: number,
      ): Promise<void> => {
        const failure = sendFailure;

        if (failure === undefined) return;
        const segmentSteps = stepBase + stepCount;

        if (cause === 'delivery' || automaticCompactionAtBoundary) {
          stopCause = cause;

          const boundaryKind = await deliverAtBoundary(
            {
              finishReason,
              telemetry: buildAssistantTelemetry(
                finishReason,
                turnStatusForTerminalRun('completed'),
                segmentSteps,
              ),
            },
            { superseded: cut.superseded },
          );

          if (boundaryKind === 'delivered') {
            // The closed reply holds the cut and the notice; the delivered
            // message starts its own reply and usage accounting.
            discardedSend = false;

            return;
          }

          if (boundaryKind === 'fenced')
            throw new RunNotRunnableError(input.runId);

          if (boundaryKind === 'cancelled') {
            // The delivery found a recorded cancellation: the Run still ends
            // with the cut and the notice in its own terminal write.
            await settleFailedSend(
              cut,
              finishReason,
              input.abortSignal?.aborted
                ? classifyAbortedRun(input.abortSignal)
                : 'cancelled',
            );

            return;
          }

          // A quota park committed its own suspension and this attempt is done.
          if (boundaryKind !== 'nothing-pending') return;
        }

        // The notice is part of the reply like any stored context item, so the
        // request projects it directly after its last tool result (D4).
        const produced = projectStoredReplyParts(
          assistantPartCollector.parts().slice(partsBefore),
          {
            privateParts: true,
            mediaKey: (index) => continuedMediaKey(partsBefore + index),
          },
        );

        mergeRetainedMedia(media.retainedMedia, produced.retainedMedia);
        inRunItems = createInRunContextItems();
        nextCall = () =>
          callStream(
            [...callMessages, ...produced.messages],
            failure.step + 1,
            failure.failure.sends,
            false,
            { failure: failure.failure, cut },
          );
      };

      /** The one decision of a failed send, after its calls settled (D2/D4). */
      const decideFailedSend = async (
        finishReason: TurnTelemetry['finishReason'],
        stepCount: number,
      ): Promise<void> => {
        const failure = sendFailure;

        if (failure === undefined) return;
        const cause = await resolveFailedStepBoundary();

        // A suspension belongs to its waker: this attempt writes nothing, as
        // the shipped step-end path decides.
        if (cause === 'suspend') return;

        await settleFailedStepCalls();
        const cut = await applyFailedSendCut();

        if (cut === undefined || progressWriteFailed) {
          await this.settleProgressWriteFailure({
            userId: input.userId,
            runId: input.runId,
            attemptId,
            telemetry: buildAssistantTelemetry(null, 'error'),
          });

          return;
        }

        // Stop, expiry, cancellation, and a class with no retry left beat the
        // continue decision (R9).
        if (
          cause === 'cancel' ||
          input.abortSignal?.aborted ||
          !continuesFailedSend(failure.failure)
        ) {
          await settleFailedSend(cut, finishReason);

          return;
        }

        await continueFailedSend(cut, cause, finishReason, stepCount);
      };

      const deliverInterrupt = async (): Promise<void> => {
        persistReasoning(reasoningDeltas.flush());
        persistDelta(deltas.flush());
        await deltaWrites;
        await Promise.all(lateMcpWrites);
        const segmentSteps = stepBase + Math.max(stepsStarted, 1);

        if (progressWriteFailed) {
          await this.settleProgressWriteFailure({
            userId: input.userId,
            runId: input.runId,
            attemptId,
            telemetry: buildAssistantTelemetry(null, 'error', segmentSteps),
          });

          return;
        }

        // An interrupt ends the wait for a failed send's calls: the reply this
        // delivery closes keeps the cut and the notice, and names the cut (D6).
        const cut = await applyFailedSendCut();

        assistantPartCollector.markInterrupted();

        const closing = abortedByInterrupt(
          buildAssistantTelemetry(null, 'aborted', segmentSteps),
        );

        const boundaryKind = await deliverAtBoundary(
          { finishReason: null, telemetry: closing },
          {
            stoppedCalls: [...stoppedCalls],
            superseded: cut?.superseded,
          },
        );

        if (boundaryKind === 'nothing-pending') {
          nextCall = () => {
            // The settled calls carry their results, and the projection leaves
            // out the reasoning part the stop cut. The delivery wrote nothing,
            // so the cut this call ended still owes its event to the next
            // request's first step (D4/D6).
            const produced = projectStoredReplyParts(
              assistantPartCollector.parts().slice(partsBefore),
              {
                privateParts: true,
                mediaKey: (partIndex) =>
                  continuedMediaKey(partsBefore + partIndex),
              },
            );

            mergeRetainedMedia(media.retainedMedia, produced.retainedMedia);
            inRunItems = createInRunContextItems();

            return callStream(
              [...callMessages, ...produced.messages],
              segmentSteps,
              0,
              false,
              cut === undefined ? undefined : { cut },
            );
          };
        } else if (boundaryKind === 'cancelled') {
          // The items stay pending; preserve explicit cancellation, and classify aborts.
          const status = input.abortSignal?.aborted
            ? classifyAbortedRun(input.abortSignal)
            : 'cancelled';

          const message = input.abortSignal?.aborted
            ? this.abortedRunMessage(status, input.abortSignal)
            : 'Run was cancelled.';

          const telemetry = buildAssistantTelemetry(
            null,
            'aborted',
            segmentSteps,
          );

          await this.settleTerminalRun({
            userId: input.userId,
            runId: input.runId,
            status,
            attemptId,
            telemetry,
            assistantTurn: {
              chatId: input.chatId,
              inReplyTo: input.userMessage.id,
              parts: assistantPartCollector.parts(),
              telemetry,
            },
            runPayload: { status, message },
            error: { message },
            superseded: cut?.superseded,
          });
        }
      };

      const settlePendingAbort = async (
        cancelRequested: boolean,
      ): Promise<boolean> => {
        if (!cancelRequested && stoppedByInterrupt()) {
          // The delivery is recorded once: it reports whether it ran, so a
          // Stop that lands while it is in flight cannot make the caller
          // settle the same step a second time.
          const delivered = await (interruptOutcome ??= (async () => {
            await settleOnInterrupt();

            if (input.abortSignal?.aborted) return false;
            await deliverInterrupt();

            return true;
          })());

          if (delivered) return true;
        }

        if (parentAbortSettlement) {
          await parentAbortSettlement;

          return true;
        }

        return false;
      };

      const settleAbortedSend = async (
        cancelRequested: boolean,
      ): Promise<void> => {
        if (await settlePendingAbort(cancelRequested)) return;

        if (cancelRequested || input.abortSignal?.aborted) {
          const status = classifyAbortedRun(input.abortSignal);

          const message = this.abortedRunMessage(status, input.abortSignal);

          const telemetry = buildAssistantTelemetry(null, 'aborted');
          await this.settleTerminalRun({
            userId: input.userId,
            runId: input.runId,
            status,
            attemptId,
            telemetry,
            assistantTurn: {
              chatId: input.chatId,
              inReplyTo: input.userMessage.id,
              parts: assistantPartCollector.parts(),
              telemetry,
            },
            runPayload: { status, message },
            error: { message },
          });
        }
      };

      const recoverSupersededSend = async (
        failure: ProviderFailure,
        superseded: ProviderFailureSuperseded,
      ): Promise<void> => {
        try {
          stopCause = 'superseded';
          persistReasoning(reasoningDeltas.flush());
          persistDelta(deltas.flush());
          await deltaWrites;

          if (progressWriteFailed) {
            await this.settleProgressWriteFailure({
              userId: input.userId,
              runId: input.runId,
              attemptId,
              telemetry: buildAssistantTelemetry(null, 'error'),
            });

            return;
          }

          discardedSend = true;

          const retainedParts = assistantPartCollector
            .parts()
            .slice(0, stepModelOutputStart);

          assistantPartCollector = createAssistantPartCollector();
          assistantPartCollector.seed(retainedParts);
          streamedText = stepStreamedText;
          firstOutputDeltaMs = stepFirstOutputDeltaMs;
          outputDeltaCount = stepOutputDeltaCount;
          reasoningPartId = undefined;
          textPartId = undefined;
          wireTextPartId = undefined;
          textPartEnded = false;
          inRunItems = createInRunContextItems();

          persistFencedModelEvent('model.superseded', {
            fromSequence: stepStartSequence,
            step: currentStepNumber,
          });
          persistFencedModelEvent('model.retrying', {
            code: failure.code,
            retry: superseded.retry,
            delayMs: superseded.delayMs,
          });
          await deltaWrites;

          if (progressWriteFailed) {
            await this.settleProgressWriteFailure({
              userId: input.userId,
              runId: input.runId,
              attemptId,
              telemetry: buildAssistantTelemetry(null, 'error'),
            });

            return;
          }

          await delay(superseded.delayMs, undefined, {
            signal: callSignal,
          }).catch(noop);

          const current = await this.tenantDb.runAs(input.userId, (tx) =>
            new RunRowFenceRepository(tx).lockForDelivery(
              input.runId,
              input.userId,
              attemptId,
            ),
          );

          if (current === undefined) return;

          const cancelRequested = current.cancelRequestedAt !== null;

          if (callSignal?.aborted || cancelRequested) {
            await settleAbortedSend(cancelRequested);

            return;
          }

          nextCall = async () => {
            const produced = projectStoredReplyParts(
              assistantPartCollector.parts().slice(partsBefore),
              {
                privateParts: true,
                mediaKey: (index) => continuedMediaKey(partsBefore + index),
              },
            );

            mergeRetainedMedia(media.retainedMedia, produced.retainedMedia);

            return callStream(
              [...callMessages, ...produced.messages],
              currentStepNumber,
              superseded.retry,
              true,
            );
          };

          return;
        } finally {
          endWorkspaceAttempt();
          removeParentAbortListener();
          closeSegment();
        }
      };

      const suspendQuotaSend = async (
        awaiting: AwaitingQuota,
      ): Promise<void> => {
        stopCause = 'quota';
        persistReasoning(reasoningDeltas.flush());
        persistDelta(deltas.flush());
        await deltaWrites;

        if (progressWriteFailed) {
          await this.settleProgressWriteFailure({
            userId: input.userId,
            runId: input.runId,
            attemptId,
            telemetry: buildAssistantTelemetry(null, 'error'),
          });

          return;
        }

        const parts = assistantPartCollector.parts();
        const retainedParts = parts.slice(0, stepModelOutputStart);

        if (parts.length > retainedParts.length) {
          discardedSend = true;
          persistFencedModelEvent('model.superseded', {
            fromSequence: stepStartSequence,
            step: currentStepNumber,
          });
          await deltaWrites;

          if (progressWriteFailed)
            throw new Error('The quota supersession could not be recorded.');
        }

        assistantPartCollector = createAssistantPartCollector();
        assistantPartCollector.seed(retainedParts);
        streamedText = stepStreamedText;
        firstOutputDeltaMs = stepFirstOutputDeltaMs;
        outputDeltaCount = stepOutputDeltaCount;

        const suspended = await this.waitService().suspendForQuota({
          runId: input.runId,
          chatId: input.chatId,
          userId: input.userId,
          attemptId,
          awaiting,
          parts: retainedParts,
          steps: {},
          // The steps this Run completed before the failed send. The step that
          // failed never counted against the cap, and a Continue Run's kept
          // steps are only display numbering.
          stepBudgetUsed:
            stepBudgetOffset +
            wakeStepOffset +
            stepBase +
            Math.max(stepsStarted - 1, 0),
        });

        if (suspended.kind === 'ready') {
          const telemetry = buildAssistantTelemetry(null, 'aborted');
          await this.settleTerminalRun({
            userId: input.userId,
            runId: input.runId,
            attemptId,
            status: 'cancelled',
            telemetry,
            assistantTurn: {
              chatId: input.chatId,
              inReplyTo: input.userMessage.id,
              parts: retainedParts,
              telemetry,
            },
            runPayload: { status: 'cancelled' },
          });
        }
      };

      stopCause = undefined;

      try {
        // A steer that was admitted before this call began has no segment to
        // signal, so the call reads the pending item itself (level trigger).
        if (this.segmentAborts !== undefined && quotaRequest === undefined) {
          const pending = await this.tenantDb.runAs(input.userId, (tx) =>
            new ChatDeliveriesRepository(tx).hasPendingSteering(
              input.chatId,
              input.userId,
            ),
          );

          if (pending) callControl.yield.abort();
        }

        if (!hasTools) {
          persistReasoning(reasoningDeltas.flush());
          persistDelta(deltas.flush());
          currentStepNumber = stepBase;
          stepStartSequence = await persistStepStartSequence();
          stepResultStart = partsBefore;
          stepModelOutputStart = partsBefore;
          stepStreamedText = streamedText;
          stepFirstOutputDeltaMs = firstOutputDeltaMs;
          stepOutputDeltaCount = outputDeltaCount;
        }

        const result = client.streamText({
          onRetry: async (retry) => {
            persistReasoning(reasoningDeltas.flush());
            discardedSend = true;
            persistDelta(deltas.flush());
            persistFencedModelEvent('model.retrying', retry);
            await deltaWrites;

            if (progressWriteFailed) {
              throw new Error(
                'Failed to persist the model retry before its delay.',
              );
            }
          },
          onRequestUsage: (usage, requestGenerationMs) => {
            const firstReceipt = requestUsageReceipts.length === 0;
            requestUsageReceipts.push(usage);

            if (
              firstReceipt &&
              compactionStartedThisAttempt &&
              (usage.inputTokens ??
                estimateModelRequestTokens({
                  system,
                  messages: boundaryCallMessages,
                  toolDeclarations: prepared.toolDeclarations,
                  ...(progressCheckMedia !== undefined && {
                    media: progressCheckMedia,
                  }),
                })) >= compactionThreshold
            ) {
              disableAutomaticCompaction();
            }

            generationMs += requestGenerationMs;
          },
          system,
          messages: callMessages,
          requestRetriesUsed,
          // The failed send's class: the first send waits its retry delay with
          // the carried count, and fails at the cap (D4). A call that continues
          // a withdrawn interrupt carries only the cut it owes.
          ...(pendingFailedSend?.failure !== undefined && {
            pendingFailure: pendingFailedSend.failure,
          }),
          // The Run learns of a started-call failure while its calls run (D1).
          onSendFailed: noteSendFailure,
          chat: { id: input.chatId, lane: 'main' },
          abortSignal: callSignal,
          media,
          reservedOutputTokens: this.instanceConfig.config.runs.maxOutputTokens,
          // Absent → no provider option at all, leaving the provider default.
          ...(effort !== undefined && { effort }),
          // Tool loop: pass the pre-filtered set + the operator step cap.
          // Absent when no tool is available → the answer-only single-
          // generation path (today's pre-tool-loop behavior).
          ...(hasTools && {
            tools: toolSet,
            onToolSet: (record) => toolAdditions.bindToolRecord(record),
            // A continuation inside a segment gets what the earlier calls left.
            maxSteps:
              maxStepsPerRun === null
                ? null
                : Math.max(
                    0,
                    maxStepsPerRun -
                      stepBase -
                      stepBudgetOffset -
                      wakeStepOffset,
                  ),
            stopWhenExtra,
            onStepStart: async ({ messages, stepNumber }) => {
              persistReasoning(reasoningDeltas.flush());
              persistDelta(deltas.flush());
              currentStepNumber = stepBase + stepNumber;
              // A new step's first tool-call part starts its own cut anchor.
              cutAnchor = undefined;
              stepStartSequence = await persistStepStartSequence();
              stepResultStart = assistantPartCollector.parts().length;
              stepStreamedText = streamedText;
              stepFirstOutputDeltaMs = firstOutputDeltaMs;
              stepOutputDeltaCount = outputDeltaCount;
              stepToolsCompleted = 0;
              waitCallIdInStep = undefined;
              deferredWaitStep = false;
              stepsStarted += 1;
              workspaceRoot.beginStep();
              inRunItems.beginStep(messages);

              // The failed send's cut is stored in ONE fenced write before
              // this step's first send, even when that send waits a retry
              // delay (D4). The notice itself is already collected directly
              // after the last kept tool part and travels in `messages`, so
              // nothing is staged or collected twice.
              if (skipInitialContextPreparation && stepNumber === 0) {
                skipInitialContextPreparation = false;
                boundaryCallMessages = messages;
                stepModelOutputStart = assistantPartCollector.parts().length;

                return messages;
              }

              const cut = pendingCut;
              pendingCut = undefined;

              const staged: Array<AuthoredContextItemPart> = [];
              await inRunProducer?.prepareStep({
                messages,
                stepNumber,
                stage: (part) => {
                  staged.push(part);
                },
              });

              if (staged.length > 0 || cut !== undefined) {
                await this.storeInRunSnapshot(
                  input,
                  attemptId,
                  [...assistantPartCollector.parts(), ...staged],
                  cut?.superseded,
                );
              }

              for (const part of staged) {
                inRunItems.stage(part);
                assistantPartCollector.contextItem(part);
              }

              // This boundary includes context committed for the step above,
              // but no provider output from its request.
              stepModelOutputStart = assistantPartCollector.parts().length;

              const preparedMessages = inRunItems.applyToStep(messages);
              boundaryCallMessages = withoutToolIntents(
                preparedMessages ?? messages,
              );

              if (
                compactionStartedThisAttempt &&
                progressCheckMedia === undefined
              ) {
                progressCheckMedia = await loadMediaSizing(
                  boundaryCallMessages,
                  media,
                  this.mediaAdmissionContext(client),
                );
              }

              return boundaryCallMessages === messages
                ? preparedMessages
                : boundaryCallMessages;
            },
            // Fires once, the moment the model client disables tools for
            // the next step because maxStepsPerRun tool-requesting steps
            // already ran (D6) — record it as a distinct run event; the
            // cap-marker PART is persisted in onFinish once the run
            // actually completes (a run that errors mid-loop after
            // capping does not claim to have "completed with the cap").
            onCapReached: () => {
              if (cappedAt !== null) return;
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
              sdkRefusal,
            }) => {
              // A refused call is a complete tool-call part of this send too,
              // so it ends the kept output the same way (D3).
              persistCutAnchor();

              const { input: args, intent } = splitToolIntent(
                toolName,
                callInput,
              );

              const result =
                reason === 'not_available'
                  ? refusalResult(toolName)
                  : invalidCallResult(toolName);

              // No 'tool.started': the call never genuinely ran (a refusal
              // is distinguished downstream by requested+completed with no
              // started in between). No permission decision: an unavailable or
              // invalid call is not a permission rejection.
              reserveToolRequest(toolCallId, toolName, args, {
                sdkRefusal: {
                  ...sdkRefusal,
                  input: splitToolIntent(toolName, sdkRefusal.input).input,
                },
                intent,
              });
              emitToolRequested(toolCallId, toolName, args, undefined);
              recordToolCompleted(toolCallId, toolName, args, result);
            },
          }),
          // The call's opaque metadata, held before the call can execute or be
          // refused, and copied to its `tool.requested` event and stored part
          // (design A7).
          onToolCallMetadata: (toolCallId, providerMetadata) => {
            pendingToolMetadata.set(toolCallId, providerMetadata);
          },
          onToolCall: (call) => {
            // Every complete tool-call part ends the output a failed send
            // keeps, before the call's own part exists (D3).
            persistCutAnchor();

            if (
              call.toolName !== 'wait' ||
              deferredWaitDeclaration === undefined
            )
              return;

            deferredWaitStep = true;
            deferredWaitCalls.push(
              executeDeclaredTool(
                deferredWaitDeclaration,
                call.input,
                call.toolCallId,
              ).then(
                (): PromiseFulfilledResult<void> => ({
                  status: 'fulfilled',
                  value: undefined,
                }),
                (error: unknown): PromiseRejectedResult => ({
                  status: 'rejected',
                  reason: error,
                }),
              ),
            );
          },
          onTextDelta: (text, partId, providerMetadata) => {
            // A metadata-only delivery: a text part's start or end carries the
            // adapter's opaque metadata but no text of its own (design A7).
            // Drain both buffers first so the durable log keeps every earlier
            // part — another step's text included — before this one, then record
            // the metadata under the id it names. An empty text delivery never
            // starts a stored part.
            if (text.length === 0) {
              if (providerMetadata === undefined) return;
              persistReasoning(reasoningDeltas.flush());
              persistDelta(deltas.flush());

              // Only a delivery that binds to a stored part is durable: an id
              // that has produced no text yet holds its metadata in the
              // collector, and a part that never produces text keeps none (A7).
              const bound = assistantPartCollector.text(
                '',
                partId,
                providerMetadata,
                stepOffset + currentStepNumber,
              );

              if (bound !== undefined) persistTextMetadata(partId, bound);

              return;
            }

            noteOutputDelta(text);
            streamedText += text;

            const bound = assistantPartCollector.text(
              text,
              partId,
              providerMetadata,
              stepOffset + currentStepNumber,
            );

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

            // Drain before adopting a new id so a buffered event never spans
            // two adapter parts (the collector splits on the same transition).
            // A call ended the open part, so the wire's own unchanged id names
            // a new part and the events carry one of their own (D3).
            if (partId !== wireTextPartId || textPartEnded) {
              persistDelta(deltas.flush());
              const changed = partId !== wireTextPartId;
              wireTextPartId = partId;
              textPartEnded = false;
              textPartId =
                changed || partId === undefined
                  ? partId
                  : `${partId}#${(textPartEpoch += 1)}`;
            }

            persistDelta(deltas.push(text, Date.now()));

            // A start's held metadata binds with this text, and its part must
            // be durable first.
            if (bound !== undefined) {
              persistDelta(deltas.flush());
              persistTextMetadata(partId, bound);
            }
          },
          onReasoningDelta: (text, partId, providerMetadata) => {
            // Reasoning text is streamed output too: it stamps the first delta and
            // counts, exactly as answer text does (#155). The metadata-only
            // deliveries below carry no text and do not.
            noteOutputDelta(text);

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
              assistantPartCollector.reasoning(
                '',
                partId,
                providerMetadata,
                stepOffset + currentStepNumber,
              );

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
            assistantPartCollector.reasoning(
              text,
              partId,
              undefined,
              stepOffset + currentStepNumber,
            );
            persistDelta(deltas.flush());
            // Reasoning intervened: the next text delta opens a new part, so
            // the id it carries is not the one the drained buffer belonged to.
            textPartId = undefined;
            wireTextPartId = undefined;
            persistReasoning(reasoningDeltas.push(text, Date.now()));
          },
          onError: async ({ error }) => {
            // The send failure itself is not an outcome: the Run has already
            // recorded it, its calls still settle, and `onFinish` decides
            // (D2). Any other error — an abort reason, a later failure — takes
            // the shipped path below.
            if (sendFailure !== undefined && error === sendFailure.failure)
              return;

            const restarting =
              error instanceof ProviderFailure &&
              error.superseded !== undefined &&
              !callSignal?.aborted &&
              !input.abortSignal?.aborted;

            if (!restarting) {
              endWorkspaceAttempt();
              removeParentAbortListener();
              closeSegment();
            }

            if (await settlePendingAbort(false)) return;

            if (error instanceof ProviderFailure && !callSignal?.aborted) {
              const awaiting = quotaWaitForFailure(
                error,
                this.instanceConfig.config.runs.quotaWaitMaxSeconds,
                quotaRequest,
              );

              if (awaiting !== undefined) {
                await suspendQuotaSend(awaiting);

                return;
              }
            }

            if (restarting) {
              await recoverSupersededSend(error, error.superseded);

              return;
            }

            // On the request thread the stream has already sent HTTP headers, so
            // this error can't reach an exception filter — log + record it.
            this.logger.error(
              `Stream error for chat ${input.chatId}`,
              loggableError(error),
            );

            const status = input.abortSignal?.aborted
              ? classifyAbortedRun(input.abortSignal)
              : 'failed';

            // A cancelled or superseded Run is not a fault.
            if (status === 'failed') {
              Sentry.captureException(error, {
                tags: {
                  'llame.run_id': input.runId,
                  'llame.chat_id': input.chatId,
                },
              });
            }

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

            await settleErrorOutcome(
              error,
              status,
              assistantTelemetry,
              progressFailureTelemetry,
            );
          },
          onFinish: async ({ text, usage, finishReason, stepCount }) => {
            const deferred = await Promise.all(deferredWaitCalls);
            deferredWaitCalls.length = 0;

            const failed = deferred.find(
              (result) => result.status === 'rejected',
            );

            endWorkspaceAttempt();
            removeParentAbortListener();
            closeSegment();

            if (stopCause === 'superseded' || stopCause === 'quota') return;

            if (failed?.status === 'rejected') throw failed.reason;

            if (parentAbortSettlement) {
              await parentAbortSettlement;

              return;
            }

            // An owner interrupt already cut and delivered this step: the
            // aborted step's `onFinish` must not decide the Run again (D2/D6).
            if (interruptOutcome !== undefined) {
              await interruptOutcome;

              return;
            }

            // A send that broke after a started call: settle its wait, cut its
            // output, and continue or fail — before any terminal status (D2).
            if (sendFailure !== undefined) {
              await decideFailedSend(finishReason, stepCount);

              return;
            }

            // The segment's steps so far: a withdrawal continues the segment in
            // another call, whose own count restarts at zero.
            const segmentSteps = stepBase + stepCount;

            // `streamedText === ''` makes the `startsWith` check vacuously true
            // (every string starts with the empty string), so that case is
            // already covered by this branch — there is no second case to guard.
            if (text.startsWith(streamedText)) {
              assistantPartCollector.text(
                text.slice(streamedText.length),
                undefined,
                undefined,
                stepOffset + currentStepNumber,
              );
            }

            // A `tool-calls` finish that only our step-end check caused ends the
            // call at a step boundary, not the Run (run-steering D3).
            const stopped =
              finishReason === 'tool-calls' ? stopCause : undefined;

            let status = terminalStatus(
              input.abortSignal,
              finishReason,
              stopped,
            );

            // Drain buffered reasoning + deltas BEFORE the terminal events so the
            // log reads in stream order: …model.delta, model.completed, run.completed.
            persistReasoning(reasoningDeltas.flush());
            persistDelta(deltas.flush());
            await deltaWrites;
            await Promise.all(lateMcpWrites);

            if (
              await this.tenantDb.runAs(input.userId, (tx) =>
                suspendedByThisAttempt(tx),
              )
            ) {
              stopCause = 'suspend';
            }

            // The wait service has already committed the attempt-fenced
            // suspension and its deadline job. Drain this stream without
            // writing a terminal result for an attempt that may already have
            // been woken and reclaimed by another worker.
            if (stopCause === 'suspend') return;

            if (progressWriteFailed) {
              await this.settleProgressWriteFailure({
                userId: input.userId,
                runId: input.runId,
                attemptId,
                telemetry: buildAssistantTelemetry(
                  finishReason,
                  'error',
                  segmentSteps,
                ),
              });

              return;
            }

            if (deferredWaitStep && status === 'completed') {
              await recordQuotaRecovery(status);

              const suspension = await suspendPendingWait(
                buildAssistantTelemetry(
                  finishReason,
                  turnStatusForTerminalRun('completed'),
                  segmentSteps,
                ),
              );

              if (suspension === 'suspended') {
                stopCause = 'suspend';

                return;
              }

              pendingWait = false;
              waitRequest = undefined;

              if (
                suspension !== 'cancelled' &&
                (await continueAfterWait(finishReason, segmentSteps))
              )
                return;

              status = 'cancelled';
            }

            // Persist the collected thinking as reasoning parts in occurrence
            // order: displayed on reload, and replayed to the reply's own model
            // under the model rule (D7) — a summarization request included
            // (D9) — while `partsToText` keeps it out of text-only surfaces.
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

            const settleRun = async (
              requestedStatus: TerminalRunStatus,
            ): Promise<void> => {
              await recordQuotaRecovery(requestedStatus);

              const initialStatus = input.abortSignal?.aborted
                ? classifyAbortedRun(input.abortSignal)
                : requestedStatus;

              const terminalBoundary = await this.prepareTerminalQuotaBoundary({
                status: initialStatus,
                wakeCompaction,
                quotaParts: () => assistantPartCollector.parts(),
                quotaAssistantTurn: () => ({
                  chatId: input.chatId,
                  inReplyTo: input.userMessage.id,
                  parts: assistantPartCollector.parts(),
                  telemetry: buildAssistantTelemetry(
                    finishReason,
                    'aborted',
                    segmentSteps,
                  ),
                }),
                quotaRequest,
                run: input,
                attemptId,
                context: attemptContext,
                prepared,
                effort,
                media,
                workspaceRoot,
                replyParts: assistantPartCollector
                  .parts()
                  .slice(continued?.parts.length ?? 0),
                keptPartCount: continued?.parts.length ?? 0,
                stepBudgetUsed: boundaryStepBudgetUsed({
                  stepBudgetOffset,
                  stepBase,
                  stepsStarted,
                  wakeStepOffset,
                }),
              });

              if (terminalBoundary === 'quota') {
                stopCause = 'quota';

                return;
              }

              const settling = terminalBoundary.status;
              const boundaryCompaction = terminalBoundary.boundaryCompaction;

              const assistantTelemetry = buildAssistantTelemetry(
                finishReason,
                turnStatusForTerminalRun(settling),
                segmentSteps,
              );

              const progressFailureTelemetry =
                settling === 'failed'
                  ? assistantTelemetry
                  : buildAssistantTelemetry(
                      finishReason,
                      'error',
                      segmentSteps,
                    );

              // Normally a no-op — a completed run settled every call through the
              // toolSet wrapper. It fires for the narrow finish-races-abort case,
              // where a call can still be open when this path wins.
              if (
                settling !== 'completed' &&
                !(await settleOpenToolsAndDrain(
                  settling,
                  progressFailureTelemetry,
                ))
              ) {
                return;
              }

              const turn: AssistantTurnWrite = {
                chatId: input.chatId,
                inReplyTo: input.userMessage.id,
                parts: assistantPartCollector.parts(),
                telemetry: assistantTelemetry,
              };

              // A cancellation that only the step-end check found: no abort
              // reached this worker, so the settlement names its own cause.
              const recorded =
                settling === 'cancelled' && !input.abortSignal?.aborted
                  ? { message: 'Run was cancelled.' }
                  : undefined;

              const finish = await this.finishRun({
                userId: input.userId,
                runId: input.runId,
                status: settling,
                stepBudgetUsed: boundaryStepBudgetUsed({
                  stepBudgetOffset,
                  stepBase,
                  stepsStarted,
                  wakeStepOffset,
                }),
                ...(boundaryCompaction !== undefined && { boundaryCompaction }),
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
                ...(recorded !== undefined && {
                  runPayload: { status: settling, ...recorded },
                  error: recorded,
                }),
                ...(settling === 'completed' && {
                  ...(attemptContext.recencyDigestInitialization !==
                    undefined && {
                    recencyDigestInitialization:
                      attemptContext.recencyDigestInitialization,
                  }),
                  ...(attemptContext.skillCatalogFreeze !== undefined && {
                    skillCatalogFreeze: attemptContext.skillCatalogFreeze,
                  }),
                }),
              });

              await this.afterAssistantTurn(
                finish.assistantMessage,
                input.userId,
                finish.outcome === 'delivered'
                  ? closedTelemetry(finish.delivery, turn.telemetry)
                  : turn.telemetry,
              );

              // The final answer met a pending item: the Run stays live on the
              // delivered message (run-steering D5).
              if (finish.outcome === 'delivered') {
                const { delivery } = finish;
                nextCall = () => startDelivered(delivery);

                return;
              }

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
              if (hasNoCommittedAssistantTurn(finish)) {
                return;
              }

              if (assistantTelemetry.status === 'completed') {
                await this.postCompletedRunWork({
                  chatId: input.chatId,
                  userId: input.userId,
                  untitled,
                  // The message `run.created` names, not the delivered one.
                  userMessage: createdMessage,
                });
              }
            };

            if (
              (stopped !== 'delivery' && stopped !== 'compact') ||
              status !== 'completed'
            ) {
              await settleRun(status);

              return;
            }

            // The step-end check saw a pending item: deliver it, or continue.
            const closingTelemetry = buildAssistantTelemetry(
              finishReason,
              'completed',
              segmentSteps,
            );

            const boundaryKind = await deliverAtBoundary(
              { usage, finishReason, telemetry: closingTelemetry },
              {
                baselines: attemptContext,
              },
            );

            if (boundaryKind === 'nothing-pending') {
              // Another call over the same reply: the request carries what the
              // segment produced so far, and the step count restarts at zero.
              nextCall = async () => {
                const produced = (await result.response).messages;
                const carried = [...callMessages, ...produced];
                // The staged in-Run items are part of the carried request now;
                // the next call stages its own against the new Run boundary.
                const next = inRunItems.applyToStep(carried) ?? carried;
                inRunItems = createInRunContextItems();

                return callStream(next, segmentSteps);
              };
            } else if (boundaryKind === 'cancelled') {
              // The items stay pending and the Run settles cancelled.
              await settleRun('cancelled');
            }
          },
        });

        return { result, nextCall: () => nextCall() };
      } catch (error) {
        endWorkspaceAttempt();
        removeParentAbortListener();
        closeSegment();

        // A synchronous throw from streamText (provider/config validation before
        // any callback can fire) would otherwise strand the claimed run at
        // 'running_model' until the deadman sweep expires it — fail it now.
        await this.settleIfAborted(input, attemptId);

        if (progressWriteFailed) {
          await this.settleProgressWriteFailure({
            userId: input.userId,
            runId: input.runId,
            attemptId,
            telemetry: buildAssistantTelemetry(null, 'error'),
          });
          throw error;
        }

        const message = errorMessageWithoutParams(error);
        const failure = modelRequestFailure(error);
        // This attempt holds the claim; a reclaim during the synchronous throw
        // must reject this write rather than let the superseded attempt publish.
        await this.finishRunWithoutCollector({
          userId: input.userId,
          runId: input.runId,
          status: 'failed',
          attemptId,
          runPayload: {
            status: 'failed',
            message,
            code: failure.code,
            ...(failure.resetsAt !== undefined && {
              resetsAt: failure.resetsAt,
            }),
          },
          error: {
            message,
            code: failure.code,
            ...(failure.resetsAt !== undefined && {
              resetsAt: failure.resetsAt,
            }),
          },
        });
        throw error;
      }
    };

    return callStream(messages, 0, 0, attempt.quotaWake);
  }

  /**
   * Loads the active checkpoint and the message history after its boundary, up
   * to the run's triggering message, then rebuilds the context with
   * `systemPrompt` — the shared core of the initial per-run context build and
   * the post-publication rebuild.
   *
   * The read is the chat's whole live window, so it also yields the rows the
   * compaction trigger plans on and the instruction files the history already
   * discloses (D7); no caller reads the history twice.
   */
  private async rebuildContextForChat(
    tx: Db,
    input: ExecuteRunInput,
    systemPrompt: string,
    continued: ContinueState | undefined,
  ): Promise<{
    readonly context: ModelRequestContext;
    readonly historyRows: Array<Message>;
    readonly seenInstructionPaths: ReadonlySet<string>;
    readonly toldGit: GitToldState;
  }> {
    const messagesRepo = new MessagesRepository(tx);

    const checkpoint = await messagesRepo.findActiveCheckpoint(
      input.chatId,
      input.userId,
      { beforeSeq: input.userMessage.seq },
    );

    const history = await messagesRepo.findByChatId(
      input.chatId,
      input.userId,
      {
        maxSeq: input.userMessage.seq,
        sinceSeq: checkpoint?.absorbedThroughSeq,
      },
    );

    return {
      context: buildContext(toStoredMessages(history), {
        systemPrompt,
        // The model this Run executes on decides which earlier reasoning and
        // provider metadata replay (D7).
        modelId: input.client.model,
        ...(checkpoint !== undefined && {
          checkpoint: toContextCheckpoint(checkpoint),
        }),
      }),
      historyRows: history,
      // The kept parts sit above the trigger in the reply, which this read
      // never returns, so their instruction bundles would look unseen and the
      // Continue Run would load and send them a second time (turn-actions D8).
      seenInstructionPaths: new Set([
        ...instructionsSeenPaths(history.flatMap((message) => message.parts)),
        ...(continued === undefined
          ? []
          : instructionsSeenPaths(continued.parts)),
      ]),
      // The same epoch, in order, with the kept parts of a Continue after it.
      toldGit: gitToldState([
        ...history.flatMap((message) => message.parts),
        ...(continued?.parts ?? []),
      ]),
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

  /**
   * Prepare this Chat's Workspace MCP clients for the attempt. A `read-only`
   * attempt starts none — it still discards stale generations and lists the
   * binding's configuration once into the attempt's memory — while every other
   * mode keeps the ordinary start.
   */
  private async startWorkspaceMcp(
    chatId: string,
    key: WorkspaceMcpKey | undefined,
    mode: PermissionMode,
    listing: WorkspaceMcpListingCell,
  ): Promise<WorkspaceMcpKey | undefined> {
    const clients = this.workspaceMcp;

    // Without clients no key reaches anything downstream: the resolver, the
    // attempt hold, and the catalog all require `this.workspaceMcp`.
    if (clients === undefined) return undefined;

    if (key === undefined) {
      await clients.stopForChat(chatId);

      return undefined;
    }

    if (mode === 'read-only') {
      await Promise.all([
        clients.stopStale(key),
        clients.listUnstartedOnce(listing, key),
      ]);

      return undefined;
    }

    await clients.startForChat(key);

    return key;
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

  /**
   * The Chat's bound Workspace identity, absent unless the preparation carries
   * a root, the Chat row, and its binding generation.
   */
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
    attemptId: string,
    chat: Chat | undefined,
    effectivePermissionMode: PermissionMode,
  ): Promise<WorkspacePreparation> {
    const root = chat?.workspaceRoot;
    const executorId = chat?.workspaceExecutorId;
    const generation = chat?.workspaceGeneration;

    if (root === undefined || root === null || executorId === undefined) {
      return { root: undefined, chat, detaching: false };
    }

    if (executorId === null || generation === undefined) {
      return { root: undefined, chat, detaching: false };
    }

    const machineName = parseMachineExecutorId(executorId);

    if (machineName !== undefined) {
      return this.prepareMachineWorkspace({
        input,
        nativeDeliverySequence,
        attemptId,
        chat,
        root,
        machineName,
        generation,
        effectivePermissionMode,
      });
    }

    const reason = await this.workspaceDetachReason(
      root,
      executorId,
      effectivePermissionMode,
    );

    if (reason === undefined) return { root, chat, detaching: false };

    return this.detachWorkspace({
      input,
      nativeDeliverySequence,
      attemptId,
      chat,
      generation,
      reason,
    });
  }

  /**
   * The binding check for a Workspace on a Machine. An unreachable Machine is
   * NOT a detached Workspace: the binding persists, every operation that
   * addresses that Machine fails with `machine_unavailable`, and the attempt
   * records the availability transition it tells. Only a Machine the operator
   * removed detaches, narrated as a removed Machine.
   */
  private async prepareMachineWorkspace(params: {
    input: ExecuteRunInput;
    nativeDeliverySequence: number;
    attemptId: string;
    chat: Chat | undefined;
    root: string;
    machineName: string;
    generation: number;
    effectivePermissionMode: PermissionMode;
  }): Promise<WorkspacePreparation> {
    const decision = await decideMachineWorkspace({
      connector: this.machineConnector,
      machineName: params.machineName,
      root: params.root,
      effectivePermissionMode: params.effectivePermissionMode,
      toolAllowlist: this.instanceConfig.config.tools.allowed,
      permissionPolicy: this.permissionPolicy,
      identity: {
        runId: params.input.runId,
        deliverySequence: params.nativeDeliverySequence,
        signal: params.input.abortSignal,
      },
      skillCatalogs: this.machineSkillCatalogs,
      skillDirectories: this.instanceConfig.config.skills.directories,
      warn: (message) => this.logger.warn(message),
    });

    if (decision.kind === 'detach') {
      return this.detachWorkspace({
        input: params.input,
        nativeDeliverySequence: params.nativeDeliverySequence,
        attemptId: params.attemptId,
        chat: params.chat,
        generation: params.generation,
        reason: decision.reason,
        removedMachine: decision.removedMachine,
      });
    }

    return {
      root: params.root,
      chat: params.chat,
      detaching: false,
      machine: decision.machine,
    };
  }

  /**
   * Detach the binding with its reason. The detached Chat row is the local
   * copy the attempt reads its narration from, so the generation it reported
   * and the reason it stores are applied together. A detached Machine binding
   * keeps the Machine's name, which the row no longer holds, so the notice can
   * name the Machine the operator removed.
   */
  private async detachWorkspace(params: {
    input: ExecuteRunInput;
    nativeDeliverySequence: number;
    attemptId: string;
    chat: Chat | undefined;
    generation: number;
    reason: WorkspaceDetachReason;
    /** The Machine this detach removed from the binding, when it had one. */
    removedMachine?: string;
  }): Promise<WorkspacePreparation> {
    const detached = await this.tenantDb.runAs(params.input.userId, (tx) =>
      new WorkspaceBindingRepository(tx).detach({
        chatId: params.input.chatId,
        ownerUserId: params.input.userId,
        runId: params.input.runId,
        deliverySequence: params.nativeDeliverySequence,
        attemptId: params.attemptId,
        expectedGeneration: params.generation,
        reason: params.reason,
      }),
    );

    if (detached === 'fence_lost') {
      throw new RunNotRunnableError(params.input.runId);
    }

    if (detached === 'detached') {
      await this.workspaceMcp?.stopForChat(params.input.chatId);

      return {
        root: undefined,
        detaching: true,
        ...detachedBinding({
          chat: params.chat,
          generation: params.generation,
          reason: params.reason,
          removedMachine: params.removedMachine,
        }),
      };
    }

    // A concurrent enter/exit won the generation compare-and-set. Do not
    // reuse the root that failed this attempt's checks.
    return { root: undefined, chat: params.chat, detaching: false };
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

    const decision = decidePermission(
      this.permissionPolicy,
      effectivePermissionMode,
      (evaluate) =>
        evaluate({ toolId: 'enter_workspace', args: { path: root } }),
    );

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
   * Activation is a `read`, so it shares a proactive read's availability: a Run
   * without `read` in `tools.allowed` activates nothing, in every permission
   * mode, as prompt imports and instruction loading do.
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
    followUp: boolean,
  ): Promise<ReadonlySet<string>> {
    const config = this.instanceConfig.config;

    if (
      !config.tools.allowed.includes('read') ||
      (config.skills.directories.length === 0 &&
        workspaceRoot.current() === undefined)
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
    // package that may have changed. A follow-up Run reads the whole message
    // instead, so it activates no skill an earlier Run of the turn already
    // did (turn-actions D8).
    const resolved = await this.tenantDb.runAs(input.userId, (tx) =>
      new ActivationPartsRepository(tx).resolvedSkills({
        id: input.userMessage.id,
        chatId: input.chatId,
        // A follow-up Run reads the whole message, so it activates no skill an
        // earlier Run of the turn already did (turn-actions D8).
        ...(!followUp && { runId: input.runId }),
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
        admitted: (toolCallId, toolInput, decision) =>
          this.recordSystemReadAdmission(
            input,
            toolCallId,
            toolInput,
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
   * Import the locators the owner marked in the stored prompt before the first
   * model request (prompt-imports D6/D7). Every read goes through `runTool` with
   * the bound `read` declaration, so a target gets exactly the admission a model
   * `read` of it gets; the result persists as one rail item on the user message.
   * A detaching attempt, a Run without `read`, and a Run whose earlier attempt
   * already persisted its item import nothing.
   */
  private async resolvePromptImports(step: PromptImportStep): Promise<void> {
    const { input } = step;

    const readAllowed =
      this.instanceConfig.config.tools.allowed.includes('read');

    if (step.detaching || !readAllowed) return;

    const message = {
      id: input.userMessage.id,
      chatId: input.chatId,
      runId: input.runId,
    };

    // A follow-up Run reuses the item an earlier Run of the turn stored and
    // reads no target again, so it asks for any Run of the message rather than
    // this one (turn-actions D8).
    const { stored, retainedBefore } = await this.tenantDb.runAs(
      input.userId,
      async (tx) => {
        const repository = new PromptImportPartsRepository(tx);

        return {
          stored: await repository.find({
            id: message.id,
            chatId: message.chatId,
            ...(!step.followUp && { runId: message.runId }),
          }),
          retainedBefore: await repository.retainedBase64(message),
        };
      },
    );

    // Presence is authoritative even when an older reader cannot decode payload.
    if (stored !== undefined) return;

    const { outcomes, omitted } = await resolvePromptImportTargets(
      this.promptImportRequest(step),
    );

    // An aborted attempt publishes nothing; the abort settles the Run.
    if (input.abortSignal?.aborted) return;

    if (outcomes.length === 0 && omitted.length === 0) return;

    const item = createPromptImportsItem({
      runId: input.runId,
      outcomes,
      omitted,
      retained: step.retainedMedia,
      retainedBefore,
    });

    // An omitted target's read may have kept its bytes before the output bound
    // dropped it, and nothing in the item names them.
    for (const locator of omitted) {
      step.retainedMedia.delete(promptImportMediaKey(input.runId, locator));
    }

    await this.tenantDb.runAs(input.userId, (tx) =>
      new PromptImportPartsRepository(tx).appendForRun({ ...message, item }),
    );
  }

  /**
   * The ports the resolution module runs against, all built from the system
   * read context: the same silent `read` pre-evaluation the instruction loader
   * uses, the same native-executor and Knowledge-root gates, an owner-scoped
   * Knowledge probe, and the owner's media, which answers the `media://` probe
   * and decodes an image or PDF without storing it, holding its bytes in the
   * attempt's memory under its entry's key (vision-media D8, pdf-media D9).
   */
  private promptImportRequest(step: PromptImportStep): PromptImportRequest {
    const { input } = step;

    // One signal bounds the whole pass: the Run's abort, or the work budget
    // measured from now. In-flight reads run under it.
    const signal = AbortSignal.any([
      ...(input.abortSignal ? [input.abortSignal] : []),
      AbortSignal.timeout(PROMPT_IMPORT_WORK_MS),
    ]);

    const media = createToolMediaStore(
      new MediaService(this.tenantDb),
      input.userId,
      step.retainedMedia,
    );

    const context: ToolContext = {
      ...this.buildSystemReadContext(
        input,
        step.nativeDeliverySequence,
        step.workspaceRoot,
        step.effectivePermissionMode,
      ),
      skillSelection: step.skillSelection,
      abortSignal: signal,
      media,
    };

    return {
      text: partsToText(input.userMessage.parts),
      signal,
      workspaceRoot: step.workspaceRoot.current(),
      hostAvailable: this.hostInstructionsLoadable(),
      knowledgeAvailable: this.knowledgeInstructionsLoadable(),
      machineAvailable: machineInstructionAvailability({
        connector: this.machineConnector,
        toolAllowlist: this.instanceConfig.config.tools.allowed,
      }),
      sshAvailable:
        this.sshClient !== undefined &&
        this.instanceConfig.config.tools.allowed.includes('read'),
      admitsRead: (path) =>
        previewToolPermission(nativeReadTool, { path }, context),
      probeHost: async (path) => {
        const { kind } = await statHostPath(path);

        return kind === 'file' || kind === 'directory';
      },
      probeMachine: (name, path) =>
        probeMachinePromptTarget(
          this.machineConnector,
          {
            runId: input.runId,
            deliverySequence: step.nativeDeliverySequence,
            signal: context.abortSignal,
          },
          { name, path },
        ),
      probeKnowledge: (locator) => this.probePromptKnowledge(context, locator),
      probeMedia: async (locator) => {
        const id = parseMediaLocator(locator);

        if (id === undefined) return undefined;

        return (await media.findMedia(id)) === undefined
          ? undefined
          : mediaLocator(id);
      },
      readImport: async (path, ordinal, locator) => {
        const key = promptImportMediaKey(input.runId, locator);

        const { result, admission } = await this.readTurnInstructionPage(
          input,
          {
            ...context,
            media: {
              ...media,
              readMedia: (submitted) => media.readMedia(submitted, key),
            },
          },
          path,
          ['prompt-import', input.runId, step.attemptId, ordinal].join('-'),
          ORIGIN_PROMPT_IMPORT,
        );

        // The imported body is the same text the model receives for this
        // read (prompt-imports "Imported results equal native read output").
        return {
          result,
          text: renderToolResultText('read', result),
          admission,
        };
      },
      nowMs: () => Date.now(),
    };
  }

  /**
   * The canonical `kb://` locator of an existing target in the Run owner's own
   * Spaces, or undefined when it cannot be found for that owner. Resolution
   * runs under the owner-scoped resolver, so another owner's Space is
   * indistinguishable from a missing one.
   */
  private async probePromptKnowledge(
    context: ToolContext,
    locator: string,
  ): Promise<string | undefined | typeof PROMPT_IMPORT_KNOWLEDGE_CANCELLED> {
    const rest = locator.slice(`${KNOWLEDGE_LOCATOR_SCHEME}://`.length);
    const parsed = parseKnowledgeLocator(rest);

    if ('type' in parsed) return undefined;

    try {
      const target = await resolveKnowledgeLocator(context, locator, rest);

      return 'status' in target ? undefined : formatKnowledgeLocator(parsed);
    } catch (error) {
      if (
        error instanceof KnowledgeFilesystemError &&
        error.code === 'knowledge_cancelled'
      ) {
        return PROMPT_IMPORT_KNOWLEDGE_CANCELLED;
      }

      throw error;
    }
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
      skillCatalog: this.skillCatalogFor(workspaceRoot.current()),
      permissionPolicy: this.permissionPolicy,
      configuredCredentials: configuredCredentials(this.instanceConfig.config),
      webAdapters: this.instanceConfig.config.tools.webAdapters,
      webSearch: this.instanceConfig.config.webSearch,
      grepBounds: this.instanceConfig.config.tools.grep,
      ...this.artifactReadContext(),
      callTimeoutSeconds: this.instanceConfig.config.tools.callTimeoutSeconds,
      workerDeadAfterSeconds: workerDeadAfterSeconds(
        this.instanceConfig.config,
      ),
      modelClients: this.models,
      decisions: this.decisions,
      permissionMode: effectivePermissionMode,
      machines: this.machineConnector,
      machineStatus: this.machinesStatus,
      machineAttemptKey: machineAttemptKey(input.runId, nativeDeliverySequence),
      sshClient: this.sshClient,
      executorGit: this.executorGit,
    };
  }

  /** The one process limiter of this worker, built from `tools.bash.maxProcesses`. */
  private hostBashLimiter(): BashProcessLimiter {
    this.bashProcessLimiter ??= new BashProcessLimiter(
      this.instanceConfig.config.tools.bash.maxProcesses,
    );

    return this.bashProcessLimiter;
  }

  /**
   * The artifact surface of a Run (tool-result-artifacts "An artifact needs a
   * way to read it"): the operator byte bound, whether `read` is allowlisted,
   * and whether the Run also keeps host files. `capHeadResult` and `bash`
   * evaluate the `read` group on the locator; the host files are written only
   * when `artifactHostFiles` holds (design D10).
   */
  private artifactReadContext(): Pick<
    ToolContext,
    'artifactMaxBytes' | 'artifactReadable' | 'artifactHostFiles'
  > {
    const { artifacts, allowed } = this.instanceConfig.config.tools;

    return {
      artifactMaxBytes: artifacts.maxBytes,
      artifactReadable: allowed.includes('read'),
      artifactHostFiles: this.artifactHostFilesEnabled(),
    };
  }

  /**
   * The accepted-turn instructions load (D5): the live binding's root chain,
   * staged before the first request when any file of it is not already in
   * effective context, together with the chains the Run's prompt imports
   * trigger. Computed outside every database transaction, because probing and
   * reading candidates is filesystem and tool work.
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
    const gates = {
      host: this.hostInstructionsLoadable(),
      knowledge: this.knowledgeInstructionsLoadable(),
      machine: machineInstructionAvailability({
        connector: this.machineConnector,
        toolAllowlist: this.instanceConfig.config.tools.allowed,
      }),
    };

    const toolContext =
      gates.host || gates.knowledge || gates.machine
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
      ...this.turnInstructionWorlds(input, toolContext, gates, nextToolCallId),
      promptImportTriggers: preparation.detaching
        ? []
        : await this.promptImportInstructionTriggers(input, gates),
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
   * The worlds the accepted-turn load may read in, one audited reader for
   * all: the host world only with a native executor, the Knowledge world
   * only with a configured Knowledge root, and the Machine world only with a
   * configured Machine, so a trigger whose world this Run may not load is
   * ignored before anything is probed.
   */
  private turnInstructionWorlds(
    input: ExecuteRunInput,
    toolContext: ToolContext | undefined,
    gates: PromptImportTriggerGates,
    nextToolCallId: () => string,
  ): Pick<
    TurnInstructions,
    'readPage' | 'knowledge' | 'machines' | 'admitsRead'
  > {
    if (toolContext === undefined) {
      return {
        readPage: undefined,
        knowledge: undefined,
        machines: undefined,
        admitsRead: undefined,
      };
    }

    const readPage: ReadPage = async (selectorPath, canonicalPath) =>
      (
        await this.readTurnInstructionPage(
          input,
          toolContext,
          selectorPath,
          nextToolCallId(),
          ORIGIN_INSTRUCTIONS,
          canonicalPath,
        )
      ).result;

    return {
      readPage: gates.host ? readPage : undefined,
      knowledge: this.knowledgeInstructionWorld(input, readPage),
      machines: machineInstructionWorld({
        enabled: gates.machine,
        connector: this.machineConnector,
        readPage,
        identity: {
          runId: input.runId,
          deliverySequence: toolContext.nativeDeliverySequence,
          signal: input.abortSignal,
        },
      }),
      admitsRead: (path) =>
        previewToolPermission(nativeReadTool, { path }, toolContext),
    };
  }

  /**
   * The triggers of the Run's persisted prompt-imports item, recomputed on
   * every attempt: a retry after a binding switch stages the same load,
   * because a resolved path is absolute and never projected again.
   */
  private async promptImportInstructionTriggers(
    input: ExecuteRunInput,
    gates: PromptImportTriggerGates,
  ): Promise<ReadonlyArray<PromptImportTrigger>> {
    if (this.inRunProducer?.prepareTurn === undefined) return [];

    if (!gates.host && !gates.knowledge && !gates.machine) return [];

    const stored = await this.tenantDb.runAs(input.userId, (tx) =>
      new PromptImportPartsRepository(tx).find({
        id: input.userMessage.id,
        chatId: input.chatId,
        runId: input.runId,
      }),
    );

    const payload = stored?.data.payload;

    return payload === undefined
      ? []
      : derivePromptImportTriggers(payload.imports, gates);
  }

  /**
   * The Knowledge world one attempt may load Space candidates in: absent
   * without `read` and a configured Knowledge root, else the audited page
   * reader and the owner-scoped Space probe.
   */
  private knowledgeInstructionWorld(
    input: ExecuteRunInput,
    readPage: ReadPage,
  ): InRunAttempt['knowledge'] {
    if (!this.knowledgeInstructionsLoadable()) return undefined;

    return {
      readPage,
      probe: createKnowledgeInstructionProbe({
        resolver: this.knowledgeResolver,
        ownerUserId: input.userId,
        signal: input.abortSignal,
      }),
    };
  }

  /**
   * Recomputes the accepted-turn bundle against the attempt's effective
   * history before the first request and whenever that history is rebuilt. The
   * rebuild decides the seen set — the item this attempt staged can no longer
   * be what makes its files seen, and a file the rebuilt history discloses must
   * not be staged again. The staged item is replaced in place, where both
   * holders of the staged array — the request assembly and the dispatch
   * transaction that stores it — see the same content.
   */
  private async refreshTurnInstructions(
    turn: TurnInstructions,
    stagedParts: Array<MessagePart>,
    input: ExecuteRunInput,
    seenCanonicalPaths: ReadonlySet<string>,
  ): Promise<void> {
    const producer = this.inRunProducer;
    const admitsRead = turn.admitsRead;

    // The root load needs a binding and the host world; prompt-import
    // triggers need neither a binding nor the host world (design D4). The
    // producer ignores a host trigger of a Run without the host reader.
    if (
      producer?.prepareTurn === undefined ||
      admitsRead === undefined ||
      (turn.root === undefined && turn.promptImportTriggers.length === 0)
    ) {
      return;
    }

    const part = await producer.prepareTurn({
      runId: input.runId,
      workspaceRoot: turn.root,
      readPage: turn.readPage,
      admitsRead,
      knowledge: turn.knowledge,
      promptImportTriggers: turn.promptImportTriggers,
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

    if (part !== undefined) placeRailPart(stagedParts, part);
  }

  /**
   * One audited system-origin page read: the accepted-turn instructions load
   * and the prompt imports. Preparation has no attempt tool closure to join,
   * so this records the same requested/started/completed triple a model read
   * does directly, carrying `origin`; an attempt aborted here publishes neither
   * the item nor an open call. `admission` is the decision the read group
   * reached, absent when the call was refused before any decision.
   */
  private async readTurnInstructionPage(
    input: ExecuteRunInput,
    toolContext: ToolContext,
    selectorPath: string,
    toolCallId: string,
    origin: ToolActivityOrigin,
    canonicalPath?: string,
  ): Promise<{
    result: ToolResult;
    admission: PermissionDecision | undefined;
  }> {
    const toolInput = { path: selectorPath };
    const derivedDecisions: Array<DerivedDecisionRecord> = [];
    let admission: PermissionDecision | undefined;

    const observed = await runTool(
      nativeReadTool,
      toolInput,
      {
        ...toolContext,
        toolCallId,
        canonicalReadPath: canonicalPath,
        onDerivedDecision: (decision) =>
          appendDerivedDecision(derivedDecisions, decision),
      },
      this.instanceConfig.config.tools.callTimeoutSeconds,
      (decision) => {
        admission = decision;

        return this.recordSystemReadAdmission(
          input,
          toolCallId,
          toolInput,
          origin,
          decision,
        );
      },
    );

    await this.recordSystemReadCompletion(
      input,
      toolCallId,
      origin,
      observed,
      derivedDecisions,
    );

    return { result: observed, admission };
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
          classification: nativeReadTool.classification,
        });
      }
    });
  }

  private async recordSystemReadCompletion(
    input: ExecuteRunInput,
    toolCallId: string,
    origin: ToolActivityOrigin,
    result: ToolResult,
    derivedDecisions?: ReadonlyArray<DerivedDecisionRecord>,
  ): Promise<void> {
    await this.tenantDb.runAs(input.userId, (tx) => {
      const payload: ToolCompletedEventPayload = {
        toolCallId,
        toolName: 'read',
        status: result.status,
        output: result,
        origin,
      };

      if (derivedDecisions !== undefined && derivedDecisions.length > 0) {
        payload.derivedDecisions = derivedDecisions;
      }

      return new RunEventsRepository(tx).append(
        input.runId,
        'tool.completed',
        payload,
      );
    });
  }

  /**
   * The attempt model as the epoch media window sees it (pdf-media D5): its
   * declared input, its window, and the configured output reserve the fit
   * check subtracts.
   */
  private async newestOwnerQuote(
    input: ExecuteRunInput,
    rows: ReadonlyArray<Message>,
  ): Promise<string | null> {
    const currentText = partsToText(input.userMessage.parts);

    if (currentText.length > 0) return currentText;

    const carriedQuote = input.userMessage.parts.find(
      (part) =>
        isRecord(part) &&
        isRecord(part['data']) &&
        part['data']['producer'] === 'compaction' &&
        isRecord(part['data']['payload']) &&
        isString(part['data']['payload']['quote']),
    );

    if (isRecord(carriedQuote) && isRecord(carriedQuote['data'])) {
      const payload = carriedQuote['data']['payload'];

      if (isRecord(payload) && isString(payload['quote'])) {
        return payload['quote'];
      }
    }

    const created = await this.tenantDb.runAs(input.userId, (tx) =>
      new RunEventsRepository(tx).findFirstByType(
        input.runId,
        input.userId,
        'run.created',
      ),
    );

    if (isRecord(created?.payload) && created.payload['messageId'] === null) {
      return null;
    }

    const newest = rows.findLast(
      (row) => row.role === 'user' && row.senderUserId === input.userId,
    );

    return newest === undefined ? null : partsToText(newest.parts);
  }

  private mediaAdmissionContext(client: ModelClient): MediaAdmissionContext {
    return {
      input: client.input ?? ['text'],
      contextWindowTokens: client.contextWindowTokens,
      reservedOutputTokens: this.instanceConfig.config.runs.maxOutputTokens,
    };
  }

  /**
   * Window precedence is fixed; empty ranges are no-ops unless the request
   * does not fit. A fitting request whose epoch media window overflowed with a
   * stored image or PDF in an earlier row counts as reaching the threshold
   * (vision-media D6, pdf-media D5): compaction can absorb those rows and start
   * a new epoch.
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
      media: input.media,
    });

    if (!fits) {
      if (plan === null) {
        throw new ContextIncompatibleError(
          'The complete request exceeds the target model context window and no committed turn is left to summarize.',
        );
      }

      return { variant: 'window', plan };
    }

    // The stored triggering row: its prompt-imports item, appended after the
    // Run was queued, carries references the queued parts do not.
    const triggerParts =
      input.historyRows.find((row) => row.seq === input.run.userMessage.seq)
        ?.parts ?? input.run.userMessage.parts;

    if (
      plan !== null &&
      input.media !== undefined &&
      mediaOverflowCompacts(
        input.media,
        triggerRefCount(triggerParts),
        input.keptRefCount,
      )
    ) {
      return { variant: 'threshold', plan };
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
        new RunsRepository(tx).findCompletedReplyRunBefore(
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
        media: input.media,
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
        modelId: input.run.client.model,
        media: input.media,
        keptRefCount: input.keptRefCount,
      }) +
      // The kept steps are not history rows, so the continuation estimate
      // cannot see them: a Continue Run measures them here, or its threshold
      // would ignore everything it resumes (turn-actions D5). A Run that keeps
      // nothing adds nothing.
      (input.keptMessages.length === 0
        ? 0
        : estimateModelRequestTokens({
            system: '',
            messages: [...input.keptMessages],
            toolDeclarations: [],
            media: input.media,
          }))
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

  /**
   * Finalizes the reply of a Run the claim transaction just ended, and
   * records its terminal event. Returns the reply it wrote, so the caller
   * touches and reindexes the chat once the claim commits.
   */
  private async settleAtClaim(
    tx: Db,
    finished: Run | undefined,
    status: TerminalRunStatus,
    message: string,
  ): Promise<Message | undefined> {
    if (!finished) return undefined;

    const reply = await finalizeRunReply(tx, {
      run: finished,
      status,
      models: this.instanceConfig.config.models,
    });

    await new RunEventsRepository(tx).append(finished.id, `run.${status}`, {
      message,
    });

    return reply;
  }

  /**
   * Settles a Run from an attempt that does not hold its live collector: the
   * reply is rebuilt in place from the log and keeps its creation time, so
   * only the chat touch and reindex after the commit make its settled content
   * searchable.
   */
  private async finishRunWithoutCollector(
    input: FinishRunInput,
  ): Promise<FinishRunResult> {
    const finish = await this.finishRun(input);
    await this.afterAssistantTurn(finish.assistantMessage, input.userId);

    return finish;
  }

  /** Settle an observed abort before streaming and suppress queue retries only
   * after the terminal state + matching event are durably visible. Fenced by
   * `attemptId`: only the attempt that observed the abort may settle it, so a
   * reclaimed attempt's late abort cannot cancel the live attempt's run. */
  private async settleIfAborted(
    input: {
      userId: string;
      runId: string;
      abortSignal?: AbortSignal;
    },
    attemptId: string,
  ): Promise<void> {
    if (!input.abortSignal?.aborted) return;

    await this.settleAbortedRun(input, attemptId);
  }

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

    const finish = await this.finishRunWithoutCollector({
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
        loggableError(error),
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
    const finish = await this.commitFinishRun(input);

    if (
      finish.outcome === 'won' &&
      finish.promoted !== undefined &&
      this.runDispatch !== undefined
    ) {
      await this.dispatchPromotedRun(this.runDispatch, finish.promoted);
    }

    return finish;
  }

  /**
   * Enqueue the Run a completion promoted, after its commit. `dispatch` fails
   * that Run when the enqueue fails, which frees the Chat for the owner, and
   * logs it; the completed Run behind it stays completed, so the error is not
   * propagated.
   */
  private async dispatchPromotedRun(
    dispatcher: Pick<RunDispatcher, 'dispatch'>,
    job: RunJob,
  ): Promise<void> {
    try {
      await dispatcher.dispatch(job);
    } catch {
      // Already logged and the promoted Run already failed by `dispatch`.
    }
  }

  private async commitFinishRun(
    input: FinishRunInput,
  ): Promise<FinishRunResult> {
    try {
      return await retryAbortedTransaction(() =>
        this.tenantDb.runAs(input.userId, (tx) =>
          this.finishRunInTransaction(tx, input),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to finish run ${input.runId}`,
        loggableError(error),
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

  private async finishFinalCompaction(
    tx: Db,
    input: FinishRunInput,
    run: Run,
    compaction: Extract<BoundaryDelivery, { kind: 'final-compacted' }>,
  ): Promise<Message> {
    await this.finalizeAssistantTurnTelemetry(tx, input, run);

    const message = await finalizeRunReply(tx, {
      run,
      status: 'completed',
      attemptId: input.attemptId,
      live: input.assistantTurn,
      telemetry: input.synthesizedTurnTelemetry,
      models: this.instanceConfig.config.models,
    });

    if (message === undefined) {
      throw new Error('Final compaction has no assistant reply.');
    }

    await persistFirstEpochBaselines(tx, run, input);
    await compaction.compaction.publishCheckpoint(tx, message);

    await markCompactItemsDelivered(
      tx,
      compaction.commandItems,
      input.userId,
      input.runId,
    );

    return message;
  }

  /** Execute terminal bookkeeping within the caller's tenant transaction. */
  private async finishRunInTransaction(
    tx: Db,
    input: FinishRunInput,
  ): Promise<FinishRunResult> {
    const runsRepo = new RunsRepository(tx);
    let current: Run | undefined;

    if (input.expectedQueueIdentity !== undefined) {
      const [candidate] = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, input.runId), eq(runs.userId, input.userId)))
        .limit(1);

      if (
        !candidate ||
        !(await new ChatsRepository(tx).lock(candidate.chatId, input.userId))
      ) {
        return { outcome: 'lost', finalStatus: candidate?.status };
      }

      [current] = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, input.runId), eq(runs.userId, input.userId)))
        .for('update');

      if (
        !current ||
        isTerminalRunStatus(current.status) ||
        current.finishedAt !== null ||
        current.currentJobId !== input.expectedQueueIdentity.currentJobId ||
        current.wakeGeneration !== input.expectedQueueIdentity.wakeGeneration
      ) {
        return { outcome: 'lost', finalStatus: current?.status };
      }
    }

    let finalAssistantMessage: Message | undefined;

    if (input.status === 'completed' && input.attemptId !== undefined) {
      const finalRun =
        current ?? (await runsRepo.findById(input.runId, input.userId));

      if (finalRun?.kind === 'turn') {
        const finalDelivery = await deliverPendingSteering(tx, {
          run: { runId: input.runId, userId: input.userId },
          attemptId: input.attemptId,
          modelCompleted: input.modelCompleted,
          live: input.assistantTurn,
          telemetry: input.synthesizedTurnTelemetry,
          models: this.instanceConfig.config.models,
          deadWorkerAfterSeconds: workerDeadAfterSeconds(
            this.instanceConfig.config,
          ),
          baselines: input,
          finalAnswer: true,
          stepBudgetUsed: input.stepBudgetUsed,
          boundaryCompaction: input.boundaryCompaction,
        });

        if (
          finalDelivery.kind !== 'cancelled' &&
          finalDelivery.kind !== 'fenced' &&
          (input.boundaryCompaction?.summary == null ||
            finalDelivery.kind === 'nothing-pending')
        ) {
          await this.appendQuotaRecovered(tx, input.runId, input.quotaRequest);
        }

        if (finalDelivery.kind === 'delivered') {
          return {
            outcome: 'delivered',
            assistantMessage: finalDelivery.closedReply,
            delivery: finalDelivery,
          };
        }

        if (finalDelivery.kind === 'final-compacted') {
          finalAssistantMessage = await this.finishFinalCompaction(
            tx,
            input,
            finalRun,
            finalDelivery,
          );
        }
      }
    }

    const finished = await runsRepo.markFinished(
      input.runId,
      input.userId,
      input.status,
      { error: input.error, attemptId: input.attemptId },
    );

    if (!finished) {
      return this.handleLostFinish(tx, input, runsRepo);
    }

    return this.finishRunAfterDelivery({
      tx,
      input,
      finished,
      finalAssistantMessage,
    });
  }

  private async finishRunAfterDelivery(context: {
    tx: Db;
    input: FinishRunInput;
    finished: Run;
    finalAssistantMessage: Message | undefined;
  }): Promise<FinishRunResult> {
    const { tx, input, finished, finalAssistantMessage } = context;

    if (finalAssistantMessage === undefined) {
      // Completeness reads the reply before the finalizer settles it.
      await this.finalizeAssistantTurnTelemetry(tx, input, finished);
    }

    const assistantMessage =
      finalAssistantMessage ??
      (await finalizeRunReply(tx, {
        run: finished,
        status: input.status,
        attemptId: input.attemptId,
        live: input.assistantTurn,
        telemetry: input.synthesizedTurnTelemetry,
        models: this.instanceConfig.config.models,
      }));

    const events = new RunEventsRepository(tx);

    // The cut this attempt's failed send left: the reply written above holds
    // the kept parts and the notice, and this event names the dropped output
    // (continue-after-broken-send D6). It precedes `model.completed` because
    // the live bridge prunes the step's part starts at `model.completed`, so
    // a cut arriving after it would survive in the live view until reload
    // (design D7).
    if (input.superseded !== undefined) {
      await events.append(input.runId, 'model.superseded', input.superseded);
    }

    if (input.modelCompleted) {
      await events.append(
        input.runId,
        'model.completed',
        assistantMessage === undefined
          ? input.modelCompleted
          : { ...input.modelCompleted, telemetry: assistantMessage.usage },
      );
    }

    // The baselines only the winning turn establishes live in the system
    // prompt, so they ride this attempt-fenced transaction; a losing attempt
    // can never freeze a prompt the winner never rendered.
    if (input.status === 'completed' && finalAssistantMessage === undefined) {
      await persistFirstEpochBaselines(tx, finished, input);
    }

    await events.append(input.runId, `run.${input.status}`, input.runPayload);

    // A recorded cancellation means the owner asked to stop: nothing starts.
    const promoted =
      input.status === 'completed' &&
      finished.cancelRequestedAt === null &&
      this.runDispatch !== undefined
        ? await promoteNextQueueItem(tx, {
            completed: finished,
            models: this.models,
            enabledPermissionModes:
              this.instanceConfig.config.tools.permissionModes,
          })
        : undefined;

    return {
      outcome: 'won',
      assistantMessage,
      promoted,
    };
  }

  /**
   * The `interrupted` notice for the message this attempt runs, when an
   * interrupt delivered it: read back from the `run.delivered` event, which
   * names the delivered message and the calls the stop killed. Only the
   * segment's first dispatch calls this; a retry finds the notice stored on
   * the message.
   */
  private async deliveredInterrupt(
    tx: Db,
    input: ExecuteRunInput,
  ): Promise<AuthoredContextItemPart | undefined> {
    const delivered = await new RunEventsRepository(tx).listByRunId(
      input.runId,
      input.userId,
      { eventTypes: ['run.delivered'] },
    );

    const event = delivered.findLast(
      ({ payload }) =>
        isRecord(payload) && payload['messageId'] === input.userMessage.id,
    );

    if (!isRecord(event?.payload) || event.payload['cause'] !== 'interrupt') {
      return undefined;
    }

    return createInterruptedItem({
      runId: input.runId,
      stoppedCalls: stoppedCallsOf(event.payload),
    });
  }

  /**
   * Records the `native.result` of an MCP call that an interrupt stopped after
   * its dispatch, so a later retry of the call finds a result, not a bare
   * attempt. A failed write leaves the attempt, which a retry reads as unknown.
   */
  private async recordInterruptedMcpResult(
    input: ExecuteRunInput,
    toolCallId: string,
    result: ToolResult,
  ): Promise<void> {
    try {
      await this.tenantDb.runAs(input.userId, (tx) =>
        new RunEventsRepository(tx).append(input.runId, 'native.result', {
          toolCallId,
          result,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not record the result of interrupted MCP call ${toolCallId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /** Finalizes usage completeness against owner-scoped Run and reply state. */
  private async finalizeAssistantTurnTelemetry(
    tx: Db,
    input: Pick<
      FinishRunInput,
      'userId' | 'runId' | 'attemptId' | 'assistantTurn' | 'modelCompleted'
    >,
    run: Run | undefined,
    assistantTurn: AssistantTurnWrite | undefined = input.assistantTurn,
  ): Promise<void> {
    // Telemetry-bearing writers share one object between the completed event
    // and assistant turn, so finalizing the event's object finalizes both.
    const telemetry = input.modelCompleted?.telemetry;

    if (!telemetry) {
      return;
    }

    await finalizeUsageCompleteness(tx, {
      userId: input.userId,
      runId: input.runId,
      attemptId: input.attemptId,
      run,
      chatId: assistantTurn?.chatId ?? run?.chatId,
      inReplyTo: assistantTurn?.inReplyTo ?? run?.messageId,
      telemetry,
    });
  }

  /**
   * Another writer won the terminal transition. While the Run is terminal or
   * still names this attempt, the attempt's live turn finalizes a reply left
   * `running` under it, and after an expiry salvages what streamed; a newer
   * attempt holding the live Run owns the reply, and a cancellation or an
   * already-recorded answer intentionally gets nothing.
   */
  private async handleLostFinish(
    tx: Db,
    input: FinishRunInput,
    runsRepo: RunsRepository,
  ): Promise<FinishRunResult> {
    const current = await runsRepo.findById(input.runId, input.userId);
    const turn = input.assistantTurn;

    const assistantMessage =
      turn === undefined ||
      current === undefined ||
      (current.activeAttemptId !== input.attemptId &&
        !isTerminalRunStatus(current.status))
        ? undefined
        : await this.persistAttemptTurn(
            tx,
            input,
            current,
            turn,
            current.status === 'expired',
          );

    return {
      outcome: 'lost',
      finalStatus: current?.status,
      assistantMessage,
    };
  }

  /**
   * Writes an attempt's live turn outside its own terminal transition, where
   * `ownsLiveReply` admits it: onto a reply still `running` under this
   * attempt, and when `salvage` also onto a missing reply or one this attempt
   * dispatched that another writer settled.
   */
  private async persistAttemptTurn(
    tx: Db,
    input: Pick<
      FinishRunInput,
      'userId' | 'runId' | 'attemptId' | 'assistantTurn' | 'modelCompleted'
    >,
    run: Run | undefined,
    turn: AssistantTurnWrite,
    salvage: boolean,
  ): Promise<Message | undefined> {
    const messagesRepo = new MessagesRepository(tx);

    const state = await messagesRepo.findTurnState(
      turn.chatId,
      input.userId,
      turn.inReplyTo,
    );

    if (!ownsLiveReply(state.assistantMessage, input.attemptId, salvage)) {
      return undefined;
    }

    await this.finalizeAssistantTurnTelemetry(tx, input, run, turn);

    return persistReply(messagesRepo, state, {
      chatId: turn.chatId,
      inReplyTo: turn.inReplyTo,
      parts: turn.parts,
      usage: turn.telemetry,
    });
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
    turnGit: TurnGit,
    workspaceRoot: WorkspaceRootCell,
    readPage: ReadPage,
    admitsRead: (path: string) => boolean,
  ): InRunAttemptProducer | undefined {
    const attempt: InRunAttempt = {
      runId: input.runId,
      chatId: input.chatId,
      userId: input.userId,
      // The accepted-turn load's keys count as disclosed: a file it staged
      // must not reload on the attempt's first in-Run trigger.
      seenKeys: turn.seenCanonicalPaths,
      readPage: this.hostInstructionsLoadable() ? readPage : undefined,
      admitsRead,
      knowledge: this.knowledgeInstructionWorld(input, readPage),
      machines: turn.machines,
      abortSignal: input.abortSignal,
      git: this.gitWorld(input, turnGit, workspaceRoot, admitsRead),
    };

    // The rail's order: the git item of one step precedes its instructions.
    return composeAttemptProducers([
      this.gitProducer?.beginAttempt(attempt),
      this.inRunProducer?.beginAttempt(attempt),
    ]);
  }

  /** What the `git` producer observes an in-Run entry with; none without the service. */
  private gitWorld(
    input: ExecuteRunInput,
    turnGit: TurnGit,
    workspaceRoot: WorkspaceRootCell,
    admitsRead: (path: string) => boolean,
  ): InRunGitWorld | undefined {
    const snapshots = this.gitSnapshots;

    if (snapshots === undefined) return undefined;

    return {
      observe: (root) =>
        this.observeGit(snapshots, admitsRead, {
          root,
          signal: input.abortSignal,
        }),
      currentRoot: () => workspaceRoot.current(),
      toldText: turnGit.part?.data.text ?? turnGit.toldText,
    };
  }

  /** One git observation under the model's admission: `read` allowlisted and admitted. */
  private observeGit(
    snapshots: Pick<GitSnapshotService, 'observe'>,
    admitsRead: (path: string) => boolean,
    input: Omit<Parameters<typeof observeWorkspaceRoot>[1], 'admit'>,
  ): Promise<GitObservation> {
    const readAllowlisted =
      this.instanceConfig.config.tools.allowed.includes('read');

    return observeWorkspaceRoot(
      { snapshots, executors: this.executorGit, readAllowlisted },
      {
        ...input,
        admit: modelGitAdmission({ readAllowlisted, admitsRead }),
      },
    );
  }

  /**
   * Starts the attempt's one git observation for a bound Chat; none for an
   * unbound one. It never rejects. An unreachable Machine answers without a
   * request, from the attempt's own reachability verdict.
   */
  private startGitObservation(
    input: ExecuteRunInput,
    nativeDeliverySequence: number,
    preparation: WorkspacePreparation,
    workspaceRoot: WorkspaceRootCell,
    effectivePermissionMode: PermissionMode,
  ): Promise<GitObservation> | undefined {
    const { root, machine } = preparation;
    const snapshots = this.gitSnapshots;

    if (this.gitProducer === undefined || snapshots === undefined) return;

    if (root === undefined) return;

    const toolContext = this.buildSystemReadContext(
      input,
      nativeDeliverySequence,
      workspaceRoot,
      effectivePermissionMode,
    );

    return this.observeGit(
      snapshots,
      (path) => previewToolPermission(nativeReadTool, { path }, toolContext),
      {
        root,
        ...(machine !== undefined && {
          reachable: () => Promise.resolve(machine.available),
        }),
        signal: input.abortSignal,
      },
    );
  }

  /** Best-effort standalone persist after the terminal transaction rolled back. */
  private async salvageAssistantMessage(
    input: Pick<
      FinishRunInput,
      'userId' | 'runId' | 'attemptId' | 'assistantTurn' | 'modelCompleted'
    >,
  ): Promise<Message | undefined> {
    const turn = input.assistantTurn;

    if (!turn) {
      return undefined;
    }

    try {
      return await this.tenantDb.runAs(input.userId, async (tx) => {
        const run = await new RunsRepository(tx).findById(
          input.runId,
          input.userId,
        );

        // The terminal transaction rolled back: the reply still holds this
        // attempt's `running` row unless a later attempt has reset it.
        return this.persistAttemptTurn(tx, input, run, turn, true);
      });
    } catch (error) {
      this.logger.error(
        `Failed to salvage the assistant turn for run ${input.runId}`,
        loggableError(error),
      );

      return undefined;
    }
  }

  /**
   * Bump the chat's activity time so an in-place assistant-reply update
   * (which leaves messages.created_at unchanged) still moves the search
   * staleness high-water mark — the reindex sweep's backstop for a lost
   * enqueue — and so the chat list reflects the latest turn. Its own
   * single-row transaction, called BEFORE the reindex rather than in the
   * terminal one: the terminal transaction takes the chat row only after the
   * Run row, for queue promotion (run-steering D5), and this touch stays
   * separate for reindex ordering. A touch landing after the reindex would leave every
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

  /**
   * Work that must NOT share the terminal transaction: it is best-effort, and
   * a failure here must not roll back the committed turn. No-op when nothing
   * was persisted (dual-fire, or the chat vanished mid-stream).
   */
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
        userText: titleInputText(input.userMessage),
      });
    }
  }

  /**
   * The kept parts a Continue Run's admission recorded, and the step of each
   * kept call, or undefined for a Run that did not continue one (turn-actions
   * D5). Read once per attempt, before any preparation, so the request, the
   * part collector, and the in-Run region all start from the same state.
   */
  private async loadContinueState(
    input: ExecuteRunInput,
  ): Promise<ContinueState | undefined> {
    if (input.followUpAction !== 'continue') return undefined;

    const event = await this.tenantDb.runAs(input.userId, (tx) =>
      new RunEventsRepository(tx).findFirstByType(
        input.runId,
        input.userId,
        'run.continued',
      ),
    );

    return event === undefined ? undefined : continueStateFromEvents([event]);
  }

  /**
   * Resolve prompt, catalog, context items, and message history for one
   * execution attempt. Runs inside a single tenant transaction.
   *
   * `afterPublication` is false for the trigger's estimate pass and true only
   * for the pass that follows a pre-step checkpoint publication. An attempt
   * binds exactly one receipt, and it must describe the prompt the attempt
   * actually sends — the one rendered after a pre-step checkpoint published
   * (design D5). A pass that published nothing binds it; the pass that follows
   * a publication does. That pass also judges availability against the epoch
   * the publication started, not a record an earlier attempt dispatched.
   */
  private async prepareAttemptContext(
    input: ExecuteRunInput,
    attemptId: string,
    workspaceChat: Chat | undefined,
    workspaceRoot: string | undefined,
    workspaceMcpKey: WorkspaceMcpKey | undefined,
    afterPublication: boolean,
    machine: MachineWorkspaceState | undefined,
    continued: ContinueState | undefined,
  ): Promise<PreparedAttemptContext> {
    return this.tenantDb.runAs(input.userId, (tx) =>
      this.prepareAttemptContextInTransaction(
        tx,
        input,
        attemptId,
        workspaceChat,
        workspaceRoot,
        workspaceMcpKey,
        afterPublication,
        machine,
        continued,
      ),
    );
  }
  /** Resolve the complete attempt context, binding its receipt after publication. */
  private async prepareAttemptContextInTransaction(
    tx: Db,
    input: ExecuteRunInput,
    attemptId: string,
    workspaceChat: Chat | undefined,
    workspaceRoot: string | undefined,
    workspaceMcpKey: WorkspaceMcpKey | undefined,
    afterPublication: boolean,
    machine: MachineWorkspaceState | undefined,
    continued: ContinueState | undefined,
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

    const disclosures: Array<PromptChatsDisclosure> = [];
    let catalog: AttemptToolCatalog;

    try {
      catalog = await this.composeAttemptCatalog(
        tx,
        input,
        promptInputs,
        workspaceMcpKey,
        disclosures,
      );
    } catch (error) {
      if (error instanceof ToolDescriptionRenderError) {
        throw new ModelContextExecutionError(
          `Tool "${error.toolId}" description rendered empty.`,
        );
      }

      throw error;
    }

    const system = this.renderAttemptSystemPrompt({
      model: promptInputs.model,
      anchor: promptInputs.anchor,
      user: promptInputs.user,
      chats: promptInputs.promptDigestBaseline,
      skills: promptInputs.skillState.baseline,
      admittedToolIds: catalog.admittedIds,
    });

    disclosures.push(system.chatsDisclosure);

    const prompt: AttemptPromptContext = {
      ...promptInputs,
      ...(await this.accountAttemptDigestDisclosure({
        tx,
        input,
        prompt: promptInputs,
        disclosures,
      })),
      systemPrompt: system.text,
    };

    const effectiveContext = this.resolveAttemptEffectiveContext(
      prompt,
      catalog,
    );

    if (afterPublication) {
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
      afterPublication,
      machine,
      // Every follow-up Run — Continue and Regenerate alike — follows the
      // retry rule and compares against the earlier Run of its own turn
      // (turn-actions D8).
      followUp: input.followUpAction != null,
    });

    const built = await this.rebuildContextForChat(
      tx,
      input,
      prompt.systemPrompt,
      continued,
    );

    const { freeze, told } = prompt.skillState;

    return {
      ...built.context,
      seenInstructionPaths: built.seenInstructionPaths,
      toldGit: built.toldGit,
      historyRows: built.historyRows,
      triggerParts: built.historyRows.find(
        (row) => row.id === input.userMessage.id,
      )?.parts,
      latestCheckpoint: prompt.checkpoint,
      effectiveContext,
      model: prompt.model,
      toolCatalog: catalog,
      stagedParts: staged.stagedParts,
      placement: staged.placement,
      removesModelSwitch: staged.removesModelSwitch,
      recencyDigestInitialization: prompt.recencyDigestInitialization,
      recencyDigestTold: staged.recencyDigestTold,
      // A started epoch always carries the told state its baseline sets.
      ...(freeze !== undefined &&
        told !== undefined && {
          // The decision hands back a readonly list; the column holds a
          // mutable array, so the value is copied rather than shared.
          skillCatalogFreeze: { ...freeze, told: [...told] },
        }),
      ...(staged.skillCatalogNoticeTold !== undefined && {
        skillCatalogNoticeTold: staged.skillCatalogNoticeTold,
      }),
      ...(staged.workspaceWrites !== undefined && {
        workspaceWrites: staged.workspaceWrites,
      }),
      untitled: prompt.chat.title === null,
    };
  }

  private async prepareBoundaryCompaction(input: {
    run: ExecuteRunInput;
    attemptId: string;
    context: PreparedAttemptContext;
    prepared: PreparedExecutionContext;
    effort: string | undefined;
    media: RunMediaResolver;
    workspaceRoot: WorkspaceRootCell;
    replyParts: ReadonlyArray<MessagePart>;
    keptPartCount: number;
    stepBudgetUsed: number;
    compactionSet: CompactionSet;
    automatic?: true;
    finalAnswer?: true;
    quotaRequest?: QuotaRequestState;
  }): Promise<DeliveryInput['boundaryCompaction']> {
    const activeRun = await this.tenantDb.runAs(input.run.userId, (tx) =>
      new RunsRepository(tx).findById(input.run.runId, input.run.userId),
    );

    if (activeRun?.activeAttemptId !== input.attemptId) return undefined;

    const compactionSet = input.compactionSet;

    if (compactionSet.ids.length === 0 && input.automatic !== true) {
      return undefined;
    }

    const rows = input.context.historyRows;

    const boundaryPlan = boundaryCompactionPlan(
      input.context,
      input.run.userMessage.seq,
    );

    const projected = projectStoredReplyParts(input.replyParts, {
      privateParts: true,
      mediaKey: (index) => continuedMediaKey(input.keptPartCount + index),
    });

    mergeRetainedMedia(input.media.retainedMedia, projected.retainedMedia);

    let summary: CompactionSummary | null = null;

    // A resumed boundary summary continues the prefix its suspended attempt
    // actually rendered: the immutable receipt that attempt stored for its own
    // system prompt. The wake rebuilds declarations from current
    // configuration, so the receipt is usable only when its system plus those
    // declarations are exactly the prefix the suspension fingerprinted;
    // otherwise the optional compaction failure path runs and no checkpoint is
    // published. A new target request after the boundary still uses this
    // attempt's own prepared context.
    let summarySystem = input.prepared.system;
    let summaryPrefixMatches = true;

    if (
      boundaryPlan !== null &&
      (input.quotaRequest?.resumeAt === 'boundary' ||
        input.quotaRequest?.resumeAt === 'finalAnswer')
    ) {
      const sourceAttemptId = input.quotaRequest.summaryAttemptId;

      const sourceReceipt =
        sourceAttemptId === undefined
          ? undefined
          : await this.tenantDb.runAs(input.run.userId, (tx) =>
              new SystemPromptReceiptsRepository(tx).findByAttempt(
                input.run.runId,
                sourceAttemptId,
                input.run.userId,
              ),
            );

      if (
        sourceReceipt !== undefined &&
        input.quotaRequest.summaryPrefixFingerprint ===
          compactionSummaryPrefixFingerprint({
            system: sourceReceipt.systemPrompt,
            toolDeclarations: input.prepared.toolDeclarations,
          })
      ) {
        summarySystem = sourceReceipt.systemPrompt;
      } else {
        summaryPrefixMatches = false;
      }
    }

    if (boundaryPlan !== null && summaryPrefixMatches) {
      try {
        summary = await this.compaction.computeBoundarySummary({
          chatId: input.run.chatId,
          userId: input.run.userId,
          plan: boundaryPlan,
          closedReply: [...input.prepared.messages, ...projected.messages],
          client: input.run.client,
          system: summarySystem,
          toolDeclarations: input.prepared.toolDeclarations,
          focus: compactionSet.focus,
          ...(input.effort !== undefined && { effort: input.effort }),
          reservedOutputTokens: this.instanceConfig.config.runs.maxOutputTokens,
          abortSignal: input.run.abortSignal,
          onRetry: (retry) =>
            this.recordModelRetry(
              { ...input.run, attemptId: input.attemptId },
              retry,
            ),
          media: input.media,
          quotaWait: {
            maxSeconds: this.instanceConfig.config.runs.quotaWaitMaxSeconds,
            request: input.quotaRequest,
          },
        });
      } catch (error) {
        const quotaWait = compactionQuotaWait(error, {
          maxSeconds: this.instanceConfig.config.runs.quotaWaitMaxSeconds,
          request: input.quotaRequest,
        });

        if (quotaWait !== undefined) throw quotaWait;
        summary = null;
      }
    }

    const { candidate: digestCandidate } = await this.resolveCompactionDigest({
      userId: input.run.userId,
      chatId: input.run.chatId,
    });

    const quote = await this.newestOwnerQuote(input.run, rows);

    return {
      ids: compactionSet.ids,
      summary,
      quote,
      stepBudgetUsed: input.stepBudgetUsed,
      ...(input.automatic === true && { automatic: true as const }),
      ...(input.finalAnswer === true && { finalAnswer: true as const }),
      publishCheckpoint: async (tx, reply) => {
        if (summary === null) {
          throw new Error('Cannot publish an empty boundary summary.');
        }

        return this.publishCheckpointInTransaction(tx, {
          run: input.run,
          attemptId: input.attemptId,
          summary: { ...summary, uptoSeq: reply.seq },
          focus: compactionSet.focus,
          model: input.context.model,
          workspaceRoot: input.workspaceRoot.current(),
          digestCandidate,
          quotaRequest: input.quotaRequest,
        });
      },
    };
  }

  private async prepareQuotaBoundary(
    input: Omit<
      Parameters<RunExecutionService['prepareBoundaryCompaction']>[0],
      'compactionSet'
    > & {
      compactionSet?: CompactionSet;
      resumeAt: AwaitingQuota['resumeAt'];
      quotaParts: () => Array<MessagePart>;
      quotaAssistantTurn?: () => AssistantTurnWrite;
      quotaStoppedCalls?: ReadonlyArray<StoppedCall>;
      /**
       * The first-epoch baselines this attempt's target request rendered. A
       * final-answer wait carries them to the terminal write the wake performs.
       */
      baselines?: FirstEpochBaselines;
      /** The cut a failed send leaves, when the step that parks owes one. */
      superseded?: SupersededModelOutput;
    },
  ): Promise<DeliveryInput['boundaryCompaction'] | 'quota'> {
    const compactionSet =
      input.compactionSet ??
      (await readCompactionSet({
        tenantDb: this.tenantDb,
        chatId: input.run.chatId,
        userId: input.run.userId,
      }));

    try {
      return await this.prepareBoundaryCompaction({ ...input, compactionSet });
    } catch (error) {
      if (input.run.abortSignal?.aborted) throw error;

      const quotaWait = compactionQuotaWait(error, {
        maxSeconds: this.instanceConfig.config.runs.quotaWaitMaxSeconds,
        request: input.quotaRequest,
      });

      if (quotaWait === undefined) throw error;

      await this.suspendCompactionForQuota({
        run: input.run,
        attemptId: input.attemptId,
        error: quotaWait,
        request: input.quotaRequest,
        resumeAt: input.resumeAt,
        parts: input.quotaParts(),
        stepBudgetUsed: input.stepBudgetUsed,
        ...(input.resumeAt === 'boundary' && {
          boundaryMode: input.automatic === true ? 'automatic' : 'owner',
        }),
        ...((input.resumeAt === 'boundary' ||
          input.resumeAt === 'finalAnswer') && {
          compactionSet,
          // The attempt that first suspended this summary owns the prefix the
          // resume must reuse; a re-wait carries that identity, never its own.
          summaryAttemptId:
            input.quotaRequest?.summaryAttemptId ?? input.attemptId,
          summaryPrefixFingerprint:
            input.quotaRequest?.summaryPrefixFingerprint ??
            compactionSummaryPrefixFingerprint(input.prepared),
          baselines:
            input.quotaRequest?.resumeAt === input.resumeAt
              ? input.quotaRequest.baselines
              : (input.baselines ?? {
                  recencyDigestInitialization:
                    input.context.recencyDigestInitialization,
                  skillCatalogFreeze: input.context.skillCatalogFreeze,
                }),
        }),
        ...(input.quotaAssistantTurn !== undefined && {
          assistantTurn: input.quotaAssistantTurn(),
        }),
        ...(input.quotaStoppedCalls !== undefined && {
          stoppedCalls: input.quotaStoppedCalls,
        }),
        ...(input.superseded !== undefined && {
          superseded: input.superseded,
        }),
      });

      return 'quota';
    }
  }

  private async prepareTerminalQuotaBoundary(
    input: Omit<
      Parameters<RunExecutionService['prepareQuotaBoundary']>[0],
      'resumeAt' | 'finalAnswer'
    > & {
      status: TerminalRunStatus;
      wakeCompaction: boolean;
    },
  ): Promise<
    | {
        status: TerminalRunStatus;
        boundaryCompaction?: DeliveryInput['boundaryCompaction'];
      }
    | 'quota'
  > {
    if (!completesBoundaryCompaction(input.status, input.wakeCompaction))
      return { status: input.status };

    const boundaryCompaction = await this.prepareQuotaBoundary({
      ...input,
      resumeAt: 'finalAnswer',
      finalAnswer: true,
    });

    if (boundaryCompaction === 'quota') return 'quota';

    if (input.run.abortSignal?.aborted)
      return { status: classifyAbortedRun(input.run.abortSignal) };

    return { status: input.status, boundaryCompaction };
  }

  private async deliverQuotaBoundary(
    input: DeliveryInput & { quotaRequest?: QuotaRequestState },
  ): Promise<BoundaryDelivery> {
    const { quotaRequest, ...delivery } = input;

    return retryRunTransaction(() =>
      this.tenantDb.runAs(input.run.userId, async (tx) => {
        const boundary = await deliverPendingSteering(tx, delivery);

        if (
          boundary.kind !== 'cancelled' &&
          boundary.kind !== 'fenced' &&
          (delivery.boundaryCompaction?.summary == null ||
            boundary.kind === 'nothing-pending')
        ) {
          await this.appendQuotaRecovered(tx, input.run.runId, quotaRequest);
        }

        return boundary;
      }),
    );
  }

  private async resumeQuotaBoundary(
    input: Parameters<RunExecutionService['prepareQuotaBoundary']>[0] & {
      telemetry: AssistantTurnTelemetry;
      createdMessage: RunUserMessage;
    },
  ): Promise<
    | BoundaryDelivery
    | (Extract<BoundaryDelivery, { kind: 'nothing-pending' }> & {
        automaticCompactionFailed: true;
      })
    | 'stopped'
  > {
    const pending = await readCompactionSet({
      tenantDb: this.tenantDb,
      chatId: input.run.chatId,
      userId: input.run.userId,
    });

    const saved = input.quotaRequest?.compactionSet;

    const compactionSet =
      saved === undefined
        ? pending
        : {
            ids: saved.ids.filter((id) => pending.ids.includes(id)),
            focus: saved.focus,
          };

    const finalAnswer = input.resumeAt === 'finalAnswer';

    // A queued or withdrawn /compact during the wait must not flip the mode
    // the suspended summary was requested in: its failure class belongs to the
    // original request. Only a checkpoint that recorded no mode falls back to
    // the legacy derivation from the set's current contents.
    const automaticMode = finalAnswer
      ? undefined
      : input.quotaRequest?.boundaryMode === undefined
        ? compactionSet.ids.length === 0
        : input.quotaRequest.boundaryMode === 'automatic';

    const parts = input.quotaParts();

    const kept = projectStoredReplyParts(parts, {
      privateParts: true,
      mediaKey: continuedMediaKey,
    });
    // This summary wake has not dispatched the items it just staged.

    const boundaryCompaction = await this.prepareQuotaBoundary({
      ...input,
      compactionSet,
      prepared: {
        ...input.prepared,
        messages: [
          ...requestMessages({ ...input.context, stagedParts: [] }, []),
          ...kept.messages,
        ],
      },
      ...(finalAnswer
        ? { finalAnswer: true as const }
        : automaticMode === true
          ? { automatic: true as const }
          : {}),
      ...(input.quotaRequest?.baselines !== undefined && {
        baselines: input.quotaRequest.baselines,
      }),
    });

    if (boundaryCompaction === 'quota') return 'stopped';

    if (finalAnswer)
      return this.finishQuotaFinalAnswer(input, boundaryCompaction, parts);

    const boundary = await this.deliverQuotaBoundary({
      run: { runId: input.run.runId, userId: input.run.userId },
      attemptId: input.attemptId,
      live: {
        chatId: input.run.chatId,
        inReplyTo: input.run.userMessage.id,
        parts,
        telemetry: input.telemetry,
      },
      modelCompleted: { finishReason: null, telemetry: input.telemetry },
      models: this.instanceConfig.config.models,
      deadWorkerAfterSeconds: workerDeadAfterSeconds(
        this.instanceConfig.config,
      ),
      boundaryCompaction,
      baselines: input.quotaRequest?.baselines,
      quotaRequest: input.quotaRequest,
      ...(input.quotaRequest?.stoppedCalls !== undefined && {
        stoppedCalls: input.quotaRequest.stoppedCalls,
      }),
    });

    return boundary.kind === 'nothing-pending' &&
      boundary.compactionFailed === true &&
      boundaryCompaction?.automatic === true
      ? { ...boundary, automaticCompactionFailed: true }
      : boundary;
  }

  private async finishQuotaFinalAnswer(
    input: Parameters<RunExecutionService['resumeQuotaBoundary']>[0],
    boundaryCompaction: DeliveryInput['boundaryCompaction'],
    parts: Array<MessagePart>,
  ): Promise<BoundaryDelivery | 'stopped'> {
    // The terminal write freezes the baselines the answering target rendered.
    const { recencyDigestInitialization, skillCatalogFreeze } =
      input.quotaRequest?.baselines ?? {};

    const finish = await this.finishRun({
      userId: input.run.userId,
      runId: input.run.runId,
      attemptId: input.attemptId,
      status: 'completed',
      boundaryCompaction,
      quotaRequest: input.quotaRequest,
      stepBudgetUsed: input.stepBudgetUsed,
      modelCompleted: { finishReason: null, telemetry: input.telemetry },
      assistantTurn: {
        chatId: input.run.chatId,
        inReplyTo: input.run.userMessage.id,
        parts,
        telemetry: input.telemetry,
      },
      ...(recencyDigestInitialization !== undefined && {
        recencyDigestInitialization,
      }),
      ...(skillCatalogFreeze !== undefined && { skillCatalogFreeze }),
    });

    if (finish.outcome === 'delivered') return finish.delivery;

    if (!hasNoCommittedAssistantTurn(finish)) {
      await this.afterAssistantTurn(finish.assistantMessage, input.run.userId);
      await this.postCompletedRunWork({
        chatId: input.run.chatId,
        userId: input.run.userId,
        untitled: input.prepared.untitled,
        userMessage: input.createdMessage,
      });
    }

    if (finish.outcome === 'errored')
      throw new Error('Failed to finish resumed quota reply.');

    return 'stopped';
  }

  private async finishWakeCompactionBoundary(input: {
    boundary: BoundaryDelivery | undefined;
    userId: string;
    runId: string;
    attemptId: string;
    startDelivered: (delivery: DeliveredBoundary) => Promise<AttemptRun>;
  }): Promise<AttemptRun | undefined> {
    if (input.boundary?.kind === 'delivered') {
      await this.afterAssistantTurn(input.boundary.closedReply, input.userId);

      return input.startDelivered(input.boundary);
    }

    if (
      input.boundary !== undefined &&
      input.boundary.kind !== 'nothing-pending'
    ) {
      if (input.boundary.kind === 'cancelled') {
        await this.settleTerminalRun({
          userId: input.userId,
          runId: input.runId,
          status: 'cancelled',
          attemptId: input.attemptId,
          runPayload: { status: 'cancelled' },
        });
      }

      throw new RunNotRunnableError(input.runId);
    }

    return undefined;
  }
  private applyCompactionFailure(input: {
    failure: 'automatic' | 'manual' | undefined;
    assistantPartCollector: ReturnType<typeof createAssistantPartCollector>;
    disableAutomaticCompaction: () => void;
  }): void {
    if (input.failure === 'automatic') {
      input.disableAutomaticCompaction();
    } else if (input.failure === 'manual') {
      input.assistantPartCollector.compactionNote({
        type: 'data-compaction-failed',
        data: {},
      });
    }
  }

  private async resumeQuotaAttempt(
    input: Parameters<RunExecutionService['resumeQuotaBoundary']>[0] & {
      userId: string;
      runId: string;
      startDelivered: (delivery: DeliveredBoundary) => Promise<AttemptRun>;
    },
  ): Promise<QuotaResumeAttemptResult> {
    const resumed = await this.resumeQuotaBoundary(input);

    if (resumed === 'stopped') throw new RunNotRunnableError(input.runId);

    const delivered = await this.finishWakeCompactionBoundary({
      boundary: resumed,
      userId: input.userId,
      runId: input.runId,
      attemptId: input.attemptId,
      startDelivered: input.startDelivered,
    });

    if (delivered !== undefined)
      return { kind: 'delivered', attempt: delivered };

    if (resumed.kind !== 'nothing-pending')
      throw new RunNotRunnableError(input.runId);

    const compactionFailure = resumed.compactionFailed
      ? 'automaticCompactionFailed' in resumed &&
        resumed.automaticCompactionFailed
        ? 'automatic'
        : 'manual'
      : undefined;

    return { kind: 'continue', compactionFailure };
  }

  private deliveredWakeAttempt(
    wakeAttempt: AttemptRun | 'compact' | undefined,
  ): AttemptRun | undefined {
    if (wakeAttempt === undefined || wakeAttempt === 'compact')
      return undefined;

    return wakeAttempt;
  }

  private async prepareWakeAttempt(input: {
    run: ExecuteRunInput;
    attemptId: string;
    wakeState: ContinueState | undefined;
    quotaRequest?: QuotaRequestState;
    startDelivered: (delivery: DeliveredBoundary) => Promise<AttemptRun>;
    onCompactionSet: (
      set: Awaited<ReturnType<typeof readCompactionSet>>,
    ) => void;
  }): Promise<AttemptRun | 'compact' | undefined> {
    if (
      input.wakeState === undefined ||
      (input.quotaRequest !== undefined &&
        input.quotaRequest.resumeAt !== 'preDispatch')
    )
      return undefined;

    const compactionSet = await readCompactionSet({
      tenantDb: this.tenantDb,
      chatId: input.run.chatId,
      userId: input.run.userId,
    });

    input.onCompactionSet(compactionSet);

    if (input.quotaRequest?.resumeAt === 'preDispatch') {
      const segment = await this.tenantDb.runAs(input.run.userId, (tx) =>
        currentSegmentState(tx, input.run.runId, input.run.userId),
      );

      if (!segment.dispatched) return undefined;
    }

    if (compactionSet.ids.length > 0) return 'compact';

    const boundary = await retryRunTransaction(() =>
      this.tenantDb.runAs(input.run.userId, (tx) =>
        deliverPendingSteering(tx, {
          run: { runId: input.run.runId, userId: input.run.userId },
          attemptId: input.attemptId,
          models: this.instanceConfig.config.models,
          deadWorkerAfterSeconds: workerDeadAfterSeconds(
            this.instanceConfig.config,
          ),
        }),
      ),
    );

    return this.finishWakeCompactionBoundary({
      boundary,
      userId: input.run.userId,
      runId: input.run.runId,
      attemptId: input.attemptId,
      startDelivered: input.startDelivered,
    });
  }

  private async deliverWakeCompaction(input: {
    run: ExecuteRunInput;
    attemptId: string;
    prepared: PreparedExecutionContext;
    context: PreparedAttemptContext;
    effort: string | undefined;
    media: RunMediaResolver;
    workspaceRoot: WorkspaceRootCell;
    compactionSet: Awaited<ReturnType<typeof readCompactionSet>> | undefined;
    keptPartCount: number;
    wakeCompaction: boolean;
    stepBudgetUsed: number;
    quotaRequest?: QuotaRequestState;
    quotaParts: () => Array<MessagePart>;
  }): Promise<BoundaryDelivery | undefined> {
    if (!input.wakeCompaction) return undefined;

    const compactionSet = input.compactionSet;

    if (compactionSet === undefined || compactionSet.ids.length === 0) {
      return this.deliverQuotaBoundary({
        run: { runId: input.run.runId, userId: input.run.userId },
        attemptId: input.attemptId,
        models: this.instanceConfig.config.models,
        deadWorkerAfterSeconds: workerDeadAfterSeconds(
          this.instanceConfig.config,
        ),
        quotaRequest: input.quotaRequest,
      });
    }

    const boundaryCompaction = await this.prepareQuotaBoundary({
      resumeAt: 'preDispatch',
      quotaParts: input.quotaParts,
      quotaRequest: input.quotaRequest,
      run: input.run,
      attemptId: input.attemptId,
      context: input.context,
      prepared: input.prepared,
      effort: input.effort,
      media: input.media,
      workspaceRoot: input.workspaceRoot,
      replyParts: [],
      keptPartCount: input.keptPartCount,
      stepBudgetUsed: input.stepBudgetUsed,
      compactionSet,
    });

    if (boundaryCompaction === 'quota')
      throw new RunNotRunnableError(input.run.runId);

    return this.deliverQuotaBoundary({
      run: { runId: input.run.runId, userId: input.run.userId },
      attemptId: input.attemptId,
      models: this.instanceConfig.config.models,
      deadWorkerAfterSeconds: workerDeadAfterSeconds(
        this.instanceConfig.config,
      ),
      boundaryCompaction,
      quotaRequest: input.quotaRequest,
    });
  }

  private async prepareQuotaFirstStep(
    input: Omit<
      Parameters<RunExecutionService['prepareAttemptForFirstStep']>[0],
      'firstSegment'
    > & {
      firstSegment: boolean;
      quotaRequest?: QuotaRequestState;
      stepBudgetUsed: number;
    },
  ): Promise<{
    firstStep: PreparedFirstStep;
    quotaRequest?: QuotaRequestState;
  }> {
    let quotaRequest = input.quotaRequest;

    try {
      const firstStep = await this.prepareAttemptForFirstStep({
        ...input,
        firstSegment:
          startsAutomaticCompaction(input.firstSegment, input.wakeCompaction) &&
          (quotaRequest === undefined ||
            quotaRequest.resumeAt === 'preDispatch'),
        quotaRequest: input.wakeCompaction ? undefined : quotaRequest,
      });

      if (!input.wakeCompaction && quotaRequest?.resumeAt === 'preDispatch')
        quotaRequest = undefined;

      return { firstStep, quotaRequest };
    } catch (error) {
      await this.settleIfAborted(input.run, input.attemptId);

      const quotaWait = compactionQuotaWait(error, {
        maxSeconds: this.instanceConfig.config.runs.quotaWaitMaxSeconds,
        request: quotaRequest,
      });

      if (quotaWait !== undefined) {
        await this.suspendCompactionForQuota({
          run: input.run,
          attemptId: input.attemptId,
          error: quotaWait,
          request: quotaRequest,
          resumeAt: 'preDispatch',
          parts: input.continued?.parts.slice() ?? [],
          stepBudgetUsed: input.stepBudgetUsed,
        });
        throw new RunNotRunnableError(input.run.runId);
      }

      if (error instanceof ModelContextExecutionError) {
        const message = error.message;
        await this.finishRunWithoutCollector({
          userId: input.run.userId,
          runId: input.run.runId,
          status: 'failed',
          attemptId: input.attemptId,
          runPayload: { status: 'failed', message, code: error.code },
          error: { message, code: error.code },
        });
      }

      throw error;
    }
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
    /** The attempt's owner-scoped media resolver (vision-media D6). */
    media: RunMediaResolver;
    /** The kept parts of a Continue Run, and the step of each kept call. */
    continued: ContinueState | undefined;
    /** The attempt's one git observation; absent for an unbound Chat. */
    gitObservation: Promise<GitObservation> | undefined;
    /** False for a segment a delivery started. */
    firstSegment: boolean;
    /** A requested wake compaction gets to attempt before window admission. */
    wakeCompaction: boolean;
    quotaRequest?: QuotaRequestState;
  }): Promise<PreparedFirstStep> {
    // One projection for the whole attempt: both passes and the compaction
    // trigger measure and send the same kept messages. The kept parts are the
    // same Turn, so only the model check of `reasoning-output` applies (D7) —
    // admission runs the Continue Run on the source Run's model.
    const kept =
      input.continued === undefined
        ? { messages: [], retainedMedia: new Map<string, RetainedMedia>() }
        : projectStoredReplyParts(input.continued.parts, {
            privateParts: true,
            mediaKey: continuedMediaKey,
          });

    const estimatePass = await this.prepareAttemptContext(
      input.run,
      input.attemptId,
      input.workspacePreparation.chat,
      input.workspacePreparation.root,
      input.workspaceMcpKey,
      false,
      input.workspacePreparation.machine,
      input.continued,
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

    const turnGit: TurnGit = {
      observation: await input.gitObservation,
      part: undefined,
      toldText: undefined,
    };

    refreshTurnGit({
      turn: turnGit,
      stagedParts: estimatePass.stagedParts,
      history: estimatePass.toldGit,
      runId: input.run.runId,
    });
    // Every retained entry this request's markers name, from the rows the
    // build read and from the kept parts it sends after them.
    mergeRetainedMedia(input.media.retainedMedia, estimatePass.retainedMedia);
    mergeRetainedMedia(input.media.retainedMedia, kept.retainedMedia);

    const estimated = await this.assembleAttemptRequest(
      estimatePass,
      input.dynamicResolver,
      kept.messages,
    );

    // The same admission the step composer will make on this request, so the
    // trigger sees the not-attached result the request will carry.
    // Compaction plans only before the Run's first model step: a segment start,
    // and a retry inside a later segment, send the history as it stands
    // (run-steering D3).
    const trigger = input.firstSegment
      ? await this.evaluateCompactionTrigger({
          run: input.run,
          prepared: estimated,
          stagedParts: estimatePass.stagedParts,
          historyRows: estimatePass.historyRows,
          keptMessages: kept.messages,
          keptRefCount: collectMediaRefs(kept.messages).length,
          boundarySeq: estimatePass.latestCheckpoint?.absorbedThroughSeq ?? 0,
          media:
            input.media &&
            (await loadMediaSizing(
              estimated.messages,
              input.media,
              this.mediaAdmissionContext(input.run.client),
            )),
        })
      : undefined;

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
                  media: input.media,
                  onRetry: (retry) =>
                    this.recordModelRetry(
                      { ...input.run, attemptId: input.attemptId },
                      retry,
                    ),
                  // The window variant may summarize through the source Run's
                  // model instead; only this exact entry carries the current
                  // Run's quota policy.
                  quotaWait: {
                    maxSeconds:
                      this.instanceConfig.config.runs.quotaWaitMaxSeconds,
                    request: input.quotaRequest,
                    modelId: input.run.client.model,
                  },
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
                  system: estimated.system,
                  toolDeclarations: estimated.toolDeclarations,
                  ...(input.effort !== undefined && { effort: input.effort }),
                  reservedOutputTokens:
                    this.instanceConfig.config.runs.maxOutputTokens,
                  abortSignal: input.run.abortSignal,
                  onRetry: (retry) =>
                    this.recordModelRetry(
                      { ...input.run, attemptId: input.attemptId },
                      retry,
                    ),
                  media: input.media,
                  quotaWait: {
                    maxSeconds:
                      this.instanceConfig.config.runs.quotaWaitMaxSeconds,
                    request: input.quotaRequest,
                  },
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
        quotaRequest: input.quotaRequest,
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
        input.workspacePreparation.machine,
        input.continued,
      );
      // The published history decides the accepted-turn bundle: the item the
      // estimate pass staged can no longer be what made its files seen.
      await this.refreshTurnInstructions(
        turnInstructions,
        context.stagedParts,
        input.run,
        context.seenInstructionPaths,
      );
      // A checkpoint starts a new epoch: the same observation is compared with
      // what the published history told, and no second git read runs.
      refreshTurnGit({
        turn: turnGit,
        stagedParts: context.stagedParts,
        history: context.toldGit,
        runId: input.run.runId,
      });
      // The re-baked epoch begins at the checkpoint, so its rows carry their
      // own entries; the ones the absorbed rows named are unreferenced now.
      mergeRetainedMedia(input.media.retainedMedia, context.retainedMedia);
      mergeRetainedMedia(input.media.retainedMedia, kept.retainedMedia);
      request = await this.assembleAttemptRequest(
        context,
        input.dynamicResolver,
        kept.messages,
      );
    } else {
      await this.tenantDb.runAs(input.run.userId, async (tx) => {
        await this.persistAttemptPromptReceipt(
          tx,
          input.run,
          input.attemptId,
          context.effectiveContext,
        );

        if (input.quotaRequest?.resumeAt === 'preDispatch') {
          await this.appendQuotaRecovered(
            tx,
            input.run.runId,
            input.quotaRequest,
          );
        }
      });
    }

    if (
      input.quotaRequest?.resumeAt !== 'finalAnswer' &&
      !requestFitsContextWindow({
        system: request.system,
        messages: request.messages,
        toolDeclarations: request.toolDeclarations,
        contextWindowTokens: input.run.client.contextWindowTokens,
        reservedOutputTokens: this.instanceConfig.config.runs.maxOutputTokens,
        media:
          input.media &&
          (await loadMediaSizing(
            request.messages,
            input.media,
            this.mediaAdmissionContext(input.run.client),
          )),
      })
    ) {
      throw new ContextIncompatibleError(
        'The complete request still exceeds the target model context window after one compaction.',
      );
    }

    return {
      request,
      context,
      turnInstructions,
      turnGit,
      preStepCompactionStarted: summary !== undefined && summary !== null,
    };
  }

  /**
   * The dispatchable request for one pass: the triggering message carries its
   * stored parts with the staged items placed as the dispatch transaction will
   * store them, so items an earlier attempt stored replay once, in place. A
   * Continue Run then carries the kept steps, so the trigger's own position
   * comes from the history rows rather than from "the last message"
   * (turn-actions D6).
   */
  private async assembleAttemptRequest(
    context: PreparedAttemptContext,
    dynamicResolver: DynamicToolExecutorResolver | undefined,
    keptMessages: ReadonlyArray<ModelRequestContext['messages'][number]>,
  ): Promise<PreparedExecutionContext> {
    return {
      system: context.system,
      messages: requestMessages(context, keptMessages),
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
    };
  }

  /** Publish a checkpoint and its epoch state in one transaction before dispatch. */
  private async publishPreStepCompaction(input: {
    run: ExecuteRunInput;
    attemptId: string;
    summary: CompactionSummary;
    model: SystemModelCatalogEntry;
    workspaceRoot: string | undefined;
    quotaRequest?: QuotaRequestState;
  }): Promise<void> {
    const { candidate: digestCandidate } = await this.resolveCompactionDigest({
      userId: input.run.userId,
      chatId: input.run.chatId,
    });

    await this.tenantDb.runAs(input.run.userId, (tx) =>
      this.publishCheckpointInTransaction(tx, { ...input, digestCandidate }),
    );
  }

  private async publishCheckpointInTransaction(
    tx: Db,
    input: {
      run: ExecuteRunInput;
      attemptId: string;
      summary: CompactionSummary;
      focus?: string | null;
      model: SystemModelCatalogEntry;
      workspaceRoot: string | undefined;
      digestCandidate: RecencyDigestResolution | null;
      quotaRequest?: QuotaRequestState;
    },
  ): Promise<string> {
    // Keep the write fence first: delivery takes the Run lock before the Chat
    // lock, so reversing this order can deadlock against a concurrent delivery.
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

    await this.appendQuotaRecovered(tx, input.run.runId, input.quotaRequest);

    const messagesRepo = new MessagesRepository(tx);
    const chatsRepo = new ChatsRepository(tx);
    const chat = await chatsRepo.touch(input.run.chatId, input.run.userId);

    // The digest binding follows the Chat lock to preserve the chats-before-memory order.
    const shareRecentChats = await this.memory.getForOwnerForBinding(
      tx,
      input.run.userId,
    );

    // This boundary read decides which publisher won the same-boundary race.
    const existing = await messagesRepo.findCheckpointByBoundary(
      input.run.chatId,
      input.run.userId,
      input.summary.uptoSeq,
    );

    if (existing !== undefined) return existing.id;

    const checkpoint = await messagesRepo.createCheckpoint({
      chatId: input.run.chatId,
      absorbedThroughSeq: input.summary.uptoSeq,
      part: createCompactionCheckpointPart(
        input.summary.summary,
        input.focus ?? null,
      ),
      usage: input.summary.usage,
    });

    await this.rebakeCheckpointEpoch({
      tx,
      run: input.run,
      chat,
      checkpointId: checkpoint.id,
      model: input.model,
      workspaceRoot: input.workspaceRoot,
      shareRecentChats,
      digestCandidate: input.digestCandidate,
    });

    return checkpoint.id;
  }

  /** Re-bake digest, skill, and workspace epoch state for a new checkpoint. */
  private async rebakeCheckpointEpoch(input: {
    tx: Db;
    run: ExecuteRunInput;
    chat: Chat | undefined;
    checkpointId: string;
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
            latestCheckpointId: input.checkpointId,
          });

    await this.rebakeCheckpointDigest({
      tx: input.tx,
      chatId: input.run.chatId,
      userId: input.run.userId,
      chat: input.chat,
      checkpointId: input.checkpointId,
      shareRecentChats: input.shareRecentChats,
      candidate: input.digestCandidate,
    });

    if (skillState?.freeze !== undefined) {
      await chatsRepo.setSkillCatalogBaseline({
        chatId: input.run.chatId,
        ownerUserId: input.run.userId,
        baseline: skillState.freeze.baseline,
        rebakedFrom: input.checkpointId,
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
      await this.resetWorkspaceCheckpointEpoch({
        tx: input.tx,
        chatId: input.run.chatId,
        userId: input.run.userId,
        checkpointId: input.checkpointId,
      });
    }
  }

  private async rebakeCheckpointDigest(input: {
    tx: Db;
    chatId: string;
    userId: string;
    chat: Chat | undefined;
    checkpointId: string;
    shareRecentChats: ResolvedMemorySettings;
    candidate: RecencyDigestResolution | null;
  }): Promise<void> {
    if (
      input.chat?.recencyDigestBaseline == null ||
      input.candidate === null ||
      !input.shareRecentChats.shareRecentChats
    ) {
      return;
    }

    await new ChatsRepository(input.tx).setRecencyDigest({
      chatId: input.chatId,
      ownerUserId: input.userId,
      baseline: input.candidate.baseline,
      told: [],
      rebakedFrom: input.checkpointId,
    });
  }

  private async resetWorkspaceCheckpointEpoch(input: {
    tx: Db;
    chatId: string;
    userId: string;
    checkpointId: string;
  }): Promise<void> {
    await new WorkspaceBindingRepository(input.tx).setTold({
      chatId: input.chatId,
      ownerUserId: input.userId,
      told: null,
      toldFrom: input.checkpointId,
      clearDetachReason: false,
    });
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
    const checkpoint = await new MessagesRepository(tx).findActiveCheckpoint(
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
      checkpoint?.createdAt ?? chat.createdAt,
      instanceTimezone,
    );

    const skillState = this.resolveSkillTurnState({
      run: input,
      chat,
      model,
      workspaceRoot,
      latestCheckpointId: checkpoint?.id ?? null,
    });

    return {
      ...digest,
      chat,
      model,
      user,
      checkpoint,
      instanceTimezone,
      anchor,
      skillState,
    };
  }

  /**
   * The skill catalog one attempt reads through: the operator catalog for a
   * local (or unbound) Workspace root, and the Machine Workspace snapshot this
   * attempt's preparation took for a Machine root, so a Machine package is
   * discovered and read on the Machine. A Machine root this process never
   * snapshotted (a code path that skipped preparation) falls back to the
   * operator catalog, whose Machine extra sources are simply unreadable and
   * contribute nothing — a Machine path is never read from the hub's own
   * filesystem.
   */
  private skillCatalogFor(root: string | undefined): SkillCatalogPort {
    if (root === undefined) return this.skillCatalog;

    return this.machineSkillCatalogs.get(root) ?? this.skillCatalog;
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
    latestCheckpointId: string | null;
  }): SkillTurnState {
    return resolveTurnSkillState(
      {
        skillCatalog: this.skillCatalogFor(input.workspaceRoot),
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
        latestCheckpointId: input.latestCheckpointId,
        modelReferencesSkills: input.model.referencesSkills,
      },
    );
  }

  private async resolveAttemptDigest(input: {
    tx: Db;
    input: ExecuteRunInput;
    chatsRepo: ChatsRepository;
    chat: Chat;
  }): Promise<AttemptDigestInputs> {
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

    return {
      shareRecentChats,
      // An initializing attempt renders its own candidate; every later one
      // renders the stored baseline.
      promptDigestBaseline:
        input.chat.recencyDigestBaseline ?? digestCandidate?.baseline ?? null,
      digestCandidate,
    };
  }

  /**
   * The digest state this attempt's renders establish. The told-set records
   * only chats the model actually received, so it is derived from the baseline
   * entries either prompt surface emitted rather than from the baseline that
   * was resolved: a template that omits the digest leaves every entry untold,
   * to enter through an append.
   */
  private async accountAttemptDigestDisclosure(input: {
    tx: Db;
    input: ExecuteRunInput;
    prompt: AttemptPromptInputs;
    disclosures: ReadonlyArray<PromptChatsDisclosure>;
  }): Promise<AttemptDigestDisclosure> {
    const { chat, digestCandidate, promptDigestBaseline } = input.prompt;

    if (digestCandidate === undefined || promptDigestBaseline === null) {
      return { digestDelta: null };
    }

    const disclosed = disclosedRecencyDigestEntries({
      baseline: promptDigestBaseline,
      disclosures: input.disclosures,
      candidates: digestCandidate.candidates,
    });

    if (chat.recencyDigestBaseline === null) {
      return {
        recencyDigestInitialization: {
          baseline: digestCandidate.baseline,
          told: disclosed,
        },
        digestDelta: null,
      };
    }

    if (chat.recencyDigestTold === null) {
      return { digestDelta: null };
    }

    // Prior told state wins over this render: a later append may have told
    // the model a pin change the immutable baseline still contradicts.
    const toldChatIds = new Set(
      chat.recencyDigestTold.map(({ chatId }) => chatId),
    );

    const told = [
      ...chat.recencyDigestTold,
      ...disclosed.filter(({ chatId }) => !toldChatIds.has(chatId)),
    ];

    return {
      digestDelta: deriveRecencyDigestDelta({
        candidate: digestCandidate,
        told,
        pinnedChatIds: await new ChatsRepository(input.tx).findPinnedChatIds(
          input.input.userId,
          told.map(({ chatId }) => chatId),
        ),
      }),
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
  }): RenderedPrompt {
    const renderInput: SystemPromptRenderInput = {
      model: input.model,
      anchor: input.anchor,
      user: input.user,
      chats: input.chats ?? undefined,
      ...(input.skills !== undefined && { skills: input.skills }),
      webSearch: this.webSearch,
      admittedToolIds: input.admittedToolIds,
    };

    let rendered: RenderedPrompt;

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

    if (rendered.text.trim().length === 0) {
      throw new ModelContextExecutionError('System prompt rendered empty.');
    }

    return rendered;
  }

  /**
   * Composes the attempt's catalog; `disclosures` receives each admitted
   * description's digest disclosure, private to the told-set accounting.
   */
  private async composeAttemptCatalog(
    tx: Db,
    input: ExecuteRunInput,
    prompt: AttemptPromptInputs,
    workspaceMcpKey: WorkspaceMcpKey | undefined,
    disclosures: Array<PromptChatsDisclosure>,
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

        const rendered = this.toolPromptRenderer.render({
          toolId: id,
          model: prompt.model,
          anchor: prompt.anchor,
          user: prompt.user,
          chats: prompt.promptDigestBaseline ?? undefined,
          admittedToolIds,
        });

        disclosures.push(rendered.chatsDisclosure);

        return rendered.text;
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
    afterPublication: boolean;
    /** The bound Machine Workspace's availability as this attempt decided it. */
    machine: MachineWorkspaceState | undefined;
    /** Whether this Run follows up an earlier Run of the same turn. */
    followUp: boolean;
  }): Promise<AttemptStagedContext> {
    const baseline = await this.resolveDisclosureBaseline(
      input.tx,
      input.input,
      input.prompt,
      input.followUp,
    );

    // The model switch, the digest supersession marker and the temporal anchor
    // are authored once per accepted turn, by the Run's first dispatch: an
    // earlier dispatch already stored them on the trigger. A follow-up Run
    // counts an earlier Run of its own message as such a dispatch, so the turn
    // keeps one temporal item and keeps the model-switch item it stored
    // (turn-actions D8). A checkpoint this attempt published re-bakes the
    // digest after that dispatch, so its marker is still untold.
    const priorDispatch =
      baseline.ownAvailability !== null || baseline.priorTurnDispatched;

    // The model-switch item is the one exception to the keep rule: it names the
    // model of an earlier Run, so the first dispatch of a Regenerate Run
    // compares again and replaces it (turn-actions D8).
    const regenerateFirstDispatch =
      input.input.followUpAction === 'regenerate' &&
      baseline.ownAvailability === null;

    const stagedParts: Array<MessagePart> = [];

    // A delivered interrupt leads its message with the notice, authored by the
    // segment's first dispatch (run-steering D7).
    if (baseline.ownAvailability === null) {
      const interrupted = await this.deliveredInterrupt(input.tx, input.input);

      if (interrupted !== undefined) stagedParts.push(interrupted);
    }

    // A boundary-delivered job notice is authored at the trigger's first
    // dispatch so its output is present in both the measured and sent request.
    if (baseline.ownAvailability === null) {
      stagedParts.push(
        ...(await createJobNoticeContext({
          tx: input.tx,
          chatId: input.input.chatId,
          ownerUserId: input.input.userId,
          messageId: input.input.userMessage.id,
          runId: input.input.runId,
        })),
      );
    }

    if (!priorDispatch || regenerateFirstDispatch) {
      const modelChange = this.deriveModelChangeItem(
        baseline,
        input.input,
        input.prompt,
      );

      if (modelChange !== undefined) stagedParts.push(modelChange);
    }

    // The notice a Regenerate owes the turn follows the switch that names the
    // model making the new attempt. Admission decided once per turn and recorded
    // the answer in `run.created`, so every attempt reads the same value; its
    // own first dispatch stores it, so a retry keeps the stored copy
    // (turn-actions D9).
    const owesNotice =
      regenerateFirstDispatch &&
      (await readCreatedFlags(input.tx, input.input.runId, input.input.userId))
        .notice;

    if (owesNotice) {
      stagedParts.push(
        createRegenerateNoticeItem({ runId: input.input.runId }),
      );
    }

    const availability = deriveAttemptAvailabilityItem({
      runId: input.input.runId,
      baseline,
      manifest: input.effectiveContext.availabilityManifest,
      afterPublication: input.afterPublication,
    });

    if (availability !== undefined) stagedParts.push(availability);

    const workspaceContext = this.deriveWorkspaceContext({
      runId: input.input.runId,
      chat: input.prompt.chat,
      latestCheckpointId: input.prompt.checkpoint?.id ?? null,
      machine: input.machine,
    });

    stagedParts.push(...workspaceContext.parts);
    const workspaceWrites = workspaceContext.writes;
    // Workspace items are rail-only and precede the skill catalog notice.
    // Their text never enters the system prompt.
    const skillNotice = input.prompt.skillState.notice;

    if (skillNotice !== undefined) {
      stagedParts.push(skillNotice.item);
    }

    stagedParts.push(
      ...deriveRecencyDigestItems({
        baseline,
        runId: input.input.runId,
        prompt: input.prompt,
        markerUntold: !priorDispatch || input.afterPublication,
      }),
    );

    if (!priorDispatch) {
      stagedParts.push(
        createTemporalItem({
          runId: input.input.runId,
          instant: new Date(),
          timeZone: input.prompt.instanceTimezone,
        }),
      );
    }

    return {
      stagedParts,
      placement: priorDispatch ? 'append' : 'rank',
      removesModelSwitch: regenerateFirstDispatch,
      recencyDigestTold: input.prompt.digestDelta?.told,
      ...(workspaceWrites !== undefined && { workspaceWrites }),
      ...(skillNotice !== undefined && {
        // The decision hands back a readonly list; the column holds a mutable
        // array, so the value is copied rather than shared.
        skillCatalogNoticeTold: [...skillNotice.told],
      }),
    };
  }

  private async resolveDisclosureBaseline(
    tx: Db,
    run: ExecuteRunInput,
    prompt: AttemptPromptContext,
    followUp: boolean,
  ): Promise<DisclosureBaseline> {
    const runsRepo = new RunsRepository(tx);
    // A segment dispatches once: the Run's availability record names the
    // latest segment that did, so only a request after the latest delivery
    // makes this attempt a retry (run-steering D3).
    const segment = await currentSegmentState(tx, run.runId, run.userId);

    // An earlier attempt of this segment dispatched when its dispatch
    // transaction wrote the Run's availability record (`[]` included). Its
    // items stay on the trigger and its told state has advanced, so this
    // attempt derives only what they do not already tell and appends it
    // (design D2).
    const ownAvailability = segment.dispatched
      ? ((await runsRepo.findById(run.runId, run.userId))
          ?.turnToolAvailability ?? null)
      : null;

    // Model selection is established by any reply, failed and checkpointed
    // ones included (design D5): a failed reply's switch item was stored at its
    // dispatch, and a checkpoint can absorb every earlier reply.
    const previousReplyModelId = await new MessagesRepository(
      tx,
    ).findLatestReplyModelIdBefore(run.chatId, run.userId, run.userMessage.seq);

    // The baseline is the most recent *dispatched* turn (design D11): a run
    // whose dispatch stored its items has told the model what they say, even
    // if it later failed, while a run that ended before any request told it
    // nothing and must not mask the state the turns before it established.
    // A follow-up Run can be the second Run of its own turn, so its baseline
    // is the most recent dispatched Run of that turn itself when there is one
    // (turn-actions D8); every other Run compares with the turns before it.
    // A delivery moved the Run onto this message, so the Run's own earlier
    // segment is the most recent dispatched turn, and only its replies reach
    // it (run-steering D3).
    const earlierSegment = segment.delivered
      ? await findEarlierSegmentBaseline(tx, {
          chatId: run.chatId,
          userId: run.userId,
          runId: run.runId,
          beforeSeq: run.userMessage.seq,
        })
      : undefined;

    const previousDispatched = followUp
      ? await runsRepo.findDispatchedBaselineForTurn(run.chatId, run.userId, {
          messageId: run.userMessage.id,
          beforeSeq: run.userMessage.seq,
        })
      : (earlierSegment ??
        (await runsRepo.findMostRecentDispatchedByChatMessageSequence(
          run.chatId,
          run.userId,
          { beforeSeq: run.userMessage.seq },
        )));

    // The follow-up lookup reaches this message's own earlier Run, so its
    // result already answers whether an earlier attempt of the turn told the
    // model what its items say.
    const priorTurnDispatched =
      followUp && previousDispatched?.run.messageId === run.userMessage.id;

    // Every newly active compaction checkpoint starts a new disclosure epoch,
    // judged against that same dispatched-turn baseline by sequence rather
    // than by time: a checkpoint published inside this Run's own attempt has a
    // later createdAt but a boundary above its predecessor's turn, and a
    // retried assistant row keeps its sequence (design D7).
    const startsEpoch =
      previousDispatched === undefined ||
      (prompt.checkpoint !== undefined &&
        prompt.checkpoint.absorbedThroughSeq >=
          previousDispatched.triggeringUserSeq);

    return {
      ownAvailability,
      previousReplyModelId,
      previousDispatched,
      priorTurnDispatched,
      startsEpoch,
    };
  }

  /**
   * The switch item compares this attempt's model with the latest prior
   * reply's recorded model, not the dispatched baseline the availability and
   * epoch comparison uses (design D5).
   */
  private deriveModelChangeItem(
    baseline: DisclosureBaseline,
    run: ExecuteRunInput,
    prompt: AttemptPromptContext,
  ): MessagePart | undefined {
    const { previousReplyModelId } = baseline;

    // Compared with the catalog id the item names as the new model, so a
    // notice is authored only when the two ids it states actually differ.
    if (
      previousReplyModelId === undefined ||
      previousReplyModelId === prompt.model.id
    ) {
      return undefined;
    }

    // The reply records the selected id alone, and the body names the model
    // that id belonged to, so it is resolved against the operator catalog this
    // service already reads at construction. A model the catalog no longer
    // carries is named by its bare id.
    const previousModel = this.instanceConfig.config.models.find(
      (model) => model.id === previousReplyModelId,
    );

    return createModelChangeItem({
      oldModel: previousModel ?? { id: previousReplyModelId },
      newModel: prompt.model,
      runId: run.runId,
    });
  }
  private deriveWorkspaceContext(input: {
    runId: string;
    chat: Chat;
    latestCheckpointId: string | null;
    /** The bound Machine Workspace's availability as this attempt decided it. */
    machine: MachineWorkspaceState | undefined;
  }): WorkspaceStagedContext {
    const currentRoot = input.chat.workspaceRoot;
    const latestCheckpointId = input.latestCheckpointId;

    const toldRoot =
      input.chat.workspaceToldFrom === latestCheckpointId
        ? input.chat.workspaceTold
        : null;

    const rawDetachReason = input.chat.workspaceDetachReason;

    const detachReason =
      rawDetachReason !== null && isWorkspaceDetachReason(rawDetachReason)
        ? rawDetachReason
        : null;

    const parts: Array<MessagePart> = [];
    let writes: WorkspaceWrites | undefined;
    let toldAvailable: boolean | undefined;

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
        toldFrom: latestCheckpointId,
        clearDetachReason: detachReason !== null,
      };
    }

    // One narration per availability transition: the state the Chat was last
    // told about against the one this attempt decided. A removed Machine is
    // the detach notice's story, not this one.
    const machine = input.machine;

    const narration = machineAvailabilityNarration({
      runId: input.runId,
      machine,
      toldAvailable: input.chat.workspaceToldAvailable,
    });

    if (narration !== undefined) {
      parts.push(narration.part);
      toldAvailable = narration.available;
      writes ??= {
        told: currentRoot,
        toldFrom: latestCheckpointId,
        clearDetachReason: false,
      };
    }

    if (detachReason !== null) {
      parts.push(
        createWorkspaceDetachNoticeItem({
          runId: input.runId,
          reason: detachReason,
          ...(machine?.removed === true && { machine: machine.name }),
        }),
      );
      writes ??= {
        told: currentRoot,
        toldFrom: latestCheckpointId,
        clearDetachReason: true,
      };
    }

    return {
      parts,
      ...(writes !== undefined && {
        writes: {
          ...writes,
          ...(toldAvailable !== undefined && { available: toldAvailable }),
        },
      }),
    };
  }

  /**
   * The attempt's dispatch transaction (design D1), in the worker's lock
   * order: the run fence with this attempt's availability record, the
   * accepted-turn items on the triggering user row, the reply created or reset
   * as `running` for this attempt (design D3/D7), the told state those items
   * account for on the chat, then `model.requested` naming the attempt. A lost
   * fence or a missing user row stores nothing and dispatches nothing; a
   * completed reply rolls the transaction back with ReplyAlreadyCompletedError.
   */
  private async dispatchAttempt(
    tx: Db,
    input: {
      run: ExecuteRunInput;
      attemptId: string;
      context: PreparedAttemptContext;
      modelId: string;
      effort: string | undefined;
      permissionMode: PermissionMode;
      wakeState: ContinueState | undefined;
    },
  ): Promise<void> {
    const { run, context } = input;

    // Reassigning the identical UUID is a deliberate no-op that still makes a
    // stale attempt return no row. The record is written even when it is `[]`:
    // it is what marks this Run as dispatched (design D11).
    const fenced = await new RunsRepository(tx).updateForAttempt(
      run.runId,
      run.userId,
      input.attemptId,
      {
        activeAttemptId: input.attemptId,
        turnToolAvailability: toTurnToolAvailability(
          context.toolCatalog.availabilityManifest,
        ),
      },
    );

    if (!fenced) throw new RunNotRunnableError(run.runId);

    // A cancellation recorded where no abort reached this worker (another
    // process, or a delivery between two segments) ends the Run before the
    // request goes out.
    if (fenced.cancelRequestedAt !== null) {
      throw new CancellationRecordedError(run.runId);
    }

    const events = new RunEventsRepository(tx);

    const deliveryIds =
      input.wakeState === undefined
        ? await discardedJobNoticeIds({
            tx,
            runId: run.runId,
            ownerUserId: run.userId,
            attemptId: input.attemptId,
          })
        : [];

    const firstRegenerateDispatch =
      run.followUpAction === 'regenerate' &&
      !(await events.findFirstByType(run.runId, run.userId, 'model.requested'));

    const sourceDeliveryGroups =
      firstRegenerateDispatch && fenced.sourceRunId !== null
        ? await sourceSegmentJobNoticeIds({
            tx,
            sourceRunId: fenced.sourceRunId,
            chatId: run.chatId,
            ownerUserId: run.userId,
          })
        : [];

    if (deliveryIds.length > 0 || sourceDeliveryGroups.length > 0) {
      if (!(await new ChatsRepository(tx).lock(run.chatId, run.userId))) {
        throw new RunNotRunnableError(run.runId);
      }

      const deliveries = new ChatDeliveriesRepository(tx);

      if (deliveryIds.length > 0) {
        await deliveries.restoreJobNotices({
          chatId: run.chatId,
          ownerUserId: run.userId,
          runId: run.runId,
          deliveryIds,
        });
      }

      for (const group of sourceDeliveryGroups) {
        await deliveries.restoreJobNotices({
          chatId: run.chatId,
          ownerUserId: run.userId,
          runId: group.runId,
          deliveryIds: group.deliveryIds,
        });
      }
    }

    const stored = await new AcceptedTurnPartsRepository(tx).storeAtDispatch({
      id: run.userMessage.id,
      chatId: run.chatId,
      items: context.stagedParts.filter(isContextItemPart),
      placement: context.placement,
      removeModelSwitch: context.removesModelSwitch,
    });

    // The chat was deleted out from under a claimed run; executing past that
    // would send a request on behalf of a run nobody can see.
    if (!stored.applied) throw new RunNotRunnableError(run.runId);

    // The reset drops an earlier attempt's output and in-Run items together.
    const reply = await new RunningReplyRepository(tx).upsertRunningReply({
      chatId: run.chatId,
      inReplyTo: run.userMessage.id,
      usage: runningReplyUsage({
        runId: run.runId,
        attemptId: input.attemptId,
        modelId: input.modelId,
        effort: input.effort,
        permissionMode: input.permissionMode,
      }),
      followUpAction: run.followUpAction ?? null,
    });

    if (!reply) throw new ReplyAlreadyCompletedError(run.runId);
    const chatsRepo = new ChatsRepository(tx);

    if (context.recencyDigestTold !== undefined) {
      await chatsRepo.updateRecencyDigestTold(
        run.chatId,
        run.userId,
        context.recencyDigestTold,
      );
    }

    if (context.skillCatalogNoticeTold !== undefined) {
      await chatsRepo.updateSkillCatalogTold(
        run.chatId,
        run.userId,
        context.skillCatalogNoticeTold,
      );
    }

    if (context.workspaceWrites !== undefined) {
      await new WorkspaceBindingRepository(tx).setTold({
        chatId: run.chatId,
        ownerUserId: run.userId,
        told: context.workspaceWrites.told,
        toldFrom: context.workspaceWrites.toldFrom,
        clearDetachReason: context.workspaceWrites.clearDetachReason,
        ...(context.workspaceWrites.available !== undefined && {
          available: context.workspaceWrites.available,
        }),
      });
    }

    // `model.requested` describes the target inference, not the summary
    // inference that may have preceded it.
    await new RunEventsRepository(tx).append(run.runId, 'model.requested', {
      modelId: input.modelId,
      // Travels with modelId wherever it is recorded (available-models
      // spec); omitted rather than null when the run carried none.
      ...(input.effort !== undefined && { effort: input.effort }),
      // The attempt whose events a settler without its collector rebuilds
      // the reply from (design D3).
      attemptId: input.attemptId,
    });
  }

  /**
   * Writes an in-Run item onto the running reply with the collector's part
   * snapshot, in one transaction fenced by the attempt, before the request
   * that first carries it (design D3). A lost fence or a reply no longer
   * running under this attempt fails the step. The `superseded` cut of a
   * failed send rides the same transaction, so a reply never stores one
   * without the other (continue-after-broken-send D4/D6).
   */
  private async storeInRunSnapshot(
    input: ExecuteRunInput,
    attemptId: string,
    parts: Array<MessagePart>,
    superseded?: SupersededModelOutput,
  ): Promise<void> {
    await this.tenantDb.runAs(input.userId, async (tx) => {
      const fenced = await new RunsRepository(tx).updateForAttempt(
        input.runId,
        input.userId,
        attemptId,
        { activeAttemptId: attemptId },
      );

      const stored =
        fenced !== undefined &&
        (await new RunningReplyRepository(tx).updateRunningReplyParts({
          chatId: input.chatId,
          inReplyTo: input.userMessage.id,
          attemptId,
          parts,
        }));

      if (!stored) throw new RunNotRunnableError(input.runId);

      if (superseded !== undefined) {
        await new RunEventsRepository(tx).append(
          input.runId,
          'model.superseded',
          superseded,
        );
      }
    });
  }
}

/**
 * How many media references the triggering message's own parts carry: its
 * owner `file` parts and the marker of each import entry that keeps bytes or a
 * stored locator. They are the request's references before the kept steps.
 */
function triggerRefCount(parts: ReadonlyArray<unknown>): number {
  const imports = parts.reduce<number>(
    (count, part) =>
      isContextItemPart(part) ? count + promptImportMarkerCount(part) : count,
    0,
  );

  return fileMediaIds(parts).length + imports;
}

/**
 * Settle one model `read` of an unstored file against the message bound
 * (`media-attachments`): while its base64 fits what the reply already holds,
 * its entry stays and the result's part and event carry the bytes; past it, the
 * entry becomes the exceeded record, which the window latches at the limit, and
 * both carry `{ exceeded: true }`. Only a successful read keeps anything: a
 * cancelled or failed one names no marker, so its entry is dropped. A
 * system-origin read keeps its bytes in its own item, and every other call has
 * no entry, so neither records anything here.
 */
function settleRetainedMedia(input: {
  readonly retainedMedia: Map<string, RetainedMedia>;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly origin: ToolActivityOrigin | undefined;
  readonly status: ToolResult['status'];
  readonly used: number;
}): RetainedSettlement {
  const { retainedMedia, toolCallId, used } = input;

  if (
    input.toolName !== 'read' ||
    input.origin !== undefined ||
    input.status !== 'success'
  ) {
    return { used };
  }

  const entry = retainedMedia.get(toolCallId);

  if (entry === undefined) return { used };
  const settled = boundRetained(entry, used);

  if (settled.record !== undefined && 'exceeded' in settled.record) {
    retainedMedia.set(toolCallId, exceededEntry(entry));
  }

  return settled;
}

/**
 * The media reference a live `read` sends the model: its stored locator, or the
 * keyed marker of an unstored file, emitted only while this attempt holds the
 * entry its key names. A result without either is text alone.
 */
function retainedReadRef(
  retainedMedia: ReadonlyMap<string, RetainedMedia>,
  toolCallId: string,
  ref: ReadMediaRef | undefined,
): ToolMediaRef | undefined {
  if (ref === undefined || !isUnstoredMedia(ref)) return ref;

  return retainedMedia.has(toolCallId)
    ? { ...ref, key: toolCallId }
    : undefined;
}

/**
 * The Chat's history, the trigger's stored parts in its history-row position,
 * then — for a Continue Run — the kept steps (turn-actions D5/D6). A trigger
 * whose own parts project to no model content has not produced a history
 * message, even if this dispatch stages context, so it is appended rather than
 * replacing the preceding assistant reply.
 */
function requestMessages(
  context: PreparedAttemptContext,
  keptMessages: ReadonlyArray<ModelRequestContext['messages'][number]>,
): Array<ModelRequestContext['messages'][number]> {
  if (context.triggerParts === undefined) return context.messages;

  // A dispatch that replaces the model-switch item drops the stored one from
  // the request as well as from the row, so the model reads one switch item
  // (turn-actions D8).
  const triggerParts = context.removesModelSwitch
    ? context.triggerParts.filter((part) => !isModelSwitchItem(part))
    : context.triggerParts;

  const messages = [...context.messages];

  const trigger: ModelRequestContext['messages'][number] = {
    role: 'user',
    content: userPartsToModelContent(
      placeAcceptedTurnItems(
        triggerParts,
        context.stagedParts.filter(isContextItemPart),
        context.placement,
      ),
    ),
  };

  if (userPartsToModelContent(context.triggerParts).length === 0) {
    messages.push(trigger);
  } else {
    messages[messages.length - 1] = trigger;
  }

  return [...messages, ...keptMessages];
}

/**
 * The text of an attempt's staged items, which the compaction trigger's
 * estimate adds to the stored rows: the trigger row does not carry them until
 * the dispatch transaction stores them.
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

/**
 * The availability reminder this attempt stages. A retry after a dispatch
 * compares against the record that dispatch stored, so a reminder names only
 * what changed since; a checkpoint this attempt published starts a new epoch,
 * judged as any first dispatch is.
 */
function deriveAttemptAvailabilityItem(input: {
  runId: string;
  baseline: DisclosureBaseline;
  manifest: AttemptToolCatalog['availabilityManifest'];
  afterPublication: boolean;
}): MessagePart | undefined {
  const { ownAvailability, previousDispatched, startsEpoch } = input.baseline;
  let previous: Array<TurnToolAvailabilityEntry> | undefined;

  if (ownAvailability !== null && !input.afterPublication) {
    previous = ownAvailability;
  } else if (!startsEpoch) {
    previous = previousDispatched?.run.turnToolAvailability ?? undefined;
  }

  const payload =
    previous === undefined
      ? deriveToolAvailabilityPayload({ current: input.manifest })
      : deriveToolAvailabilityPayloadFromStates({
          current: input.manifest,
          previous,
        });

  return payload
    ? createToolAvailabilityItem({ runId: input.runId, payload })
    : undefined;
}

/**
 * The recency digest items this attempt stages: the supersession marker when
 * the digest was re-baked for the checkpoint opening this epoch and no
 * dispatch of this Run stored a marker for it, then the delta since the told
 * state.
 */
function deriveRecencyDigestItems(input: {
  baseline: DisclosureBaseline;
  runId: string;
  prompt: AttemptPromptContext;
  markerUntold: boolean;
}): Array<MessagePart> {
  const { baseline, runId, prompt } = input;
  const items: Array<MessagePart> = [];

  // The marker reports the re-bake to the first attempt that can dispatch
  // after it — the new epoch's first turn — so it rides the same boundary.
  const digestRebaked =
    input.markerUntold &&
    baseline.startsEpoch &&
    prompt.chat.recencyDigestRebakedFrom === prompt.checkpoint?.id;

  if (
    digestRebaked &&
    prompt.chat.recencyDigestBaseline !== null &&
    prompt.shareRecentChats.shareRecentChats
  ) {
    items.push(createRecencyDigestSupersessionItem({ runId }));
  }

  if (prompt.digestDelta) {
    items.push(
      createRecencyDigestDeltaItem({
        runId,
        payload: {
          entries: prompt.digestDelta.entries,
          pinChanges: prompt.digestDelta.pinChanges,
        },
      }),
    );
  }

  return items;
}

/**
 * The titled turn's text followed by one line per file part (vision-media D9,
 * pdf-media D8), so an image- or PDF-only message can still be titled.
 * Titling bounds the result like any other title input.
 */
function titleInputText(userMessage: RunUserMessage): string {
  return [
    partsToText(userMessage.parts).trim(),
    ...fileAttachmentLines(userMessage.parts),
  ]
    .join('\n')
    .trim();
}
