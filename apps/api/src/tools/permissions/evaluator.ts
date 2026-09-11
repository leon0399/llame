import { isRecord } from '@workspace/runtime-safety';

import {
  collectAllStringValues,
  createSelectionBudget,
  selectFieldValue,
  type SelectedPermissionValue,
  type SelectionBudget,
} from './value-selection';
import {
  type CompiledPermissionClause,
  type CompiledPermissionGroup,
  type CompiledPolicy,
  type PermissionClauseReference,
  type PermissionDecision,
  type PermissionRejectionReason,
} from './types';

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
 * Deterministic allow/reject decision (D4): every applicable reject is checked
 * before any allow; any matching reject vetoes; otherwise a whole-tool allow or
 * any field allow grants; otherwise the call is rejected. Clause order never
 * changes the outcome. An absent group rejects.
 */
export function evaluatePermission(
  policy: CompiledPolicy,
  options: EvaluatePermissionOptions,
): PermissionDecision {
  const group = policy.groups.get(options.toolId);
  if (group === undefined) {
    return reject(policy.id, 'no_allow', null);
  }
  return evaluateGroup(policy.id, options.toolId, group, options);
}

function evaluateGroup(
  policyId: string,
  toolId: string,
  group: CompiledPermissionGroup,
  options: EvaluatePermissionOptions,
): PermissionDecision {
  // A whole-tool reject is unconditional and wins over a field-configuration
  // diagnostic; an invalid configured field is only surfaced otherwise.
  if (group.rejectWholeTool) {
    return reject(
      policyId,
      'explicit_reject',
      wholeToolReference(toolId, 'reject'),
    );
  }

  const clauses = [...group.rejectClauses, ...group.allowClauses];
  if (clauses.length === 0) {
    return group.allowWholeTool
      ? allow(policyId, wholeToolReference(toolId, 'allow'))
      : reject(policyId, 'no_allow', null);
  }

  const invalidField = invalidFieldReference(clauses, options.validFields);
  if (invalidField !== null) {
    return reject(policyId, 'invalid_field', invalidField);
  }
  return decideGroup({ policyId, toolId, group, options, clauses });
}

interface GroupDecisionInput {
  readonly policyId: string;
  readonly toolId: string;
  readonly group: CompiledPermissionGroup;
  readonly options: EvaluatePermissionOptions;
  readonly clauses: ReadonlyArray<CompiledPermissionClause>;
}

function decideGroup(input: GroupDecisionInput): PermissionDecision {
  const { policyId, toolId, group, options, clauses } = input;
  const selection = new ClauseSelection(options, clauses);
  const rejected = firstMatch(selection, group.rejectClauses);
  if (rejected !== undefined) {
    return reject(policyId, 'explicit_reject', clauseReference(rejected));
  }
  if (selection.exceeded) return reject(policyId, 'input_limit', null);

  if (group.allowWholeTool) {
    return allow(policyId, wholeToolReference(toolId, 'allow'));
  }
  const allowed = firstMatch(selection, group.allowClauses);
  if (allowed !== undefined) {
    return allow(policyId, clauseReference(allowed));
  }
  if (selection.exceeded) return reject(policyId, 'input_limit', null);
  return reject(policyId, 'no_allow', null);
}

function firstMatch(
  selection: ClauseSelection,
  clauses: ReadonlyArray<CompiledPermissionClause>,
): CompiledPermissionClause | undefined {
  for (const clause of clauses) {
    if (selection.matches(clause)) return clause;
  }
  return undefined;
}

function invalidFieldReference(
  clauses: ReadonlyArray<CompiledPermissionClause>,
  validFields: ReadonlySet<string> | undefined,
): PermissionClauseReference | null {
  if (validFields === undefined) return null;
  for (const clause of clauses) {
    if ('field' in clause.target && !validFields.has(clause.target.field)) {
      return clauseReference(clause);
    }
  }
  return null;
}

/**
 * Selects clause values once under a single per-call traversal/byte budget, so
 * a later clause cannot evade an earlier limit. Projection runs at most once
 * per field, and a top-level string already visited by an all-fields traversal
 * is reused for a field clause instead of being charged again. Exceeding a
 * bound marks the selection failed; the caller rejects rather than granting a
 * partial allow.
 */
class ClauseSelection {
  private readonly args: unknown;
  private readonly project: (field: string, value: string) => string;
  private readonly isFlexibleField: (field: string) => boolean;
  private readonly budget: SelectionBudget = createSelectionBudget();
  private readonly allFieldsValues: ReadonlyArray<SelectedPermissionValue>;
  private readonly fieldCache = new Map<
    string,
    SelectedPermissionValue | undefined
  >();

  constructor(
    options: EvaluatePermissionOptions,
    clauses: ReadonlyArray<CompiledPermissionClause>,
  ) {
    this.args = options.args;
    this.project = options.projectFieldValue ?? ((_field, value) => value);
    this.isFlexibleField =
      options.isFlexibleWhitespaceField ??
      ((field) => options.toolId === 'bash' && field === 'command');
    const usesAllFields = clauses.some(
      (clause) => 'allFields' in clause.target,
    );
    this.allFieldsValues =
      !isRecord(this.args) || !usesAllFields
        ? []
        : collectAllStringValues(this.args, this.budget).map((selected) => ({
            field: selected.field,
            value: this.project(selected.field, selected.value),
          }));
  }

  get exceeded(): boolean {
    return this.budget.exceeded;
  }

  matches(clause: CompiledPermissionClause): boolean {
    const values =
      'allFields' in clause.target
        ? this.allFieldsValues
        : this.fieldValues(clause.target.field);
    return values.some((selected) => this.match(clause, selected));
  }

  private fieldValues(field: string): ReadonlyArray<SelectedPermissionValue> {
    if (!this.fieldCache.has(field)) {
      const fromAllFields = this.allFieldsValues.find(
        (selected) => selected.field === field,
      );
      this.fieldCache.set(
        field,
        fromAllFields ?? this.projectSelected(field, this.budget),
      );
    }
    const selected = this.fieldCache.get(field);
    return selected === undefined ? [] : [selected];
  }

  private projectSelected(
    field: string,
    budget: SelectionBudget,
  ): SelectedPermissionValue | undefined {
    const selected = selectFieldValue(this.args, field, budget);
    return selected === undefined
      ? undefined
      : {
          field: selected.field,
          value: this.project(selected.field, selected.value),
        };
  }

  private match(
    clause: CompiledPermissionClause,
    selected: SelectedPermissionValue,
  ): boolean {
    return this.isFlexibleField(selected.field)
      ? clause.matcher.matchesFlexibleWhitespace(selected.value)
      : clause.matcher.matchesExact(selected.value);
  }
}

function clauseReference(
  clause: CompiledPermissionClause,
): PermissionClauseReference {
  return {
    groupId: clause.groupId,
    list: clause.list,
    clauseIndex: clause.clauseIndex,
  };
}

function wholeToolReference(
  groupId: string,
  list: 'allow' | 'reject',
): PermissionClauseReference {
  return { groupId, list, clauseIndex: null };
}

function allow(
  policyId: string,
  reference: PermissionClauseReference | null,
): PermissionDecision {
  return { policyId, decision: 'allow', reason: 'matched_allow', reference };
}

function reject(
  policyId: string,
  reason: PermissionRejectionReason,
  reference: PermissionClauseReference | null,
): PermissionDecision {
  return { policyId, decision: 'reject', reason, reference };
}
