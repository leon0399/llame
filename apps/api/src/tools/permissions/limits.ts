/**
 * Code-owned permission bounds (openspec/changes/tool-call-permissions D2).
 * These are not operator knobs; raising them is a code change with its own
 * review. Exceeding any per-call bound rejects the call without execution.
 */
export const PERMISSION_LIMITS = {
  /** Maximum permission groups (tool identities) in one policy. */
  maxGroups: 256,
  /** Maximum total clauses across the policy, counting whole-tool booleans. */
  maxClauses: 1024,
  /** Maximum UTF-8 bytes in one literal or regex pattern. */
  maxPatternBytes: 4096,
  /** Maximum UTF-8 bytes of selected string content inspected per call. */
  maxSelectedContentBytes: 1024 * 1024,
  /** Maximum values visited during an all-fields traversal. */
  maxVisitedValues: 65_536,
  /** Maximum nested container depth visited during all-fields traversal. */
  maxContainerDepth: 64,
} as const;

/** A permission configuration or pattern failed to compile. */
export class PermissionCompileError extends Error {
  readonly configPath: string;

  constructor(configPath: string, reason: string) {
    super(`${configPath}: ${reason}`);
    this.name = 'PermissionCompileError';
    this.configPath = configPath;
  }
}
