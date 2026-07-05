import { type z } from 'zod';

/**
 * Tool taxonomy (#… tool-calling loop, agents-best-practices risk classes).
 * The MVP ships only `read_only`; the rest are reserved so a tool's class is
 * always explicit and the pre-filter's fail-closed default (below) is
 * meaningful.
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
  execute(args: TArgs): ToolResult | Promise<ToolResult>;
}
