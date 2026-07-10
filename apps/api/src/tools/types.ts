import { type z } from 'zod';

import { type TenantDbService } from '../db/tenant-db.service';

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
  readonly tenantDb: TenantDbService;
}

/**
 * SPEC §13.5 tool safety classification — verbatim enum. This slice executes
 * ONLY `read_only`; the rest are reserved so a tool's classification is
 * always one of the seven SPEC-mandated values (design D2: foundation over
 * YAGNI — one union type now avoids re-touching every tool definition when
 * the first write tool + §7.5 approvals land).
 */
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
export type ToolResult =
  | ({ status: 'success' } & Record<string, unknown>)
  | { status: 'error'; type: string; message: string };

/**
 * A registered tool (design D2): `{ id, description, inputSchema,
 * classification, execute(ctx, args) }`. `classification` is required —
 * an unclassified tool is unrepresentable in the type, and the registry
 * additionally validates it at startup (fail loud, not at call time).
 * `timeoutSeconds` is an optional per-tool override of the global
 * `tools.callTimeoutSeconds` (D6), a code-level property, not a config key.
 */
export interface Tool<TArgs = Record<string, unknown>> {
  readonly id: string;
  readonly description: string;
  readonly classification: ToolClassification;
  readonly timeoutSeconds?: number;
  // ZodTypeAny (not ZodType<TArgs>): a `.default()`-bearing schema has a wider
  // input type than its parsed output, which ZodType<TArgs> can't express.
  readonly inputSchema: z.ZodTypeAny;
  execute(context: ToolContext, args: TArgs): ToolResult | Promise<ToolResult>;
}
