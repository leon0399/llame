export const WORKSPACE_DETACH_REASONS = [
  'executor_mismatch',
  'executor_absent',
  'root_missing',
  'root_moved',
  'permission_rejected',
  'tool_not_allowed',
] as const;

export type WorkspaceDetachReason = (typeof WORKSPACE_DETACH_REASONS)[number];

export function isWorkspaceDetachReason(
  value: string,
): value is WorkspaceDetachReason {
  return WORKSPACE_DETACH_REASONS.some((reason) => reason === value);
}
