/**
 * Per-Run permission modes (openspec/changes/run-permission-modes).
 * `auto` is deferred to #999.
 */
export const PERMISSION_MODES = ['default', 'bypass'] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'default';
