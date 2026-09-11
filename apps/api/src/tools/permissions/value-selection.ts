import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { PERMISSION_LIMITS } from './limits';

export interface SelectedPermissionValue {
  /** The top-level argument property the value belongs to. */
  readonly field: string;
  readonly value: string;
}

export interface SelectionBudget {
  visited: number;
  bytes: number;
  exceeded: boolean;
}

export function createSelectionBudget(): SelectionBudget {
  return { visited: 0, bytes: 0, exceeded: false };
}

/**
 * A field clause matches only an own top-level string property. Missing, null,
 * boolean, numeric, object, and array values never match.
 */
export function selectFieldValue(
  args: unknown,
  field: string,
  budget: SelectionBudget,
): SelectedPermissionValue | undefined {
  if (!isRecord(args)) return undefined;
  if (!Object.hasOwn(args, field)) return undefined;
  const value = args[field];
  if (!isString(value)) return undefined;
  if (!chargeString(value, budget)) return undefined;
  return { field, value };
}

/**
 * Traverse every submitted string value in nested objects and arrays. Keys are
 * never visited as values, non-strings are never stringified, and values are
 * never concatenated.
 */
export function collectAllStringValues(
  args: unknown,
  budget: SelectionBudget,
): Array<SelectedPermissionValue> {
  if (!isRecord(args)) return [];
  return new StringValueCollector(budget).collect(args);
}

class StringValueCollector {
  private readonly budget: SelectionBudget;
  private readonly collected: Array<SelectedPermissionValue> = [];

  constructor(budget: SelectionBudget) {
    this.budget = budget;
  }

  collect(args: UnknownRecord): Array<SelectedPermissionValue> {
    for (const [field, value] of Object.entries(args)) {
      this.visit(value, field, 0);
    }
    return this.collected;
  }

  // eslint-disable-next-line anti-slop/no-unknown-parameters -- recursive walker over opaque JSON; each value's type is established by the `isString`/`Array.isArray`/`isRecord` guards below.
  private visit(value: unknown, topLevelField: string, depth: number): void {
    if (this.budget.exceeded) return;
    this.budget.visited += 1;
    if (this.budget.visited > PERMISSION_LIMITS.maxVisitedValues) {
      this.budget.exceeded = true;
      return;
    }
    if (isString(value)) {
      if (!chargeString(value, this.budget)) return;
      this.collected.push({ field: topLevelField, value });
      return;
    }
    if (Array.isArray(value)) {
      this.descend(value, topLevelField, depth);
      return;
    }
    if (isRecord(value)) {
      this.descend(Object.values(value), topLevelField, depth);
    }
  }

  private descend(
    values: ReadonlyArray<unknown>,
    topLevelField: string,
    depth: number,
  ): void {
    if (depth + 1 > PERMISSION_LIMITS.maxContainerDepth) {
      this.budget.exceeded = true;
      return;
    }
    for (const child of values) {
      this.visit(child, topLevelField, depth + 1);
    }
  }
}

function chargeString(value: string, budget: SelectionBudget): boolean {
  budget.bytes += Buffer.byteLength(value, 'utf8');
  if (budget.bytes > PERMISSION_LIMITS.maxSelectedContentBytes) {
    budget.exceeded = true;
    return false;
  }
  return true;
}
