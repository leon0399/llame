import { type ToolResult, type UnknownRecord } from '@workspace/runtime-safety';
import { type z } from 'zod';

import { type TenantRunner } from '../db/tenant-db.service';
import { type KnowledgeSpaceCursor } from '../knowledge/knowledge-space.cursor';
import {
  type KnowledgeFilesystemAdapterPort,
  type KnowledgeFilesystemBinding,
} from '../knowledge/knowledge-filesystem';
import { type QueryEmbedderPort } from '../search/chat-search-query-embedder';

/**
 * A JSON Schema document used as a tool's input schema. Accepted as-is from
 * external sources (D2: "accepted as the source ships it"). Distinct from
 * `z.ZodTypeAny` which is the code-authored schema form.
 */
export type JsonSchemaDocument = UnknownRecord;

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
  /** Stops this Run when a native mutation cannot be safely settled. */
  readonly onNativeMutationUnknown?: () => void;
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
  /** Process-wide query embedder for search; undefined when no model is configured. */
  readonly queryEmbedder?: QueryEmbedderPort;
}

/** SPEC §13.5 classification. Non-read-only execution requires an exact,
 * code-owned capability; classification alone never grants write authority. */
export type ToolClassification =
  | 'read_only'
  | 'write_low_risk'
  | 'write_high_risk'
  | 'execute_code'
  | 'external_send'
  | 'financial_or_sensitive'
  | 'admin';

/**
 * Structured tool observation — never a raw blob; small and typed. The
 * `status` discriminant lets the model react to failures as data, not
 * exceptions (D6: tool failure is an observation, not a crash).
 */
export type { ToolResult } from '@workspace/runtime-safety';

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
  readonly inputSchema: z.ZodTypeAny | JsonSchemaDocument;
  execute(context: ToolContext, args: TArgs): ToolResult | Promise<ToolResult>;
}
