import { type BashProcessLimiter } from '@workspace/bash-executor';
import { type ToolResult, type UnknownRecord } from '@workspace/runtime-safety';
import { type z } from 'zod';

import { type TenantRunner } from '../db/tenant-db.service';
import { type BashJobRegistry } from '../jobs/bash-job-registry';
import { type ChatDeliverySettings } from '../db/schema';
import { type KnowledgeSpaceCursor } from '../knowledge/knowledge-space.cursor';
import {
  type KnowledgeFilesystemAdapterPort,
  type KnowledgeFilesystemBinding,
} from '../knowledge/knowledge-filesystem';
import { type QueryEmbedderPort } from '../search/chat-search-query-embedder';
import { type SkillCatalogPort } from '../skills/skill-catalog';
import {
  type WorkspaceMcpClients,
  type WorkspaceMcpListingCell,
} from '../mcp/workspace-mcp-clients';
import {
  type GrepBoundsConfig,
  type WebAdapterConfig,
} from '../instance-config/llame-config';
import { type WebSearchConfig } from '../instance-config/web-search-config';
import { type CompiledPolicy } from './permissions/types';
import { type PermissionMode } from './permissions/permission-mode';
import { type WorkspaceRootCell } from './workspace-path';
import { type AttemptToolAdditions } from './attempt-tool-additions';
import { type DerivedDecision } from './web-read/admission';
import { type ModelClientFactory } from '../models/models.service';
import { type DecisionJudge } from '../decisions/decisions.service';
import { type ToolMediaStore } from '../media/tool-media-store';
import { type MachineConnector } from '../machines/machine-connector.service';
import { type ExecutorGit } from '../machines/executor-git.service';
import { type MachineStatusView } from '../machines/machines-status';
import { type SshBinding, type SshClient } from '../ssh/ssh-client';

/**
 * A JSON Schema document used as a tool's input schema. Accepted as-is from
 * external sources (D2: "accepted as the source ships it"). Distinct from
 * `z.ZodType` which is the code-authored schema form.
 */
export type JsonSchemaDocument = UnknownRecord;

/**
 * The configured Machines with their derived status, as a bare `machine://`
 * read lists them. It is the owner-scoped read model behind the Machines
 * route; no SSH route, jump host, or identity is part of it.
 */
export type MachineStatusReader = {
  list(userId: string): Promise<ReadonlyArray<MachineStatusView>>;
};

/** Trusted, worker-bound capability for live owner Knowledge access. */
export type KnowledgeToolSpaceReference = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
};

export type KnowledgeToolSpacePage = {
  readonly spaces: ReadonlyArray<KnowledgeToolSpaceReference>;
  readonly nextCursor?: KnowledgeSpaceCursor;
};

export type KnowledgeToolResolver = {
  /** Current owner-scoped page used by unscoped search. */
  readonly listForOwnerPage: (
    ownerUserId: string,
    after?: KnowledgeSpaceCursor,
  ) => Promise<KnowledgeToolSpacePage>;
  /** Exact current owner-scoped lookup used by explicit search/read and each page target. */
  readonly resolveBindingForOwnerById: (
    ownerUserId: string,
    knowledgeSpaceId: string,
  ) => Promise<KnowledgeFilesystemBinding | undefined>;
  readonly createAdapter: (
    binding: KnowledgeFilesystemBinding,
  ) => KnowledgeFilesystemAdapterPort;
};

/** The typed git surface a worktree entry needs, which `ExecutorGit` provides. */
export type WorktreeGit = Pick<
  ExecutorGit,
  | 'address'
  | 'canonical'
  | 'canonicalTarget'
  | 'executorPath'
  | 'exists'
  | 'inspect'
  | 'removeWorktree'
  | 'worktreeAdd'
>;

/**
 * Trusted execution context injected into a tool's execute by the run loop —
 * NEVER supplied by the model. A data-reading tool takes its scope from HERE
 * (userId), so the model cannot widen it: authorization identity comes only
 * from a trusted source (repo security invariant / SPEC §22.0). `runAs`
 * engages RLS, scoping every read to the user.
 */
export interface ToolContext {
  /** Trusted Run and native host identity; never model supplied. */
  readonly runId?: string;
  readonly nativeExecutorId?: string;
  /** The durable run.started event claimed by this worker delivery. */
  readonly nativeDeliverySequence?: number;
  /** Marks an MCP dispatch once its durable native.attempt is committed. */
  readonly onMcpDispatchRecorded?: () => void;
  /**
   * The Run attempt that admitted this call. Native admission refuses a call
   * whose attempt is no longer the Run's active one, so a call of an
   * interrupted segment cannot record an attempt after its delivery
   * (run-steering D7).
   */
  readonly attemptId?: string;
  /** Marks the point after host bash has spawned but before its receipt commits. */
  readonly onHostCommandStarted?: () => void;
  /** Notifies the runner that host bash entered its fenced promotion receipt. */
  readonly onHostPromotionStarted?: () => void;
  /** Stops this Run when a native mutation cannot be safely settled. */
  readonly onNativeMutationUnknown?: () => void;
  /** Trusted canonical target for the first page of an instruction import. */
  readonly canonicalReadPath?: string;
  /** Trusted per-call sink for a web read's derived-locator decisions; never model-visible. */
  readonly onDerivedDecision?: (decision: DerivedDecision) => void;
  /** Boot-time instance-config identity (`llame/<version>`) every web request sends. */
  readonly productUserAgent?: string;
  readonly userId: string;
  readonly chatId: string;
  readonly tenantDb: TenantRunner;
  readonly abortSignal?: AbortSignal;
  /** Trusted per-call deadline signal; distinct from parent Run cancellation. */
  readonly timeoutSignal?: AbortSignal;
  /** Effective per-call deadline in milliseconds, supplied by the runner. */
  readonly timeoutMs?: number;
  /** Trusted AI SDK call correlation, never supplied by model arguments. */
  readonly toolCallId?: string;
  /** Trusted worker-bound Knowledge capability; never model supplied. */
  readonly knowledgeResolver?: KnowledgeToolResolver;
  /**
   * Trusted process-wide skill catalog (system-provided-skills D1). Absent
   * means no skill source is configured, so `skill://` fails closed.
   */
  readonly skillCatalog?: SkillCatalogPort;
  /**
   * The current user turn's explicit `$skill` selections, derived by the
   * activation layer from the triggering user message and supplied to every
   * skill read in that Run. A caller with no turn context leaves it unset, so
   * a manual-only package's body read refuses.
   */
  readonly skillSelection?: ReadonlySet<string>;
  /**
   * The Run owner's media store, bound to that owner and the Run attempt
   * (vision-media D7). Absent means a local read never
   * detects images and `media://` fails closed.
   */
  readonly media?: ToolMediaStore;
  /** Process-wide query embedder for search; undefined when no model is configured. */
  readonly queryEmbedder?: QueryEmbedderPort;
  /**
   * Trusted immutable per-process execution policy. Absent (a code error, not
   * a caller choice) fails every call closed; model arguments can never supply
   * or replace it.
   */
  readonly permissionPolicy?: CompiledPolicy;
  /**
   * The boot-time configured credential set (instance-config D1), read only to
   * redact configured secrets from tool output. It never leaves the API
   * process: a remote host or Machine never receives it.
   */
  readonly configuredCredentials: ReadonlyArray<string>;
  /** Ordered, boot-validated web adapters enabled by instance configuration. */
  readonly webAdapters?: ReadonlyArray<WebAdapterConfig>;
  /** Ordered, boot-validated web search engines enabled by instance configuration. */
  readonly webSearch?: WebSearchConfig;
  /**
   * Operator `tools.grep` walk bounds. Absent (a context built outside the run
   * loop) means no file, entry, byte, or file-size bound, exactly as an absent
   * configuration object does.
   */
  readonly grepBounds?: GrepBoundsConfig;
  /**
   * Operator `tools.artifacts.maxBytes`, the one byte bound on every stored
   * artifact part (tool-result-artifacts D13). Absent means the built-in bound.
   */
  readonly artifactMaxBytes?: number;
  /**
   * `read` is in `tools.allowed`. In default mode, a Run can read artifacts
   * when this is true and the per-locator `read` group admits the locator;
   * bypass mode admits without evaluating policy. The admission is checked
   * where the artifact is written (tool-result-artifacts "An artifact needs a
   * way to read it").
   */
  readonly artifactReadable?: boolean;
  /**
   * `bash` is in `tools.allowed` and this process has a native executor, so a
   * Run's artifacts are also copied as files under
   * `$TMPDIR/llame/chats/<chatId>/` when the host directories verify
   * (tool-result-artifacts D10). Postgres stays authoritative: a copy can be
   * missing or stale, and the reconcile rewrites it. Absent means no host
   * file is written.
   */
  readonly artifactHostFiles?: boolean;
  /**
   * The one limiter of this worker process, built from `tools.bash.maxProcesses`
   * (background-jobs D7). A host or `ssh://` `bash` call takes a slot from it
   * before it calls the executor. Absent means this context cannot run `bash`.
   */
  readonly bashProcessLimiter?: BashProcessLimiter;
  readonly bashJobs?: BashJobRegistry;
  readonly jobSettings?: ChatDeliverySettings;
  readonly allowUnlimitedJobs?: boolean;
  /**
   * Host `bash` only: the runner's foreground move trigger, from the call's
   * bound or a segment yield. It moves the command; it never stops it.
   */
  readonly moveSignal?: AbortSignal;
  /**
   * Segment yield source. The runner binds a call-local move window to it for
   * host `bash`; it never becomes the command's cancellation signal. It stays
   * raised until the segment ends, including calls that start after the steer.
   */
  readonly yieldSignal?: AbortSignal;
  /** Monotonic spawn deadline in `performance.now()` milliseconds. */
  readonly moveDeadlineAt?: number;
  /** `tools.bash.backgroundAfterSeconds`; absent means the built-in 120. */
  readonly bashBackgroundAfterSeconds?: number;
  /**
   * Operator `tools.callTimeoutSeconds`, the timeout a tool falls back to when
   * the runner supplied no per-call `timeoutMs`.
   */
  readonly callTimeoutSeconds?: number;
  /**
   * Seconds without a heartbeat after which a worker is dead, four intervals of
   * `runs.heartbeatSeconds` (background-jobs D9). A `job://` read settles the
   * running jobs of a dead worker as `lost`. Absent means the built-in value.
   */
  readonly workerDeadAfterSeconds?: number;
  /**
   * Trusted model-client factory for model-hosted web search engines, never
   * model supplied. A host double that only validates selections leaves
   * `createClient` unset, and those engines then fail closed.
   */
  readonly modelClients?: Partial<ModelClientFactory>;
  /**
   * Trusted decision-lane judge for ranking a tool's own candidates, plus
   * `protectText`, the exact-key replacement of the decision credential a
   * ranked tool applies to source text before excerpts. Absent means the lane
   * is not configured and the tool keeps its canonical order; a failure is
   * never read as a negative judgment.
   * A call shares this context's `abortSignal`.
   */
  readonly decisions?: DecisionJudge;
  /**
   * Trusted effective per-attempt permission mode. Absent means default policy
   * evaluation.
   */
  readonly permissionMode?: PermissionMode;
  /** Attempt-scoped Workspace root; changes become visible at the next model step. */
  readonly workspaceRoot?: WorkspaceRootCell;
  /** Trusted handle for adding Workspace declarations during this attempt. */
  readonly toolAdditions?: AttemptToolAdditions;
  /** Process-local Workspace MCP clients for this Chat's current binding. */
  readonly workspaceMcp?: WorkspaceMcpClients;
  /**
   * The attempt's one `read-only` Workspace MCP listing. A `read-only`
   * attempt starts no server, so entry reports the configuration it read here
   * instead, and a same-root re-entry reads no configuration again.
   */
  readonly workspaceMcpListing?: WorkspaceMcpListingCell;
  /**
   * Operator-configured Machines this Run may address. Absent means no Machine
   * surface exists, so `machine://` is refused as an unknown scheme.
   */
  readonly machines?: MachineConnector;
  /** The owner-scoped status read model a bare `machine://` read lists. */
  readonly machineStatus?: MachineStatusReader;
  /**
   * The attempt identity every Machine request carries and once-per-attempt
   * reachability is cached by. Absent means one verdict for the process.
   */
  readonly machineAttemptKey?: string;
  /**
   * The `ssh://` transport, present only when the operator configured the
   * top-level `ssh` section (ssh-locator D1). Absent means the locator does not
   * exist and an `ssh://` path stays an unknown scheme with no process.
   */
  readonly sshClient?: SshClient;
  /**
   * The resolved destination of this call, set by the runner's two-pass
   * admission for an admitted `ssh://` read (ssh-locator D3). Execution binds
   * the connection to it; it is trusted, never model supplied.
   */
  readonly sshBinding?: SshBinding;
  /**
   * The trusted typed git surface `enter_workspace` needs to create a
   * worktree. Absent means the process serves no git, so a `worktree` call
   * fails before it probes anything.
   */
  readonly executorGit?: WorktreeGit;
}

/** SPEC §13.5 classification. Code-owned non-read-only execution requires an
 * exact host capability; MCP executors use `unverified` because llame makes no
 * claim about their effects. */
export const TOOL_CLASSIFICATIONS = [
  'read_only',
  'write_low_risk',
  'write_high_risk',
  'execute_code',
  'external_send',
  'financial_or_sensitive',
  'admin',
  'unverified',
] as const;

export type ToolClassification = (typeof TOOL_CLASSIFICATIONS)[number];

/** How an owner interrupt settles one call: host bash backgrounds, remote
 * bash and reads cancel, and native writes finish before delivery. */
export type InterruptFate = 'cancel' | 'finish' | 'background';

/** Whether a stored value names one of the classifications above. */
export function isToolClassification(
  value: unknown,
): value is ToolClassification {
  return TOOL_CLASSIFICATIONS.some((known) => known === value);
}

/**
 * Structured tool observation — never a raw blob; small and typed. The
 * `status` discriminant lets the model react to failures as data, not
 * exceptions (D6: tool failure is an observation, not a crash).
 */
export type { ToolResult } from '@workspace/runtime-safety';

/** The error half of a tool result: every refusal and failure is one. */
export type ToolErrorResult = Extract<ToolResult, { status: 'error' }>;

/**
 * How a tool's result spills when it does not fit the model-facing bound
 * (tool-result-artifacts D3). `head` is the default: the runner and the MCP cap
 * site store the whole rendering, then keep today's shape-preserving cut
 * inline. `tool` means the tool builds its own inline part and artifact, so the
 * result cap does not shorten it. No code chooses a shape by tool name.
 */
export type ToolSpill = 'head' | 'tool';

/**
 * A registered tool (design D2): `{ id, description, inputSchema,
 * classification, execute(ctx, args) }`. `classification` is required —
 * an unclassified tool is unrepresentable in the type, and the registry
 * additionally validates it at startup (fail loud, not at call time).
 * `timeoutSeconds` is an optional per-tool override of the global
 * `tools.callTimeoutSeconds` (D6), a code-level property, not a config key.
 */
export interface Tool<TArgs = UnknownRecord> {
  readonly id: string;
  readonly description: string;
  readonly classification: ToolClassification;
  readonly timeoutSeconds?: number;
  /** Absent means `head` (tool-result-artifacts D3). */
  readonly spill?: ToolSpill;
  readonly inputSchema: z.ZodType | JsonSchemaDocument;
  execute(context: ToolContext, args: TArgs): ToolResult | Promise<ToolResult>;
}
