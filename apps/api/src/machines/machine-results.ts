/**
 * Untrusted-input narrowing for Machine method results. The connector resolves
 * the decoded JSON of a response; a Machine is not a trusted peer, so every
 * field a hub-side caller reads goes through one of these functions. Each one
 * REBUILDS a validated value rather than asserting a shape, so a Machine that
 * answers with the wrong kind of JSON yields `undefined` (or a failure result)
 * instead of a wrong value.
 */

import {
  GIT_METHODS,
  isSerializableRecord,
  type FsBytesResult,
  type FsGrepConsumed,
  type FsGrepPassage,
  type FsGrepResult,
  type FsGrepSuccess,
  type FsGrepWarning,
  type FsGrepWarningKind,
  type FsListEntry,
  type FsListEntryKind,
  type FsListResult,
  type FsReadResult,
  type FsStatKind,
  type FsStatResult,
  type HelloResult,
  type JsonValue,
  type McpOpenResult,
  type McpServerEntry,
  type McpServerState,
  type McpServersResult,
  type McpTransportKind,
  type NativeFailureResult,
  type NativeFailureType,
  type NativeFileReadResult,
  type NativeMediaReadResult,
  type RootsListResult,
  type SerializableRecord,
  type SerializableValue,
} from '@workspace/machine-protocol';

/** Membership tables for the closed vocabularies a result may carry. */
const FS_STAT_KINDS = {
  file: true,
  directory: true,
  other: true,
  missing: true,
} as const;

const FS_LIST_ENTRY_KINDS = {
  file: true,
  directory: true,
  link: true,
  other: true,
} as const;

/** The fence vocabulary the daemon may report; anything else is not a refusal. */
const NATIVE_FAILURE_TYPES = {
  invalid_path: true,
  invalid_selector: true,
  not_found: true,
  not_regular_file: true,
  invalid_utf8: true,
  invalid_input: true,
  file_exists: true,
  old_text_not_found: true,
  old_text_ambiguous: true,
  outcome_unknown: true,
  executor_unavailable: true,
  directory_too_large: true,
  representation_too_large: true,
  media_too_large: true,
  unsupported_media_type: true,
} as const;

const MCP_TRANSPORTS = { stdio: true, http: true } as const;
const MCP_STATES = { available: true, unavailable: true } as const;

const FS_GREP_WARNING_KINDS = {
  binary: true,
  invalid_utf8: true,
  oversized: true,
  unreadable: true,
  link: true,
  file_bound: true,
  entry_bound: true,
  byte_bound: true,
  deadline: true,
} as const;

function isFsStatKind(value: SerializableValue): value is FsStatKind {
  return isText(value) && Object.hasOwn(FS_STAT_KINDS, value);
}

function isFsListEntryKind(value: SerializableValue): value is FsListEntryKind {
  return isText(value) && Object.hasOwn(FS_LIST_ENTRY_KINDS, value);
}

function isNativeFailureType(
  value: SerializableValue,
): value is NativeFailureType {
  return isText(value) && Object.hasOwn(NATIVE_FAILURE_TYPES, value);
}

function isMcpTransportKind(
  value: SerializableValue,
): value is McpTransportKind {
  return isText(value) && Object.hasOwn(MCP_TRANSPORTS, value);
}

function isMcpServerState(value: SerializableValue): value is McpServerState {
  return isText(value) && Object.hasOwn(MCP_STATES, value);
}

function isFsGrepWarningKind(
  value: SerializableValue,
): value is FsGrepWarningKind {
  return isText(value) && Object.hasOwn(FS_GREP_WARNING_KINDS, value);
}

/** A non-negative whole number, the only numeric shape these results carry. */
export function isCount(value: SerializableValue): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isText(value: SerializableValue): value is string {
  return typeof value === 'string';
}

export function isFlag(value: SerializableValue): value is boolean {
  return typeof value === 'boolean';
}

function isTextList(value: SerializableValue): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every(isText);
}

/** An untrusted JSON array, typed for element-wise validation. */
export function isUntrustedList(
  value: JsonValue,
): value is ReadonlyArray<SerializableValue> {
  return Array.isArray(value);
}

/** The refusal branch shared by every native method result. */
export function readNativeFailure(
  value: JsonValue,
): NativeFailureResult | undefined {
  if (!isSerializableRecord(value) || value['status'] !== 'error')
    return undefined;
  const { type, message, count } = value;
  if (!isText(message) || !isNativeFailureType(type)) return undefined;
  if (isCount(count)) return { status: 'error', type, message, count };
  return { status: 'error', type, message };
}

/** Does this result carry a refusal rather than a value? */
export function isNativeFailure(
  value: JsonValue,
): value is NativeFailureResult {
  return readNativeFailure(value) !== undefined;
}

/** The handshake answer: protocol version, daemon version, registered roots,
 *  and the git methods the daemon answers. */
export function readHelloResult(value: JsonValue): HelloResult | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { protocolVersion, daemonVersion, roots, methods } = value;
  if (!isCount(protocolVersion) || !isText(daemonVersion) || !isTextList(roots))
    return undefined;
  const hello: HelloResult = {
    protocolVersion,
    daemonVersion,
    roots: [...roots],
  };
  // A daemon that predates the git methods sends no list at all. A malformed
  // one is read as absent too, because the handshake is still usable: its file
  // tools and `bash` keep working while a git call asks for an update.
  const listed = isTextList(methods)
    ? GIT_METHODS.filter((method) => methods.includes(method))
    : [];
  return listed.length === 0 ? hello : { ...hello, methods: listed };
}

export function readRootsListResult(
  value: JsonValue,
): RootsListResult | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { roots } = value;
  return isTextList(roots) ? { roots: [...roots] } : undefined;
}

export function readFsStatResult(value: JsonValue): FsStatResult | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { kind, isLink, size, realPath } = value;
  if (!isFlag(isLink) || !isFsStatKind(kind)) return undefined;
  const sized = isCount(size);
  const located = isText(realPath);
  if (sized && located) return { kind, isLink, size, realPath };
  if (sized) return { kind, isLink, size };
  if (located) return { kind, isLink, realPath };
  return { kind, isLink };
}

/** One structured directory entry, for discovery (fs.list). */
function readFsListEntry(value: SerializableValue): FsListEntry | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { name, kind } = value;
  if (!isText(name) || !isFsListEntryKind(kind)) return undefined;
  return { name, kind };
}

function readFsListEntries(
  value: JsonValue,
): ReadonlyArray<FsListEntry> | undefined {
  if (!isUntrustedList(value)) return undefined;
  const entries: Array<FsListEntry> = [];
  for (const entry of value) {
    const read = readFsListEntry(entry);
    if (read === undefined) return undefined;
    entries.push(read);
  }
  return entries;
}

/** One own field of an untrusted object, still untrusted. */
function fieldOf(value: JsonValue, key: string): SerializableValue {
  if (!isSerializableRecord(value)) return undefined;
  const fields = Object.entries(value);
  for (const [name, field] of fields) if (name === key) return field;
  return undefined;
}

export function readFsListResult(value: JsonValue): FsListResult | undefined {
  const failure = readNativeFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value)) return undefined;
  const { totalCount, truncated } = value;
  const list = readFsListEntries(fieldOf(value, 'entries') ?? null);
  if (list === undefined || !isCount(totalCount) || !isFlag(truncated))
    return undefined;
  return { entries: list, totalCount, truncated };
}

/** A `fs.read` answer: the local file or media success shape, or a refusal. */
export function readFsReadResult(value: JsonValue): FsReadResult | undefined {
  const failure = readNativeFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['status'] !== 'success')
    return undefined;
  const { kind, path } = value;
  if (!isText(path)) return undefined;
  if (kind === 'image' || kind === 'pdf')
    return readMediaRead(value, kind, path);
  if (kind !== 'file' && kind !== 'directory') return undefined;
  return readFileRead(value, kind, path);
}

/** The media branch: bytes travel through `fs.bytes`, so this is metadata. */
function readMediaRead(
  value: SerializableRecord,
  kind: 'image' | 'pdf',
  path: string,
): NativeMediaReadResult | undefined {
  const { mediaType, realPath } = value;
  if (!isText(mediaType)) return undefined;
  const media: NativeMediaReadResult = {
    status: 'success',
    kind,
    mediaType,
    path,
  };
  return isText(realPath) ? { ...media, realPath } : media;
}

/** The file/directory branch: content, truncation, and the next window. */
function readFileRead(
  value: SerializableRecord,
  kind: 'file' | 'directory',
  path: string,
): NativeFileReadResult | undefined {
  const { content, truncated, nextOffset, realPath } = value;
  if (!isText(content) || !isFlag(truncated)) return undefined;
  if (isText(realPath) && isCount(nextOffset))
    return {
      status: 'success',
      kind,
      path,
      content,
      truncated,
      realPath,
      nextOffset,
    };
  if (isText(realPath))
    return { status: 'success', kind, path, content, truncated, realPath };
  if (isCount(nextOffset))
    return { status: 'success', kind, path, content, truncated, nextOffset };
  return { status: 'success', kind, path, content, truncated };
}

/** A `fs.bytes` answer: the byte length and media type, or a refusal. */
export function readFsBytesResult(value: JsonValue): FsBytesResult | undefined {
  const failure = readNativeFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value)) return undefined;
  const { size, mediaType } = value;
  return isCount(size) && isText(mediaType) ? { size, mediaType } : undefined;
}

function readMcpServerEntry(
  value: SerializableValue,
): McpServerEntry | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { name, state, transport, diagnostic } = value;
  if (!isText(name) || !isMcpServerState(state)) return undefined;
  const entry: McpServerEntry = { name, state };
  if (isMcpTransportKind(transport))
    return withDiagnostic({ ...entry, transport }, diagnostic);
  return withDiagnostic(entry, diagnostic);
}

function withDiagnostic(
  entry: McpServerEntry,
  diagnostic: SerializableValue,
): McpServerEntry {
  return isText(diagnostic) ? { ...entry, diagnostic } : entry;
}

function readMcpServerEntries(
  value: JsonValue,
): ReadonlyArray<McpServerEntry> | undefined {
  if (!isUntrustedList(value)) return undefined;
  const servers: Array<McpServerEntry> = [];
  for (const entry of value) {
    const read = readMcpServerEntry(entry);
    if (read === undefined) return undefined;
    servers.push(read);
  }
  return servers;
}

export function readMcpServersResult(
  value: JsonValue,
): McpServersResult | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const entries = readMcpServerEntries(fieldOf(value, 'servers') ?? null);
  return entries === undefined ? undefined : { servers: entries };
}

/** The protected values of the definition `mcp.open` actually started. */
export function readMcpOpenResult(value: JsonValue): McpOpenResult | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { protectedValues } = value;
  return isTextList(protectedValues)
    ? { protectedValues: [...protectedValues] }
    : undefined;
}

/**
 * A path a passage names, relative to the request's prefix. The hub concatenates
 * it onto the prefix it sent, so an absolute path, a `.`/`..` segment, or an
 * empty middle segment is refused: it could name something the request never
 * searched.
 */
function isScopeRelativePath(value: string): boolean {
  if (value.includes('\u0000')) return false;
  // A leading `/` yields an empty first segment, which the rule below refuses.
  if (value === '') return true;
  return value
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function readGrepPassage(value: SerializableValue): FsGrepPassage | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { path, startLine, endLine, content, matches, truncated, capped, cut } =
    value;
  if (!isText(path) || !isScopeRelativePath(path)) return undefined;
  if (!isCount(startLine) || startLine < 1) return undefined;
  if (!isCount(endLine) || endLine < startLine) return undefined;
  const matchLines = matches ?? null;
  if (!isText(content) || !isUntrustedList(matchLines)) return undefined;
  const lines: Array<number> = [];
  for (const match of matchLines) {
    if (!isCount(match) || match < startLine || match > endLine)
      return undefined;
    lines.push(match);
  }
  if (truncated !== undefined && truncated !== true) return undefined;
  if (capped !== undefined && capped !== true) return undefined;
  if (cut !== undefined && cut !== true) return undefined;
  return {
    path,
    startLine,
    endLine,
    content,
    matches: lines,
    ...(truncated === true && { truncated: true as const }),
    ...(capped === true && { capped: true as const }),
    ...(cut === true && { cut: true as const }),
  };
}

function readGrepPassages(
  value: JsonValue,
): ReadonlyArray<FsGrepPassage> | undefined {
  if (!isUntrustedList(value)) return undefined;
  const passages: Array<FsGrepPassage> = [];
  for (const entry of value) {
    const passage = readGrepPassage(entry);
    if (passage === undefined) return undefined;
    passages.push(passage);
  }
  return passages;
}

function readGrepWarnings(
  value: JsonValue,
): ReadonlyArray<FsGrepWarning> | undefined {
  if (!isUntrustedList(value)) return undefined;
  const warnings: Array<FsGrepWarning> = [];
  for (const entry of value) {
    if (!isSerializableRecord(entry)) return undefined;
    const { kind, count } = entry;
    if (!isFsGrepWarningKind(kind) || !isCount(count)) return undefined;
    warnings.push({ kind, count });
  }
  return warnings;
}

function readGrepConsumed(value: JsonValue): FsGrepConsumed | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { files, entries, bytes } = value;
  if (!isCount(files) || !isCount(entries) || !isCount(bytes)) return undefined;
  return { files, entries, bytes };
}

/** An `fs.grep` answer: the passages the daemon walked, or a refusal. */
export function readFsGrepResult(value: JsonValue): FsGrepResult | undefined {
  const failure = readNativeFailure(value);
  if (failure !== undefined) return failure;
  if (!isSerializableRecord(value) || value['ok'] !== true) return undefined;
  const { complete, cursor } = value;
  const results = readGrepPassages(fieldOf(value, 'results') ?? null);
  const warnings = readGrepWarnings(fieldOf(value, 'warnings') ?? null);
  const consumed = readGrepConsumed(fieldOf(value, 'consumed') ?? null);
  if (
    results === undefined ||
    warnings === undefined ||
    consumed === undefined ||
    !isFlag(complete)
  )
    return undefined;
  if (cursor !== undefined && !isText(cursor)) return undefined;
  const success: FsGrepSuccess = {
    ok: true,
    results,
    complete,
    warnings,
    consumed,
  };
  return isText(cursor) ? { ...success, cursor } : success;
}
