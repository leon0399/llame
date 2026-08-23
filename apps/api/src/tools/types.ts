import type { TenantRunner } from '../db/tenant-db.service';
import type { UnknownRecord } from '@workspace/harness';

// The shared tool contracts live in @workspace/harness; this module binds
// them to the API's trusted context transport.
export {
  type JsonSchemaDocument,
  type ToolClassification,
  type ToolResult,
} from '@workspace/harness';

/**
 * Trusted execution context injected into a tool's execute by the run loop —
 * NEVER supplied by the model. A data-reading tool takes its scope from HERE
 * (userId), so the model cannot widen it: authorization identity comes only
 * from a trusted source (repo security invariant / SPEC §22.0). `runAs`
 * engages RLS, scoping every read to the user.
 */
export interface ToolContext {
  readonly userId: string;
  readonly chatId: string;
  readonly tenantDb: TenantRunner;
  readonly abortSignal?: AbortSignal;
  /** Trusted AI SDK call correlation, never supplied by model arguments. */
  readonly toolCallId?: string;
}

/** The API's tool contract: the shared harness Tool bound to the API context. */
export type Tool<TArgs = UnknownRecord> = import('@workspace/harness').Tool<
  TArgs,
  ToolContext
>;
