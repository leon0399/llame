import {
  type PermissionClause,
  type ToolPermissionMap,
} from '../tools/permissions/types';

/**
 * The recommended portable operator policy, mirrored verbatim in
 * `apps/api/llame.config.json.example`. This is a TEST FIXTURE, not a runtime
 * default: an omitted `tools.permissions` rejects every call. Tests use this
 * map to exercise the documented matrix and to keep the shipped example honest
 * (see `tool-permissions-config.test.ts`).
 *
 * Regexes are engine input, not JSON string escaping.
 */

const B1_SYSTEM_COMMAND = String.raw`(^|[^A-Za-z0-9_])(sudo|shutdown|reboot|halt|poweroff|mkfs([.][A-Za-z0-9_-]+)?)(\s|$)`;
const B2_ROOT_RECURSIVE_REMOVE = String.raw`\brm\s+(?:(?:-[A-Za-z]*[rR][A-Za-z]*[fF][A-Za-z]*|-[A-Za-z]*[fF][A-Za-z]*[rR][A-Za-z]*|-[A-Za-z]*[rR][A-Za-z]*\s+-[A-Za-z]*[fF][A-Za-z]*|-[A-Za-z]*[fF][A-Za-z]*\s+-[A-Za-z]*[rR][A-Za-z]*|--recursive\s+(?:--force|-f)|--force\s+(?:--recursive|-r))\s+(?:--no-preserve-root\s+)?|--no-preserve-root\s+(?:-[A-Za-z]*[rR][A-Za-z]*[fF][A-Za-z]*|-[A-Za-z]*[fF][A-Za-z]*[rR][A-Za-z]*|-[A-Za-z]*[rR][A-Za-z]*\s+-[A-Za-z]*[fF][A-Za-z]*|-[A-Za-z]*[fF][A-Za-z]*\s+-[A-Za-z]*[rR][A-Za-z]*|--recursive\s+(?:--force|-f)|--force\s+(?:--recursive|-r))\s+)(?:--\s+)?['"]?(?://?\*?|~(?:\*|//?\*?)?|\$HOME(?:/\*?)?|\$\{HOME\}(?://?\*?)?)['"]?($|[\s;&|])`;
const B3_DEVICE_WRITE = String.raw`\bdd\s+[^\r\n;&|]*\bof=/dev/`;
const B8_PIPE_TO_SHELL = String.raw`\b(curl|wget)\s+[^\r\n;|]*\x7c\s*(ba|z|da|k)?sh(\s|$)`;
const F1_CREDENTIAL_DIRECTORY = String.raw`(^|[/\\])(\.ssh|\.aws|\.azure|\.gnupg|\.kube)([/\\]|$|:)`;
const F2_CREDENTIAL_FILE = String.raw`(^|[/\\])(\.git-credentials|\.npmrc|\.pypirc)([/\\]|$|:)`;
const F3_TOOL_CREDENTIAL = String.raw`(^|[/\\])(\.docker[/\\]config\.json|\.gem[/\\]credentials|\.config[/\\]gh)([/\\]|$|:)`;
const F4_ENV_FILE = String.raw`(^|[/\\])\.env($|:|\.(local|development|production|staging|test)(\.local)?($|:))`;

function commandRegex(regex: string): PermissionClause {
  return { field: 'command', regex };
}

function commandLiteral(literal: string): PermissionClause {
  return { field: 'command', literal };
}

function pathRegex(regex: string): PermissionClause {
  return { field: 'path', regex };
}

const BASH_REJECTS: ReadonlyArray<PermissionClause> = [
  commandRegex(B1_SYSTEM_COMMAND),
  commandRegex(B2_ROOT_RECURSIVE_REMOVE),
  commandRegex(B3_DEVICE_WRITE),
  commandLiteral('diskutil erase'),
  commandLiteral('diskutil apfs delete'),
  commandLiteral('git reset --hard'),
  commandLiteral('chmod -R 777'),
  commandRegex(B8_PIPE_TO_SHELL),
];

const READ_REJECTS: ReadonlyArray<PermissionClause> = [
  pathRegex(F1_CREDENTIAL_DIRECTORY),
  pathRegex(F2_CREDENTIAL_FILE),
  pathRegex(F3_TOOL_CREDENTIAL),
  pathRegex(F4_ENV_FILE),
];

const MUTATE_REJECTS: ReadonlyArray<PermissionClause> = [
  pathRegex(F1_CREDENTIAL_DIRECTORY),
  pathRegex(F2_CREDENTIAL_FILE),
  pathRegex(F3_TOOL_CREDENTIAL),
];

export const PORTABLE_TOOL_PERMISSIONS: ToolPermissionMap = {
  bash: { allow: true, reject: BASH_REJECTS },
  read: { allow: true, reject: READ_REJECTS },
  edit: { allow: true, reject: MUTATE_REJECTS },
  write: { allow: true, reject: MUTATE_REJECTS },
  knowledge_search: { allow: true },
  search_conversations: { allow: true },
  conversation_read: { allow: true },
};

export const PORTABLE_PERMISSION_TOOL_IDS: ReadonlyArray<string> = Object.keys(
  PORTABLE_TOOL_PERMISSIONS,
);
