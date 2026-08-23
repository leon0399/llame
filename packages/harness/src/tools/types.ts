import { type z } from "zod";

import { type UnknownRecord } from "../unknown-record";

/**
 * The trusted, harness-injected slice of every tool context — NEVER supplied
 * by the model. Concrete hosts extend it with their own identity transport
 * (the API adds `userId`/`tenantDb` for RLS scoping; the local CLI binds
 * `workspaceRoot`). Authorization identity always comes from here, never
 * from model-controlled input.
 */
export interface BaseToolContext {
  readonly abortSignal?: AbortSignal;
  /** Trusted AI SDK call correlation, never supplied by model arguments. */
  readonly toolCallId?: string;
}

/**
 * A JSON Schema document used as a tool's input schema. Accepted as-is from
 * external sources (D2: "accepted as the source ships it"). Distinct from
 * `z.ZodTypeAny` which is the code-authored schema form.
 */
export type JsonSchemaDocument = UnknownRecord;

/**
 * SPEC §13.5 tool safety classification — verbatim enum. Classifications
 * beyond `read_only` require an explicit approval decision through the
 * runner's {@link ApprovalGate} before they execute; an absent or failing
 * gate denies (fail closed).
 */
export type ToolClassification =
  | "read_only"
  | "write_low_risk"
  | "write_high_risk"
  | "execute_code"
  | "external_send"
  | "financial_or_sensitive"
  | "admin";

/**
 * Structured tool observation — never a raw blob; small and typed. The
 * `status` discriminant lets the model react to failures as data, not
 * exceptions (D6: tool failure is an observation, not a crash).
 */
export type ToolResult =
  | ({ status: "success" } & UnknownRecord)
  | { status: "error"; type: string; message: string };

/**
 * A registered tool (design D2): `{ id, description, inputSchema,
 * classification, execute(ctx, args) }`. `classification` is required —
 * an unclassified tool is unrepresentable in the type, and registries
 * validate classification at registration time (fail loud, not at call
 * time). `timeoutSeconds` is an optional per-tool override of the caller's
 * global call timeout (D6), a code-level property, not a config key.
 */
export interface Tool<
  TArgs = UnknownRecord,
  TContext extends BaseToolContext = BaseToolContext,
> {
  readonly id: string;
  readonly description: string;
  readonly classification: ToolClassification;
  readonly timeoutSeconds?: number;
  readonly inputSchema: z.ZodTypeAny | JsonSchemaDocument;
  execute(context: TContext, args: TArgs): ToolResult | Promise<ToolResult>;
}
