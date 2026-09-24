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
const F5A_CLEARTEXT_PUBLIC_IPV4_FIRST_OCTET = String.raw`^http://(?:[1-9]|1[1-9]|[2-9]\d|10[1-9]|11\d|12[0-689]|1[3-5]\d|16[0-8]|17[013-9]|18\d|19[013-9]|2[0-4]\d|25[0-5])\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/]`;
const F5B_CLEARTEXT_CGNAT = String.raw`^http://100\.(?:\d|[1-5]\d|6[0-3]|12[89]|1[3-9]\d|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`;
const F5C_CLEARTEXT_LINK_LOCAL = String.raw`^http://169\.(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-35])\.\d{1,3}\.\d{1,3}[:/]`;
const F5D_CLEARTEXT_PRIVATE_172 = String.raw`^http://172\.(?:\d|1[0-5]|3[2-9]|[4-9]\d|1\d\d|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`;
const F5E_CLEARTEXT_PRIVATE_192 = String.raw`^http://192\.(?:\d|[1-9]\d|1[0-5]\d|16[0-79]|1[7-9]\d|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`;
const F5F_CLEARTEXT_PUBLIC_IPV6 = String.raw`^http://\[(?:::(?:[02-9a-f]|1[^\]])|(?:[0-9a-f]{1,3}|[0-9a-e][0-9a-f]{3}|f[0-9abf][0-9a-f]{2}|fe[0-7c-f][0-9a-f]):)`;
const F6_GROKIPEDIA_HOST = String.raw`^https?://([^/]*\.)?grokipedia\.com\.?([/:]|$)`;
const F7_METADATA_ENDPOINTS = String.raw`^https?://(?:169\.254\.169\.254|169\.254\.170\.2|169\.254\.0\.23|100\.100\.100\.200|\[fd00:ec2::254\])[:/]`;

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
  pathRegex(F5A_CLEARTEXT_PUBLIC_IPV4_FIRST_OCTET),
  pathRegex(F5B_CLEARTEXT_CGNAT),
  pathRegex(F5C_CLEARTEXT_LINK_LOCAL),
  pathRegex(F5D_CLEARTEXT_PRIVATE_172),
  pathRegex(F5E_CLEARTEXT_PRIVATE_192),
  pathRegex(F5F_CLEARTEXT_PUBLIC_IPV6),
  pathRegex(F6_GROKIPEDIA_HOST),
  pathRegex(F7_METADATA_ENDPOINTS),
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
