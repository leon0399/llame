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
  | 'matched_allow'
  | 'permission_mode_bypass';

/** The reasons that describe a rejection; allow-only reasons are excluded. */
export type PermissionRejectionReason = Exclude<
  PermissionDecisionReason,
  'matched_allow' | 'permission_mode_bypass'
>;

export interface PermissionClauseReference {
  readonly groupId: string;
  readonly list: 'allow' | 'reject';
  /** Configured clause index, or null for a whole-tool boolean. */
  readonly clauseIndex: number | null;
}

export interface EvaluatePermissionOptions {
  readonly toolId: string;
  /** Originally submitted, parsed argument values (never schema defaults). */
  readonly args: unknown;
  /**
   * Whether a top-level field's literal matching uses Bash flexible
   * whitespace. Defaults to the native Bash `command` field.
   */
  readonly isFlexibleWhitespaceField?: (field: string) => boolean;
  /** Project a submitted field value before matching (native logical locators). */
  readonly projectFieldValue?: (field: string, value: string) => string;
  /**
   * Declared string fields for a dynamic tool (MCP). A configured field clause
   * naming anything else fails closed with `invalid_field` rather than being
   * silently dropped or granting an allow.
   */
  readonly validFields?: ReadonlySet<string>;
}

/**
 * A trusted, safe admission decision. Discriminated on `decision` so a reject
 * can never carry an allow-only reason and vice versa. It already contains
 * only safe provenance (opaque policy id, decision, static reason, bounded
 * clause reference) — nothing here needs to be stripped before persistence.
 */
export type PermissionDecision =
  | {
      readonly policyId: string;
      readonly decision: 'allow';
      readonly reason: 'matched_allow' | 'permission_mode_bypass';
      readonly reference: PermissionClauseReference | null;
    }
  | {
      readonly policyId: string;
      readonly decision: 'reject';
      readonly reason: PermissionRejectionReason;
      readonly reference: PermissionClauseReference | null;
    };

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
