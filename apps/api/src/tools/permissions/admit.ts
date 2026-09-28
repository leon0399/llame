import { type ToolContext } from '../types';
import { bypassAllow } from './evaluator';
import { type CompiledPolicy, type PermissionDecision } from './types';

export function admitPermission(
  context: ToolContext,
  evaluate: (policy: CompiledPolicy) => PermissionDecision,
): PermissionDecision | undefined {
  const policy = context.permissionPolicy;
  if (policy === undefined) return undefined;
  if (context.permissionMode === 'bypass') return bypassAllow(policy.id);
  return evaluate(policy);
}
