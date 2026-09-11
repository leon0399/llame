/**
 * Operator tool-call permission surface (openspec/changes/tool-call-permissions).
 *
 * A group is keyed by an exact code-owned tool id or an exact canonical
 * configured-MCP tool id. Each group carries optional `allow`/`reject`, each
 * either `true` (whole-tool) or a list of OR-alternative clauses. A clause has
 * exactly one matcher (`literal` or `regex`) and exactly one target (`field` or
 * `allFields: true`).
 */

export type PermissionFieldTarget = {
  readonly field: string;
};

export type PermissionAllFieldsTarget = {
  readonly allFields: true;
};

export type PermissionClause =
  | (PermissionFieldTarget & { readonly literal: string })
  | (PermissionFieldTarget & { readonly regex: string })
  | (PermissionAllFieldsTarget & { readonly literal: string })
  | (PermissionAllFieldsTarget & { readonly regex: string });

export type PermissionMatcher = true | ReadonlyArray<PermissionClause>;

export interface PermissionGroup {
  readonly allow?: PermissionMatcher;
  readonly reject?: PermissionMatcher;
}

export type ToolPermissionMap = Readonly<Record<string, PermissionGroup>>;

export type PermissionDecisionReason =
  | 'explicit_reject'
  | 'no_allow'
  | 'invalid_field'
  | 'input_limit'
  | 'matched_allow';

export interface PermissionClauseReference {
  readonly groupId: string;
  readonly list: 'allow' | 'reject';
  /** Configured clause index, or null for a whole-tool boolean. */
  readonly clauseIndex: number | null;
}

export interface PermissionDecision {
  readonly policyId: string;
  readonly decision: 'allow' | 'reject';
  readonly reason: PermissionDecisionReason;
  readonly reference: PermissionClauseReference | null;
}

/** The immutable per-process compiled policy consumed at the execution gate. */
export interface CompiledPolicy {
  readonly id: string;
  readonly groups: ReadonlyMap<string, CompiledPermissionGroup>;
}

export interface CompiledPermissionGroup {
  readonly allowWholeTool: boolean;
  readonly rejectWholeTool: boolean;
  readonly allowClauses: ReadonlyArray<CompiledPermissionClause>;
  readonly rejectClauses: ReadonlyArray<CompiledPermissionClause>;
}

export interface CompiledPermissionClause {
  readonly groupId: string;
  readonly list: 'allow' | 'reject';
  readonly clauseIndex: number;
  readonly target: PermissionFieldTarget | PermissionAllFieldsTarget;
  readonly matcher: CompiledValueMatcher;
}

export interface CompiledValueMatcher {
  readonly kind: 'literal' | 'regex';
  /** Exact value semantics. */
  readonly matchesExact: (value: string) => boolean;
  /** Flexible-whitespace semantics reserved for the Bash `command` field. */
  readonly matchesFlexibleWhitespace: (value: string) => boolean;
}
