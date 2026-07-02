import { type z } from 'zod';

import { type TenantDbService } from '../../db/tenant-db.service';

/**
 * Trusted execution context injected into a tool's execute by the run loop —
 * NEVER supplied by the model. A data-reading tool takes its scope from HERE
 * (userId), so the model cannot widen it: authorization identity comes only
 * from a trusted source (repo security invariant / agents-best-practices).
 * `tenantDb.runAs(userId)` engages RLS, scoping every read to the user.
 */
export interface ToolContext {
  readonly userId: string;
  readonly chatId: string;
  readonly tenantDb: TenantDbService;
}

/**
 * Tool taxonomy (#… tool-calling loop, agents-best-practices risk classes).
 * A tool's class is always explicit. `read_only` tools may be default-available
 * (the safe allowlist); a `write_internal`+ tool is never default-available —
 * it is admitted only by an explicit policy `allow` (fail-closed by default).
 */
export type ToolRiskClass =
  | 'read_only'
  | 'compute_only'
  | 'search_only'
  | 'write_local'
  | 'write_internal'
  | 'write_external'
  | 'destructive';

/**
 * Structured tool observation (agents-best-practices "return structured
 * observations, bounded"). Never a raw blob; small and typed. The `status`
 * discriminant lets the model react to failures as data, not exceptions.
 */
export type ToolResult =
  | ({ status: 'success' } & Record<string, unknown>)
  | { status: 'error'; type: string; message: string };

/**
 * A built-in tool: a narrow contract between the model and the harness. The
 * model sees `name` / `description` / `inputSchema`; the harness owns
 * `execute`. `riskClass` is metadata for the permission layer — it does NOT
 * by itself grant availability (see the central allowlist in registry.ts).
 */
export interface BuiltinTool<TArgs = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly riskClass: ToolRiskClass;
  // ZodTypeAny (not ZodType<TArgs>): a `.default()`-bearing schema has a wider
  // input type than its parsed output, which ZodType<TArgs> can't express. The
  // AI SDK's tool() accepts any zod schema; execute() carries the parsed shape.
  readonly inputSchema: z.ZodTypeAny;
  // context is OPTIONAL in the type so pure tools (get_current_time) and their
  // unit tests can call execute(args) with no ceremony; the run loop ALWAYS
  // supplies it, and data tools require it (guarding when absent). The model
  // supplies only `args` (the inputSchema) — never the context. This is the
  // input/context split opencode/openclaw/hermes all use: identity used for
  // authorization is never model-supplied.
  execute(args: TArgs, context?: ToolContext): ToolResult | Promise<ToolResult>;
}
