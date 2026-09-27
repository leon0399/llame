import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  InterpolationError,
  interpolateWorkspaceString,
  type WorkspaceInterpolationResult,
} from '@workspace/config-interpolation';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { processEnvironment } from '../tools/env';

import { createMcpToolId } from './tool-id';
import {
  type McpRuntimeRemoteDefinition,
  type McpRuntimeServerDefinition,
  type McpRuntimeStdioDefinition,
  type MutableStdioDefinition,
} from './mcp-runtime-definition';

export type WorkspaceMcpServerConfig =
  | Readonly<{
      id: string;
      state: 'configured';
      definition: McpRuntimeServerDefinition;
      protectedValues: ReadonlyArray<string>;
    }>
  | Readonly<{
      id: string;
      state: 'unavailable';
      reason: string;
    }>;

type RawEntry = UnknownRecord;
type ResolvedString = WorkspaceInterpolationResult;
type MutableRemoteDefinition = {
  url: string;
  headers?: Readonly<Record<string, string>>;
};

type FileSource = Readonly<{
  label: '.mcp.json' | '.llame/mcp.json';
  file: string;
}>;
type FileResult =
  | Readonly<{ entries: ReadonlyArray<readonly [string, RawEntry | null]> }>
  | Readonly<{ unavailable: WorkspaceMcpServerConfig }>;

class WorkspaceConfigError extends Error {}

const SERVER_KEYS = {
  type: true,
  command: true,
  args: true,
  env: true,
  cwd: true,
} satisfies Readonly<Record<string, true>>;
const REMOTE_KEYS = {
  type: true,
  url: true,
  headers: true,
} satisfies Readonly<Record<string, true>>;
const SERVER_ID_PROBE = 'x';
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const TRANSPORT_OWNED_HEADERS = {
  accept: true,
  'content-type': true,
  'mcp-protocol-version': true,
  'mcp-session-id': true,
  'last-event-id': true,
} satisfies Readonly<Record<string, true>>;

export async function readWorkspaceMcpConfig(
  root: string,
  env: NodeJS.ProcessEnv = processEnvironment(),
): Promise<ReadonlyArray<WorkspaceMcpServerConfig>> {
  const sources: ReadonlyArray<FileSource> = [
    { label: '.mcp.json', file: path.join(root, '.mcp.json') },
    { label: '.llame/mcp.json', file: path.join(root, '.llame', 'mcp.json') },
  ];
  const merged = new Map<string, RawEntry | null>();
  const unavailable: Array<WorkspaceMcpServerConfig> = [];

  for (const source of sources) {
    const result = await readSource(source);
    if ('unavailable' in result) unavailable.push(result.unavailable);
    else for (const [id, entry] of result.entries) merged.set(id, entry);
  }

  const resolved = await Promise.all(
    [...merged].map(([id, entry]) => resolveEntry(id, entry, root, env)),
  );
  return Object.freeze([...resolved, ...unavailable]);
}

async function readSource(source: FileSource): Promise<FileResult> {
  try {
    const text = await readFile(source.file, 'utf8');
    return parseSourceText(source, text);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return { entries: [] };
    return fileUnavailable(source, 'could not be read');
  }
}

function parseSourceText(source: FileSource, text: string): FileResult {
  let parsed: unknown;
  try {
    // SAFETY: JSON.parse is narrowed by isRecord before any member access.
    parsed = JSON.parse(text) as unknown;
  } catch {
    return fileUnavailable(source, 'is malformed');
  }
  if (!isRecord(parsed))
    return fileUnavailable(source, 'must contain an object');
  const named = Object.hasOwn(parsed, 'mcpServers')
    ? parsed['mcpServers']
    : parsed;
  if (!isRecord(named)) {
    return fileUnavailable(source, 'has an invalid mcpServers object');
  }
  return { entries: rawEntries(named) };
}

function fileUnavailable(source: FileSource, detail: string): FileResult {
  return {
    unavailable: {
      id: source.label,
      state: 'unavailable',
      reason: `configuration file ${source.label} ${detail}`,
    },
  };
}

function rawEntries(
  named: RawEntry,
): ReadonlyArray<readonly [string, RawEntry | null]> {
  return Object.entries(named).map(([id, value]) => [
    id,
    isRecord(value) ? value : null,
  ]);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function resolveEntry(
  id: string,
  value: RawEntry | null,
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<WorkspaceMcpServerConfig> {
  const idProbe = createMcpToolId(id, SERVER_ID_PROBE);
  if (!idProbe.success) return unavailable(id, 'invalid server name');
  if (value === null) return unavailable(id, 'invalid server entry');

  try {
    const type = value['type'];
    if (type === undefined && Object.hasOwn(value, 'command')) {
      return configured(id, await resolveStdio(value, root, env));
    }
    if (type === 'stdio') {
      return configured(id, await resolveStdio(value, root, env));
    }
    if (type === 'http' || type === 'streamable-http') {
      return configured(id, await resolveRemote(value, root, env));
    }
    return unavailable(
      id,
      `unsupported transport ${
        type === undefined ? 'missing' : isString(type) ? type : 'invalid'
      }`,
    );
  } catch (error) {
    if (error instanceof WorkspaceConfigError) {
      return unavailable(id, error.message);
    }
    return unavailable(id, 'invalid server entry');
  }
}

function unavailable(id: string, reason: string): WorkspaceMcpServerConfig {
  return Object.freeze({ id, state: 'unavailable', reason });
}

function configured(
  id: string,
  resolved: Readonly<{
    definition: McpRuntimeServerDefinition;
    protectedValues: ReadonlyArray<string>;
  }>,
): WorkspaceMcpServerConfig {
  return Object.freeze({
    id,
    state: 'configured',
    definition: resolved.definition,
    protectedValues: resolved.protectedValues,
  });
}

async function resolveStdio(
  raw: RawEntry,
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<
  Readonly<{
    definition: McpRuntimeStdioDefinition;
    protectedValues: ReadonlyArray<string>;
  }>
> {
  assertKnownKeys(raw, SERVER_KEYS);
  const rawCommand = raw['command'];
  if (!isString(rawCommand) || rawCommand.length === 0) {
    throw new WorkspaceConfigError('command must be a non-empty string');
  }
  const command = await resolveString(rawCommand, root, env);
  const protectedValues = new Set<string>();
  addStdioSubstitutions(protectedValues, command.substitutions);
  const args = await resolveStdioArgs(raw, root, env, protectedValues);
  const childEnv = await resolveStdioEnv(raw, root, env, protectedValues);
  const cwd = await resolveStdioCwd(raw, root, env);
  if (cwd !== undefined) {
    addAllSubstitutions(protectedValues, cwd.substitutions);
  }
  const definition: MutableStdioDefinition = {
    transport: 'stdio',
    command: command.value,
    cwd: cwd === undefined ? path.resolve(root) : path.resolve(root, cwd.value),
  };
  if (args !== undefined) definition.args = args;
  if (childEnv !== undefined) definition.env = childEnv;
  return {
    definition: Object.freeze(definition),
    protectedValues: Object.freeze([...protectedValues]),
  };
}

async function resolveStdioArgs(
  raw: RawEntry,
  root: string,
  env: NodeJS.ProcessEnv,
  protectedValues: Set<string>,
): Promise<ReadonlyArray<string> | undefined> {
  const value = raw['args'];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isString)) {
    throw new WorkspaceConfigError('args must be an array of strings');
  }
  return resolveArgs(value, root, env, protectedValues);
}

async function resolveStdioEnv(
  raw: RawEntry,
  root: string,
  env: NodeJS.ProcessEnv,
  protectedValues: Set<string>,
): Promise<Readonly<Record<string, string>> | undefined> {
  const value = raw['env'];
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new WorkspaceConfigError('env must be an object');
  return resolveEnv(value, root, env, protectedValues);
}

async function resolveStdioCwd(
  raw: RawEntry,
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedString | undefined> {
  const value = raw['cwd'];
  if (value === undefined) return undefined;
  if (!isString(value)) throw new WorkspaceConfigError('cwd must be a string');
  return resolveString(value, root, env);
}

async function resolveArgs(
  raw: ReadonlyArray<string>,
  root: string,
  env: NodeJS.ProcessEnv,
  protectedValues: Set<string>,
): Promise<ReadonlyArray<string>> {
  const args: Array<string> = [];
  for (const value of raw) {
    const resolved = await resolveString(value, root, env);
    addStdioSubstitutions(protectedValues, resolved.substitutions);
    args.push(resolved.value);
  }
  return Object.freeze(args);
}

async function resolveEnv(
  raw: RawEntry,
  root: string,
  env: NodeJS.ProcessEnv,
  protectedValues: Set<string>,
): Promise<Readonly<Record<string, string>>> {
  const childEnv: Record<string, string> = {};
  Object.setPrototypeOf(childEnv, null);
  for (const [name, value] of Object.entries(raw)) {
    if (name.length === 0 || !isString(value)) {
      throw new WorkspaceConfigError(`env.${name} must be a string`);
    }
    const resolved = await resolveString(value, root, env);
    addStdioSubstitutions(protectedValues, resolved.substitutions);
    childEnv[name] = resolved.value;
  }
  return Object.freeze(childEnv);
}

async function resolveRemote(
  raw: RawEntry,
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<
  Readonly<{
    definition: McpRuntimeRemoteDefinition;
    protectedValues: ReadonlyArray<string>;
  }>
> {
  assertKnownKeys(raw, REMOTE_KEYS);
  const protectedValues = new Set<string>();
  const rawUrl = raw['url'];
  if (!isString(rawUrl) || rawUrl.trim().length === 0) {
    throw new WorkspaceConfigError('url must be a non-empty string');
  }
  const url = await resolveString(rawUrl, root, env);
  addAllSubstitutions(protectedValues, url.substitutions);
  assertHttpUrl(url.value);
  const rawHeaders = raw['headers'];
  let headers: Readonly<Record<string, string>> | undefined;
  if (rawHeaders !== undefined) {
    if (!isRecord(rawHeaders)) {
      throw new WorkspaceConfigError('headers must be an object');
    }
    headers = await resolveHeaders(rawHeaders, root, env, protectedValues);
  }
  const definition: MutableRemoteDefinition = { url: url.value };
  if (headers !== undefined) definition.headers = headers;
  return {
    definition: Object.freeze(definition),
    protectedValues: Object.freeze([...protectedValues]),
  };
}

function assertKnownKeys(
  raw: RawEntry,
  allowed: Readonly<Record<string, true>>,
): void {
  const unknown = Object.keys(raw).find((key) => allowed[key] !== true);
  if (unknown !== undefined)
    throw new WorkspaceConfigError(`unknown field ${unknown}`);
}

function assertHttpUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceConfigError('url must be an absolute http or https URL');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new WorkspaceConfigError(
      'url must be an absolute http or https URL without userinfo',
    );
  }
}

async function resolveHeaders(
  raw: RawEntry,
  root: string,
  env: NodeJS.ProcessEnv,
  protectedValues: Set<string>,
): Promise<Readonly<Record<string, string>>> {
  const headers: Record<string, string> = {};
  Object.setPrototypeOf(headers, null);
  const folded = new Map<string, string>();
  for (const [name, value] of Object.entries(raw)) {
    if (!HEADER_NAME.test(name))
      throw new WorkspaceConfigError(`invalid header ${name}`);
    const lower = name.toLowerCase();
    const prior = folded.get(lower);
    if (prior !== undefined) {
      throw new WorkspaceConfigError(
        `header names collide: ${prior} and ${name}`,
      );
    }
    if (TRANSPORT_OWNED_HEADERS[lower] === true) {
      throw new WorkspaceConfigError(`transport-owned header ${name}`);
    }
    if (!isString(value))
      throw new WorkspaceConfigError(`header ${name} must be a string`);
    const resolved = await resolveString(value, root, env);
    if (resolved.value.trim().length === 0) {
      throw new WorkspaceConfigError(`header ${name} must be non-empty`);
    }
    addAllSubstitutions(protectedValues, resolved.substitutions);
    addProtected(protectedValues, resolved.value);
    headers[name] = resolved.value;
    folded.set(lower, name);
  }
  return Object.freeze(headers);
}
function addAllSubstitutions(
  protectedValues: Set<string>,
  substitutions: ResolvedString['substitutions'],
): void {
  for (const substitution of substitutions) {
    addProtected(protectedValues, substitution.value);
  }
}

function addStdioSubstitutions(
  protectedValues: Set<string>,
  substitutions: ResolvedString['substitutions'],
): void {
  for (const substitution of substitutions) {
    if (!substitution.fallback)
      addProtected(protectedValues, substitution.value);
  }
}

function addProtected(values: Set<string>, value: string): void {
  if (value.length > 0) values.add(value);
}

async function resolveString(
  input: string,
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedString> {
  try {
    return await interpolateWorkspaceString(input, root, env);
  } catch (error) {
    if (error instanceof InterpolationError) {
      throw new WorkspaceConfigError(error.message);
    }
    throw error;
  }
}
