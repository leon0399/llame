/**
 * Per-Run permission modes (openspec/changes/run-permission-modes).
 * `read-only` caps the operator policy for one send and never widens it.
 * `auto` is deferred to #999.
 */
export const PERMISSION_MODES = ['default', 'bypass', 'read-only'] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'default';
