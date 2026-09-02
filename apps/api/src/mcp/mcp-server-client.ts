import {
  createMCPClient,
  type ListToolsResult,
  type MCPClient,
} from '@ai-sdk/mcp';

import { type ToolResult } from '../tools/types';
import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '../unknown-record';
import {
  admitMcpToolDefinitions,
  type AdmittedMcpToolDefinition,
  type McpDeclarationAdmissionResult,
  type McpDeclarationRefusalReason,
} from './declaration-admission';
import {
  McpBodyLimitError,
  McpRequestLimitError,
  createMcpBoundedFetch,
} from './mcp-bounded-fetch';
import {
  classifyMcpFailure,
  type McpFailureDisposition,
  type McpFailureKind,
  type McpFailureStage,
} from './mcp-failure-policy';
import {
  containsProtectedValueJson,
  normalizeProtectedValues,
  sanitizeProtectedValueJson,
} from './protected-values';
import {
  type BoundedStdioTransport,
  DiagnosticBuffer,
  createStdioTransport,
  type McpStdioTransportConfig,
} from './mcp-stdio-transport';
import { createMcpToolId } from './tool-id';

const ONE_MIB = 1024 * 1024;
const MAX_TOOLS_PER_PAGE = 256;
const MAX_TOOLS_TOTAL = 1000;
const MAX_DISCOVERY_PAGES = 1000;
const DISCOVERY_DEADLINE_MS = 30_000;
const CLOSE_DEADLINE_MS = 5000;
const MAX_DECLARATION_BYTES = 256 * 1024;
const MAX_SCHEMA_DEPTH = 64;
const MAX_DISCOVERY_RESPONSE_BYTES = 8 * ONE_MIB;
const MAX_RETAINED_CATALOG_BYTES = 4 * ONE_MIB;

export type McpDiscoveryLimit =
  | 'deadline'
  | 'response_bytes'
  | 'tools_per_page'
  | 'tools_total'
  | 'retained_catalog_bytes'
  | 'pages'
  | 'repeated_cursor';

export class McpDiscoveryLimitError extends Error {
  readonly disposition = 'reconnect' as const;
  readonly stage = 'discovery' as const;

  constructor(readonly limit: McpDiscoveryLimit) {
    super('MCP discovery exceeded a fixed resource limit.');
    this.name = 'McpDiscoveryLimitError';
  }
}

export const MCP_SERVER_CLIENT_PROTOCOL_VERSIONS = [
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
] as const;

export class McpProtocolUnsupportedError extends Error {
  readonly disposition = 'reconnect' as const;
  readonly stage = 'initialize' as const;

  constructor() {
    super('The MCP server negotiated an unsupported protocol version.');
    this.name = 'McpProtocolUnsupportedError';
  }
}

export class McpServerOperationError extends Error {
  readonly disposition: McpFailureDisposition;

  constructor(
    readonly stage: McpFailureStage,
    readonly kind: McpFailureKind,
  ) {
    super(`MCP ${stage} failed.`);
    this.name = 'McpServerOperationError';
    this.disposition = classifyMcpFailure({ stage, kind });
  }
}

type PackageTool = ReturnType<MCPClient['toolsFromDefinitions']>[string];
type PackageToolExecutor = NonNullable<PackageTool['execute']>;
export type McpToolExecutionOptions = Parameters<PackageToolExecutor>[1];

export type McpCallOutcome = {
  readonly disposition: 'none' | 'call_local' | 'reconnect';
  readonly result: ToolResult;
};

export type McpToolExecutor = (
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- per-tool executor contract: each MCP tool declares its own JSON-Schema-validated argument shape at admission time (declaration-admission.ts), so `args` is deliberately generic here; narrowing it would require a discriminated union over every possible tool schema.
  args: unknown,
  options: McpToolExecutionOptions,
) => Promise<McpCallOutcome>;

export type McpDiscoveredTool = {
  readonly definition: AdmittedMcpToolDefinition;
  readonly execute: McpToolExecutor;
};

export type McpDiscoveryResult = {
  readonly tools: ReadonlyArray<McpDiscoveredTool>;
  readonly refused: ReadonlyArray<{
    readonly index: number;
    readonly id?: string;
    readonly reason:
      | McpDeclarationRefusalReason
      | 'declaration_too_large'
      | 'schema_too_deep';
  }>;
};

export type McpServerClientConfig = {
  readonly serverId: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly onDisconnect?: () => void;
  readonly signal?: AbortSignal;
};

export type McpStdioServerClientConfig = McpStdioTransportConfig & {
  readonly serverId: string;
  /**
   * Values the configuration layer resolved from `{env:…}` / `{path:…}` tokens.
   * Literal configuration text is deliberately absent: protected values are
   * substring-matched across tool traffic, so protecting a low-entropy literal
   * would refuse legitimate calls and corrupt legitimate results.
   */
  readonly protectedValues?: ReadonlyArray<string>;
  readonly onDisconnect?: () => void;
  readonly onDiagnostic?: (text: string) => void;
  readonly signal?: AbortSignal;
};

type ProtectedValueState = {
  sessionId?: string;
};

type DiscoveryByteState = {
  active?: { bytes: number };
};

type DisconnectState = {
  connected: boolean;
  closing: boolean;
  notified: boolean;
  pending: boolean;
};

class McpSessionChangedError extends Error {
  constructor() {
    super('The MCP server changed its active session id.');
    this.name = 'McpSessionChangedError';
  }
}

class McpMatchingResponseError extends Error {
  constructor() {
    super('The MCP server did not return the matching response.');
    this.name = 'McpMatchingResponseError';
  }
}

type RpcRequestSummary = {
  id?: string | number;
  method?: string;
};

function rpcRequest(init: RequestInit | undefined): RpcRequestSummary {
  if (!isString(init?.body)) return {};
  try {
    // SAFETY: JSON.parse returns any; asserting unknown forces isRecord's
    // check below rather than silently inheriting any.
    const body = JSON.parse(init.body) as unknown;
    if (!isRecord(body)) return {};
    const method = body['method'];
    const id = body['id'];
    const summary: RpcRequestSummary = {};
    if (isString(method)) summary.method = method;
    if (isString(id) || isNumber(id)) summary.id = id;
    return summary;
  } catch {
    return {};
  }
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- measures the serialized byte size of an arbitrary already-admitted value for the discovery byte budget; value-agnostic by design, no domain type to parse into.
function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function assertDiscoveryActive(signal: AbortSignal, startedAt: number): void {
  signal.throwIfAborted();
  if (performance.now() - startedAt >= DISCOVERY_DEADLINE_MS) {
    throw new McpDiscoveryLimitError('deadline');
  }
}

/** The one in-flight discovery pass's cancellation signal and deadline
 *  clock — travels together through `discoverCompleteCatalog`'s phases. */
type DiscoveryAttempt = {
  readonly signal: AbortSignal;
  readonly startedAt: number;
};

function safeDiscoveryRefusalId(
  serverId: string,
  remoteName: string,
  protectedValues: ReadonlyArray<string>,
): string | undefined {
  if (containsProtectedValueJson(remoteName, protectedValues)) return undefined;
  const toolId = createMcpToolId(serverId, remoteName);
  if (!toolId.success) return undefined;
  return containsProtectedValueJson(toolId.id, protectedValues)
    ? undefined
    : toolId.id;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- this function IS the recursive depth-walker over untrusted JSON (see the iterative Array.isArray/isRecord dispatch in its loop below); there is no earlier validation to point to, since depth-checking must handle every JSON shape by definition.
function exceedsDepth(value: unknown, maxDepth: number): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 1 },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.depth > maxDepth) return true;
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
    } else if (isRecord(current.value)) {
      for (const item of Object.values(current.value)) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
    }
  }
  return false;
}

function errorRecord(error: unknown): UnknownRecord | undefined {
  return isRecord(error) ? error : undefined;
}

function findCause<T>(
  error: unknown,
  predicate: (candidate: unknown) => candidate is T,
): T | undefined {
  const seen = new Set<unknown>();
  let candidate = error;
  for (let depth = 0; depth < 8 && !seen.has(candidate); depth += 1) {
    if (predicate(candidate)) return candidate;
    seen.add(candidate);
    candidate = errorRecord(candidate)?.['cause'];
  }
  return undefined;
}

/**
 * Evaluated in order, first match wins — a direct transcription of
 * `failureKind`'s former if-chain into data, so the classification RULES
 * (what marks a cause as this kind) are separated from the walk that applies
 * them.
 */
const FAILURE_CAUSE_CLASSIFICATION_RULES: ReadonlyArray<{
  readonly kind: McpFailureKind;
  readonly matchesCause: (error: unknown) => boolean;
}> = [
  {
    kind: 'body_limit',
    matchesCause: (error) =>
      findCause(
        error,
        (candidate): candidate is McpBodyLimitError =>
          candidate instanceof McpBodyLimitError,
      ) !== undefined,
  },
  {
    kind: 'malformed_protocol',
    matchesCause: (error) =>
      findCause(
        error,
        (candidate): candidate is McpRequestLimitError =>
          candidate instanceof McpRequestLimitError,
      ) !== undefined,
  },
  {
    kind: 'malformed_protocol',
    matchesCause: (error) =>
      findCause(
        error,
        (
          candidate,
        ): candidate is McpSessionChangedError | McpMatchingResponseError =>
          candidate instanceof McpSessionChangedError ||
          candidate instanceof McpMatchingResponseError,
      ) !== undefined,
  },
  {
    kind: 'http',
    matchesCause: (error) => failureHttpStatus(error) !== undefined,
  },
  {
    kind: 'invalid_output',
    matchesCause: (error) =>
      findCause(
        error,
        (candidate): candidate is UnknownRecord =>
          errorRecord(candidate)?.['name'] === 'ZodError',
      ) !== undefined,
  },
  {
    kind: 'malformed_protocol',
    matchesCause: (error) =>
      findCause(
        error,
        (candidate): candidate is UnknownRecord =>
          errorRecord(candidate)?.['name'] === 'SyntaxError',
      ) !== undefined,
  },
  {
    kind: 'tool_error',
    matchesCause: (error) =>
      findCause(
        error,
        (candidate): candidate is UnknownRecord =>
          typeof errorRecord(candidate)?.['code'] === 'number',
      ) !== undefined,
  },
];

function failureKind(
  error: unknown,
  callerSignal: AbortSignal | undefined,
): McpFailureKind {
  if (callerSignal?.aborted) {
    const reason = errorRecord(callerSignal.reason);
    return reason?.['name'] === 'TimeoutError' ? 'timeout' : 'cancelled';
  }
  const rule = FAILURE_CAUSE_CLASSIFICATION_RULES.find((candidate) =>
    candidate.matchesCause(error),
  );
  return rule?.kind ?? 'network';
}

function failureHttpStatus(error: unknown): number | undefined {
  const failure = findCause(
    error,
    (candidate): candidate is UnknownRecord =>
      typeof errorRecord(candidate)?.['statusCode'] === 'number',
  );
  const status = failure?.['statusCode'];
  return isNumber(status) ? status : undefined;
}

function safeOperationError(
  stage: Exclude<McpFailureStage, 'call'>,
  error: unknown,
  callerSignal?: AbortSignal,
): McpServerOperationError {
  const kind = failureKind(error, callerSignal);
  return new McpServerOperationError(
    stage,
    kind === 'tool_error' || kind === 'is_error' || kind === 'invalid_output'
      ? 'malformed_protocol'
      : kind,
  );
}

function safeFailureResult(kind: McpFailureKind): ToolResult {
  switch (kind) {
    case 'cancelled':
      return {
        status: 'error',
        type: 'cancelled',
        message: 'The remote tool call was cancelled.',
      };
    case 'timeout':
      return {
        status: 'error',
        type: 'timeout',
        message: 'The remote tool call timed out.',
      };
    case 'tool_error':
    case 'is_error':
      return {
        status: 'error',
        type: 'remote_error',
        message: 'The remote tool reported an error.',
      };
    default:
      return {
        status: 'error',
        type: 'execution_failed',
        message: 'The remote tool failed to execute.',
      };
  }
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the compound guard `isRecord(value) && (Array.isArray(...) || ...)` below -- `isRecord` combined with further checks via `&&`, a shape the structural exemption's single-check parse doesn't cover.
function hasPortableMcpResultPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    (Array.isArray(value['content']) ||
      (Object.hasOwn(value, 'toolResult') && value['toolResult'] !== undefined))
  );
}

function hasProtectedKeyInErrorData(
  error: unknown,
  protectedValues: ReadonlyArray<string>,
): boolean {
  const seen = new Set<unknown>();
  let candidate = error;
  for (let depth = 0; depth < 8 && !seen.has(candidate); depth += 1) {
    seen.add(candidate);
    const record = errorRecord(candidate);
    if (record === undefined) return false;
    if (Object.hasOwn(record, 'data')) {
      const sanitized = sanitizeProtectedValueJson(
        record['data'],
        protectedValues,
      );
      if (!sanitized.success) return true;
    }
    candidate = record['cause'];
  }
  return false;
}

function matchingRpcResponse(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- first use is the ternary `Array.isArray(value) ? value : [value]` below -- the validating `Array.isArray` check is the ternary's test, a shape the structural exemption doesn't unwrap (same gap as canonical-json.ts's overload siblings).
  value: unknown,
  requestId: string | number,
): UnknownRecord | undefined {
  const messages = Array.isArray(value) ? value : [value];
  return messages.find(
    (message): message is UnknownRecord =>
      isRecord(message) &&
      message['id'] === requestId &&
      (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')),
  );
}

function assertSupportedInitializeResponse(message: UnknownRecord): void {
  const result = message['result'];
  if (!isRecord(result)) return;
  const protocolVersion = result['protocolVersion'];
  if (
    isString(protocolVersion) &&
    !isSupportedMcpProtocolVersion(protocolVersion)
  ) {
    throw new McpProtocolUnsupportedError();
  }
}

function jsonResponse(
  response: Response,
  message: UnknownRecord | null,
): Response {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(JSON.stringify(message), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function monitorInboundSseResponse(
  response: Response,
  onDisconnect: () => void,
): Response {
  if (response.body === null) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          onDisconnect();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        onDisconnect();
        controller.error(error);
      }
    },
    async cancel(reason) {
      onDisconnect();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function normalizeJsonRpcResponse(
  response: Response,
  requestId: string | number,
  isInitialize: boolean,
): Promise<Response> {
  const message = matchingRpcResponse(await response.json(), requestId);
  if (message === undefined) throw new McpMatchingResponseError();
  if (isInitialize) assertSupportedInitializeResponse(message);
  return jsonResponse(response, message);
}

function sseData(event: string): string | undefined {
  const data: Array<string> = [];
  let eventType: string | undefined;
  for (const line of event.split(/\r\n|\r|\n/u)) {
    if (line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? '' : line.slice(separator + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'event') eventType = value.length === 0 ? undefined : value;
    if (field === 'data') data.push(value);
  }
  if (eventType !== undefined && eventType !== 'message') return undefined;
  return data.length === 0 ? undefined : data.join('\n');
}

function sseEventBoundary(
  input: string,
): { readonly eventEnd: number; readonly consumed: number } | undefined {
  let lineStart = 0;
  let cursor = 0;
  while (cursor < input.length) {
    const character = input[cursor];
    if (character !== '\r' && character !== '\n') {
      cursor += 1;
      continue;
    }
    const terminatorLength =
      character === '\r' && input[cursor + 1] === '\n' ? 2 : 1;
    if (cursor === lineStart) {
      return { eventEnd: lineStart, consumed: cursor + terminatorLength };
    }
    cursor += terminatorLength;
    lineStart = cursor;
  }
  return undefined;
}

/**
 * Consume every complete SSE event currently in `pending`, returning the
 * matching JSON-RPC response if one of them carries it, alongside the
 * leftover (possibly still-partial) buffer to keep accumulating against.
 * Split out of `readMatchingSseResponse`'s read loop below purely to keep
 * this buffer-draining loop's own nesting shallow — behavior unchanged.
 */
function matchPendingSseEvents(pending: string, requestId: string | number) {
  let remaining = pending;
  while (true) {
    const boundary = sseEventBoundary(remaining);
    if (boundary === undefined) return { matching: undefined, remaining };
    const event = remaining.slice(0, boundary.eventEnd);
    remaining = remaining.slice(boundary.consumed);
    const data = sseData(event);
    if (data === undefined) continue;
    let message: unknown;
    try {
      // SAFETY: JSON.parse returns any; asserting unknown forces
      // matchingRpcResponse's own narrowing rather than silently
      // inheriting any.
      message = JSON.parse(data) as unknown;
    } catch {
      throw new McpMatchingResponseError();
    }
    const matching = matchingRpcResponse(message, requestId);
    if (matching !== undefined) return { matching, remaining };
  }
}

async function readMatchingSseResponse(
  response: Response,
  requestId: string | number,
): Promise<UnknownRecord> {
  if (response.body === null) throw new McpMatchingResponseError();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new McpMatchingResponseError();
      pending += value;
      const result = matchPendingSseEvents(pending, requestId);
      pending = result.remaining;
      if (result.matching !== undefined) return result.matching;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function normalizePostSseResponse(
  response: Response,
  requestId: string | number,
  isInitialize: boolean,
): Promise<Response> {
  const message = await readMatchingSseResponse(response, requestId);
  if (isInitialize) assertSupportedInitializeResponse(message);
  return jsonResponse(response, message);
}

/**
 * Per-connection lifecycle state shared by both transports.
 *
 * The disconnect protocol is the non-obvious part: a drop detected before the
 * client object exists is recorded as `pending` and flushed once construction
 * completes, so a server that dies mid-handshake still reports exactly one
 * disconnect. Both factories need it identically, so it lives here rather than
 * in two copies that can drift apart.
 */
type ConnectionState = {
  readonly protectedValueState: ProtectedValueState;
  readonly discoveryByteState: DiscoveryByteState;
  readonly disconnectState: DisconnectState;
  readonly closeController: AbortController;
  readonly deadlineController: AbortController;
  readonly deadlineTimer: ReturnType<typeof setTimeout>;
  readonly initializationSignal: AbortSignal;
  readonly notifyDisconnect: () => void;
};

/** The "notify at most once, buffering until connected" disconnect protocol
 *  `ConnectionState`'s own doc comment above describes. */
function createDisconnectNotifier(
  disconnectState: DisconnectState,
  onDisconnect: (() => void) | undefined,
): () => void {
  return () => {
    if (disconnectState.closing || disconnectState.notified) return;
    if (!disconnectState.connected) {
      disconnectState.pending = true;
      return;
    }
    disconnectState.notified = true;
    try {
      onDisconnect?.();
    } catch {
      // Lifecycle notification must not escape into the transport consumer.
    }
  };
}

function beginConnection(config: {
  readonly signal?: AbortSignal;
  readonly onDisconnect?: () => void;
}): ConnectionState {
  const protectedValueState: ProtectedValueState = {};
  const discoveryByteState: DiscoveryByteState = {};
  const disconnectState: DisconnectState = {
    connected: false,
    closing: false,
    notified: false,
    pending: false,
  };
  const closeController = new AbortController();
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadlineController.abort(),
    DISCOVERY_DEADLINE_MS,
  );
  const initializationSignal =
    config.signal === undefined
      ? deadlineController.signal
      : AbortSignal.any([deadlineController.signal, config.signal]);
  return {
    protectedValueState,
    discoveryByteState,
    disconnectState,
    closeController,
    deadlineController,
    deadlineTimer,
    initializationSignal,
    notifyDisconnect: createDisconnectNotifier(
      disconnectState,
      config.onDisconnect,
    ),
  };
}

function isSupportedMcpProtocolVersion(version: string): boolean {
  return MCP_SERVER_CLIENT_PROTOCOL_VERSIONS.some(
    (supported) => supported === version,
  );
}

/** A DELETE request is also aborted by the connection's own close signal —
 *  merge it with any caller-supplied signal (or use it alone if none was
 *  given). Every other method's `init` passes through unchanged. */
function withCloseAbortSignal(
  init: RequestInit | undefined,
  closeController: AbortController,
): RequestInit | undefined {
  if (init?.method !== 'DELETE') return init;
  return {
    ...init,
    signal:
      init.signal === undefined || init.signal === null
        ? closeController.signal
        : AbortSignal.any([init.signal, closeController.signal]),
  };
}

/** GET is the SSE listen stream: a 405 means the server doesn't offer one
 *  (not a disconnect); any other non-SSE or non-ok response IS treated as
 *  one, same as a stream that later ends. */
function handleGetProtocolResponse(
  response: Response,
  notifyDisconnect: () => void,
): Response {
  if (response.status === 405) return response;
  const contentType = response.headers.get('content-type')?.toLowerCase();
  if (
    !response.ok ||
    response.body === null ||
    contentType?.includes('text/event-stream') !== true
  ) {
    notifyDisconnect();
    return response;
  }
  return monitorInboundSseResponse(response, notifyDisconnect);
}

/** Normalize a successful (non-GET, ok) response's body against its matching
 *  JSON-RPC request — SSE and plain-JSON response bodies alike collapse to
 *  one matched JSON-RPC message, so downstream parsing never branches on
 *  transport shape. */
async function normalizeRpcResponse(
  response: Response,
  init: RequestInit | undefined,
): Promise<Response> {
  const rpc = rpcRequest(init);
  const contentType = response.headers.get('content-type')?.toLowerCase();
  if (
    init?.method?.toUpperCase() === 'POST' &&
    contentType?.includes('text/event-stream') === true
  ) {
    if (rpc.id === undefined) {
      await response.body?.cancel().catch(() => undefined);
      return jsonResponse(response, null);
    }
    return normalizePostSseResponse(
      response,
      rpc.id,
      rpc.method === 'initialize',
    );
  }
  if (
    rpc.id !== undefined &&
    contentType?.includes('application/json') === true
  ) {
    return normalizeJsonRpcResponse(
      response,
      rpc.id,
      rpc.method === 'initialize',
    );
  }
  return response;
}

/**
 * Wraps `boundedFetch` with the MCP transport protocol's own concerns: a
 * DELETE's close-signal, mcp-session-id tracking/mismatch detection, GET's
 * SSE-listen-stream handling, and POST/JSON-RPC response normalization.
 * Split out of `connect` below purely to give this closure its own line
 * budget — behavior, including every closed-over reference, unchanged.
 */
function createProtocolGuardedFetch(
  boundedFetch: ReturnType<typeof createMcpBoundedFetch>,
  closeController: AbortController,
  protectedValueState: ProtectedValueState,
  notifyDisconnect: () => void,
): typeof boundedFetch {
  return async (request, init) => {
    const boundedInit = withCloseAbortSignal(init, closeController);
    const method = init?.method?.toUpperCase();
    let response: Response;
    try {
      response = await boundedFetch(request, boundedInit);
    } catch (error) {
      if (method === 'GET') notifyDisconnect();
      throw error;
    }
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId !== null && sessionId.length > 0) {
      if (protectedValueState.sessionId === undefined) {
        protectedValueState.sessionId = sessionId;
      } else if (protectedValueState.sessionId !== sessionId) {
        if (method === 'GET') notifyDisconnect();
        await response.body?.cancel().catch(() => undefined);
        throw new McpSessionChangedError();
      }
    }
    if (method === 'GET')
      return handleGetProtocolResponse(response, notifyDisconnect);
    if (!response.ok) return response;
    return normalizeRpcResponse(response, init);
  };
}

/** Normalize `config.headers` into both the literal transport headers and
 *  the protected-value set redaction scans against — a config-time failure
 *  here is reported through the same taxonomy as any other connect-stage
 *  failure. */
function resolveTransportHeaders(config: McpServerClientConfig) {
  try {
    const transportHeaders =
      config.headers === undefined
        ? undefined
        : Object.fromEntries(new Headers(config.headers));
    const configuredProtectedValues = normalizeProtectedValues([
      ...Object.values(config.headers ?? {}),
      ...Object.values(transportHeaders ?? {}),
    ]);
    return { transportHeaders, configuredProtectedValues };
  } catch (error) {
    throw safeOperationError('initialize', error);
  }
}

/** The bounded fetch used for discovery: same byte caps as every MCP
 *  request, plus a running total of `tools/list` response bytes across the
 *  WHOLE (possibly paginated) discovery pass — `discoverCompleteCatalog`
 *  owns resetting `discoveryByteState.active` per pass. */
function createDiscoveryBoundedFetch(
  config: McpServerClientConfig,
  discoveryByteState: DiscoveryByteState,
) {
  return createMcpBoundedFetch({
    fetch: config.fetch ?? globalThis.fetch,
    maxRequestBytes: ONE_MIB,
    maxResponseBytes: ONE_MIB,
    onBytes: (count, request) => {
      const active = discoveryByteState.active;
      if (active === undefined || request.rpcMethod !== 'tools/list') return;
      active.bytes += count;
      if (active.bytes > MAX_DISCOVERY_RESPONSE_BYTES) {
        throw new McpDiscoveryLimitError('response_bytes');
      }
    },
  });
}

function findUnsupportedProtocolCause(
  error: unknown,
): McpProtocolUnsupportedError | undefined {
  return findCause(
    error,
    (candidate): candidate is McpProtocolUnsupportedError =>
      candidate instanceof McpProtocolUnsupportedError,
  );
}

/**
 * Create the MCP SDK client over `httpTransport`, translating a connect
 * failure into the same taxonomy every other connect-stage error uses — an
 * unsupported protocol version rethrows as-is (a distinct, user-facing
 * reason), a deadline-signal abort becomes an explicit `timeout`, anything
 * else goes through the general classifier.
 */
async function createMcpClientOrThrow(
  httpTransport: Parameters<typeof createMCPClient>[0]['transport'],
  connectionState: Pick<
    ConnectionState,
    'initializationSignal' | 'deadlineController' | 'deadlineTimer'
  >,
  callerSignal: AbortSignal | undefined,
): Promise<MCPClient> {
  const { initializationSignal, deadlineController, deadlineTimer } =
    connectionState;
  try {
    return await createMCPClient({
      transport: httpTransport,
      maxRetries: 0,
      initializationOptions: { signal: initializationSignal },
      onUncaughtError: () => undefined,
    });
  } catch (error) {
    const unsupportedProtocol = findUnsupportedProtocolCause(error);
    if (unsupportedProtocol !== undefined) throw unsupportedProtocol;
    if (deadlineController.signal.aborted) {
      throw new McpServerOperationError('initialize', 'timeout');
    }
    const trustedError: unknown = error;
    const trustedUnsupportedProtocol =
      findUnsupportedProtocolCause(trustedError);
    if (trustedUnsupportedProtocol !== undefined) {
      throw trustedUnsupportedProtocol;
    }
    throw safeOperationError('initialize', trustedError, callerSignal);
  } finally {
    clearTimeout(deadlineTimer);
  }
}

/**
 * Create the MCP SDK client over an already-built stdio `transport`,
 * translating a connect failure into the same taxonomy `createMcpClientOrThrow`
 * uses for the HTTP path — flushing buffered diagnostics and closing the
 * transport first, since a launch failure is the case an operator most needs
 * to see the child's stderr for.
 */
async function createStdioMcpClientOrThrow(
  transport: BoundedStdioTransport,
  diagnostics: DiagnosticBuffer,
  connectionState: Pick<
    ConnectionState,
    'initializationSignal' | 'deadlineController' | 'deadlineTimer'
  >,
  callerSignal: AbortSignal | undefined,
): Promise<MCPClient> {
  const { initializationSignal, deadlineController, deadlineTimer } =
    connectionState;
  try {
    return await createMCPClient({
      transport,
      maxRetries: 0,
      initializationOptions: { signal: initializationSignal },
      onUncaughtError: () => undefined,
    });
  } catch (error) {
    diagnostics.flush();
    await transport.close().catch(() => undefined);
    if (deadlineController.signal.aborted) {
      throw new McpServerOperationError('initialize', 'timeout');
    }
    throw safeOperationError('initialize', error, callerSignal);
  } finally {
    clearTimeout(deadlineTimer);
  }
}

/**
 * The pinned client accepts a broader revision set than llame does, so the
 * gate is llame's own. `BoundedStdioTransport` declares `protocolVersion`
 * directly, and the AI SDK client assigns it after the handshake completes,
 * so it's genuinely present by the time a caller reaches this check.
 */
async function assertSupportedStdioProtocolVersion(
  transport: BoundedStdioTransport,
  diagnostics: DiagnosticBuffer,
  client: MCPClient,
): Promise<void> {
  const negotiated = transport.protocolVersion;
  if (negotiated !== undefined && !isSupportedMcpProtocolVersion(negotiated)) {
    diagnostics.flush();
    await client.close().catch(() => undefined);
    throw new McpProtocolUnsupportedError();
  }
}

export class McpServerClient {
  private closePromise: Promise<void> | undefined;

  private readonly protectedValueState: ProtectedValueState;
  private readonly discoveryByteState: DiscoveryByteState;
  private readonly disconnectState: DisconnectState;
  private readonly closeController: AbortController;

  private constructor(
    private readonly serverId: string,
    private readonly configuredProtectedValues: ReadonlyArray<string>,
    connectionState: Pick<
      ConnectionState,
      | 'protectedValueState'
      | 'discoveryByteState'
      | 'disconnectState'
      | 'closeController'
    >,
    private readonly client: MCPClient,
  ) {
    this.protectedValueState = connectionState.protectedValueState;
    this.discoveryByteState = connectionState.discoveryByteState;
    this.disconnectState = connectionState.disconnectState;
    this.closeController = connectionState.closeController;
  }

  private static finishConnection(
    serverId: string,
    configuredProtectedValues: ReadonlyArray<string>,
    state: ConnectionState,
    client: MCPClient,
  ): McpServerClient {
    state.disconnectState.connected = true;
    const connectedClient = new McpServerClient(
      serverId,
      configuredProtectedValues,
      state,
      client,
    );
    if (state.disconnectState.pending) {
      setTimeout(state.notifyDisconnect, 0);
    }
    return connectedClient;
  }

  static async connect(
    config: McpServerClientConfig,
  ): Promise<McpServerClient> {
    const { transportHeaders, configuredProtectedValues } =
      resolveTransportHeaders(config);
    const state = beginConnection(config);
    const { protectedValueState, discoveryByteState, closeController } = state;
    const boundedFetch = createDiscoveryBoundedFetch(
      config,
      discoveryByteState,
    );
    const protocolGuardedFetch = createProtocolGuardedFetch(
      boundedFetch,
      closeController,
      protectedValueState,
      state.notifyDisconnect,
    );
    const httpTransport: Parameters<typeof createMCPClient>[0]['transport'] = {
      type: 'http',
      url: config.url,
      redirect: 'error',
      fetch: protocolGuardedFetch,
    };
    if (transportHeaders !== undefined)
      httpTransport.headers = transportHeaders;

    const client = await createMcpClientOrThrow(
      httpTransport,
      state,
      config.signal,
    );
    return McpServerClient.finishConnection(
      config.serverId,
      configuredProtectedValues,
      state,
      client,
    );
  }

  /**
   * Connects to a local MCP server run as a child process.
   *
   * Only the transport and the failure surface differ from `connect`: there is
   * no `fetch` to wrap, so the byte bounds and session handling that the HTTP
   * path enforces there do not apply, and the negotiated revision is gated
   * after the handshake instead of during it. Everything after connection —
   * discovery paging and budgets, declaration admission, executor wrapping,
   * protected-value sanitization, failure classification — is the same code.
   */
  static async connectStdio(
    config: McpStdioServerClientConfig,
  ): Promise<McpServerClient> {
    const configuredProtectedValues = normalizeProtectedValues([
      ...(config.protectedValues ?? []),
    ]);
    const state = beginConnection(config);
    const { notifyDisconnect } = state;

    const transport = createStdioTransport(config);
    // Attached before the client starts the transport: the accessor returns its
    // stream immediately, so output written during a failed launch is retained
    // rather than lost, which is the case an operator most needs to see.
    const diagnostics = new DiagnosticBuffer(
      configuredProtectedValues,
      (text) => config.onDiagnostic?.(text),
    );
    transport.stderr?.on('data', (chunk: Buffer) => diagnostics.append(chunk));

    const client = await createStdioMcpClientOrThrow(
      transport,
      diagnostics,
      state,
      config.signal,
    );

    await assertSupportedStdioProtocolVersion(transport, diagnostics, client);

    // Chain, never replace: `createMCPClient` installs its own `onclose` that
    // rejects every in-flight request (`mcp-client.ts:407` -> `onClose()`).
    // Overwriting it would leave a tool call awaiting a child that has already
    // exited, hanging until something else happened to close the client.
    const clientOnClose = transport.onclose;
    transport.onclose = () => {
      diagnostics.flush();
      notifyDisconnect();
      clientOnClose?.();
    };

    return McpServerClient.finishConnection(
      config.serverId,
      configuredProtectedValues,
      state,
      client,
    );
  }

  async discover(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<McpDiscoveryResult> {
    if (this.discoveryByteState.active !== undefined) {
      throw new Error('MCP discovery is already in progress.');
    }
    const byteBudget = { bytes: 0 };
    const startedAt = performance.now();
    const deadlineController = new AbortController();
    const deadlineError = new McpDiscoveryLimitError('deadline');
    const deadlineTimer = setTimeout(
      () => deadlineController.abort(deadlineError),
      DISCOVERY_DEADLINE_MS,
    );
    const signal = AbortSignal.any([
      deadlineController.signal,
      ...(options.signal === undefined ? [] : [options.signal]),
    ]);
    this.discoveryByteState.active = byteBudget;
    try {
      return await this.discoverCompleteCatalog(signal, startedAt);
    } catch (error) {
      if (deadlineController.signal.aborted) throw deadlineError;
      const trustedError: unknown = error;
      const limitError = findCause(
        trustedError,
        (candidate): candidate is McpDiscoveryLimitError =>
          candidate instanceof McpDiscoveryLimitError,
      );
      if (limitError !== undefined) throw limitError;
      throw safeOperationError('discovery', trustedError, options.signal);
    } finally {
      clearTimeout(deadlineTimer);
      if (this.discoveryByteState.active === byteBudget) {
        this.discoveryByteState.active = undefined;
      }
    }
  }

  /**
   * `discoverCompleteCatalog`'s own four phases, extracted for their line
   * budget: page-fetch every raw tool, bound each by declared size/depth,
   * admit the survivors (security review + compile), then build the
   * executable entries for whatever admission actually kept. Every
   * `assertDiscoveryActive` checkpoint below is relocated, never removed or
   * reordered, so cooperative cancellation fires at the same logical points
   * as before the split. Each phase's `refused` entries are index-disjoint
   * (bound-by-size operates on all raw tools, admission only on the
   * bound-passed subset, build only on the admission-passed subset), so the
   * concatenation order below doesn't matter — the caller re-sorts by index.
   */
  private async fetchAllToolPages(
    signal: AbortSignal,
    startedAt: number,
  ): Promise<ListToolsResult['tools']> {
    const rawTools: ListToolsResult['tools'] = [];
    const seenCursors = new Set<string>();
    let pageCount = 0;
    let cursor: string | undefined;
    do {
      assertDiscoveryActive(signal, startedAt);
      if (pageCount >= MAX_DISCOVERY_PAGES) {
        throw new McpDiscoveryLimitError('pages');
      }
      pageCount += 1;
      const listToolsOptions: Parameters<MCPClient['listTools']>[0] = {
        options: { signal },
      };
      if (cursor !== undefined) listToolsOptions.params = { cursor };
      const page = await this.client.listTools(listToolsOptions);
      assertDiscoveryActive(signal, startedAt);
      if (page.tools.length > MAX_TOOLS_PER_PAGE) {
        throw new McpDiscoveryLimitError('tools_per_page');
      }
      if (rawTools.length + page.tools.length > MAX_TOOLS_TOTAL) {
        throw new McpDiscoveryLimitError('tools_total');
      }
      rawTools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new McpDiscoveryLimitError('repeated_cursor');
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);
    assertDiscoveryActive(signal, startedAt);
    return rawTools;
  }

  private boundToolsBySize(
    rawTools: ListToolsResult['tools'],
    protectedValues: ReadonlyArray<string>,
    attempt: DiscoveryAttempt,
  ) {
    const { signal, startedAt } = attempt;
    const boundedTools: ListToolsResult['tools'] = [];
    const originalIndexes: Array<number> = [];
    const refused: Array<McpDiscoveryResult['refused'][number]> = [];
    assertDiscoveryActive(signal, startedAt);
    for (const [index, rawTool] of rawTools.entries()) {
      assertDiscoveryActive(signal, startedAt);
      const id = safeDiscoveryRefusalId(
        this.serverId,
        rawTool.name,
        protectedValues,
      );
      if (serializedBytes(rawTool) > MAX_DECLARATION_BYTES) {
        refused.push({
          index,
          reason: 'declaration_too_large',
          ...(id !== undefined && { id }),
        });
      } else if (exceedsDepth(rawTool.inputSchema, MAX_SCHEMA_DEPTH)) {
        refused.push({
          index,
          reason: 'schema_too_deep',
          ...(id !== undefined && { id }),
        });
      } else {
        boundedTools.push(rawTool);
        originalIndexes.push(index);
      }
    }
    return { boundedTools, originalIndexes, refused };
  }

  private async admitBoundedTools(
    boundedTools: ListToolsResult['tools'],
    protectedValues: ReadonlyArray<string>,
    originalIndexes: Array<number>,
    attempt: DiscoveryAttempt,
  ) {
    const { signal, startedAt } = attempt;
    assertDiscoveryActive(signal, startedAt);
    const admission = await admitMcpToolDefinitions({
      serverId: this.serverId,
      protectedValues,
      definitions: boundedTools,
      assertActive: () => assertDiscoveryActive(signal, startedAt),
    });
    assertDiscoveryActive(signal, startedAt);
    const refused = admission.refused.map(({ index, id, reason }) => ({
      index: originalIndexes[index],
      reason,
      ...(id !== undefined && { id }),
    }));
    let retainedCatalogBytes = 0;
    for (const definition of admission.admitted) {
      assertDiscoveryActive(signal, startedAt);
      retainedCatalogBytes += serializedBytes(definition);
      if (retainedCatalogBytes > MAX_RETAINED_CATALOG_BYTES) {
        throw new McpDiscoveryLimitError('retained_catalog_bytes');
      }
    }
    assertDiscoveryActive(signal, startedAt);
    return { admission, refused };
  }

  /** One executable entry's admission: a missing/getter/setter property on
   *  the SDK's built tool map, or a missing `execute`, refuses the same way
   *  `admitMcpToolDefinitions` refuses anything else invalid; otherwise it's
   *  a tool, wrapped through this server's own executor guard. */
  private admitExecutableEntry(
    packageTools: ReturnType<MCPClient['toolsFromDefinitions']>,
    admission: McpDeclarationAdmissionResult,
    originalIndexes: Array<number>,
    entry: { readonly admittedIndex: number; readonly boundedIndex: number },
  ):
    | { readonly tool: McpDiscoveredTool }
    | { readonly refusal: McpDiscoveryResult['refused'][number] } {
    const { admittedIndex, boundedIndex } = entry;
    const definition = admission.admitted[admittedIndex];
    if (definition === undefined) {
      throw new Error('MCP declaration admission lost index alignment.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      packageTools,
      definition.remoteName,
    );
    const invalid = () => ({
      refusal: {
        index: originalIndexes[boundedIndex],
        id: definition.id,
        reason: 'invalid_declaration' as const,
      },
    });
    if (
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return invalid();
    }
    const packageTool = packageTools[definition.remoteName];
    if (packageTool?.execute === undefined) return invalid();
    return {
      tool: { definition, execute: this.wrapExecutor(packageTool.execute) },
    };
  }

  /** Bounded tools admission actually kept, paired with the SDK's own built
   *  tool map for exactly that set — the two things `buildExecutableTools`'s
   *  loop below needs together. */
  private resolveExecutableCandidates(
    boundedTools: ListToolsResult['tools'],
    admission: McpDeclarationAdmissionResult,
    attempt: DiscoveryAttempt,
  ) {
    const { signal, startedAt } = attempt;
    const refusedAdmissionIndexes = new Set(
      admission.refused.map(({ index }) => index),
    );
    const executableEntries = boundedTools.flatMap((rawTool, boundedIndex) =>
      refusedAdmissionIndexes.has(boundedIndex)
        ? []
        : [{ boundedIndex, rawTool }],
    );
    assertDiscoveryActive(signal, startedAt);
    const packageTools = this.client.toolsFromDefinitions({
      tools: executableEntries.map(({ rawTool }) => rawTool),
    });
    assertDiscoveryActive(signal, startedAt);
    return { executableEntries, packageTools };
  }

  private buildExecutableTools(
    boundedTools: ListToolsResult['tools'],
    admission: McpDeclarationAdmissionResult,
    originalIndexes: Array<number>,
    attempt: DiscoveryAttempt,
  ) {
    const { executableEntries, packageTools } =
      this.resolveExecutableCandidates(boundedTools, admission, attempt);
    const tools: Array<McpDiscoveredTool> = [];
    const refused: Array<McpDiscoveryResult['refused'][number]> = [];
    for (const [
      admittedIndex,
      { boundedIndex },
    ] of executableEntries.entries()) {
      assertDiscoveryActive(attempt.signal, attempt.startedAt);
      const result = this.admitExecutableEntry(
        packageTools,
        admission,
        originalIndexes,
        { admittedIndex, boundedIndex },
      );
      if ('tool' in result) {
        tools.push(result.tool);
      } else {
        refused.push(result.refusal);
      }
    }
    return { tools, refused };
  }

  private async discoverCompleteCatalog(
    signal: AbortSignal,
    startedAt: number,
  ): Promise<McpDiscoveryResult> {
    const attempt: DiscoveryAttempt = { signal, startedAt };
    const rawTools = await this.fetchAllToolPages(signal, startedAt);
    const protectedValues = this.protectedValues();
    const bounded = this.boundToolsBySize(rawTools, protectedValues, attempt);
    const { admission, refused: admissionRefused } =
      await this.admitBoundedTools(
        bounded.boundedTools,
        protectedValues,
        bounded.originalIndexes,
        attempt,
      );
    const { tools, refused: executionRefused } = this.buildExecutableTools(
      bounded.boundedTools,
      admission,
      bounded.originalIndexes,
      attempt,
    );
    const refused = [
      ...bounded.refused,
      ...admissionRefused,
      ...executionRefused,
    ];

    assertDiscoveryActive(signal, startedAt);
    tools.sort(({ definition: left }, { definition: right }) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
    refused.sort((left, right) => left.index - right.index);
    assertDiscoveryActive(signal, startedAt);
    return { tools, refused };
  }

  private protectedValues(): ReadonlyArray<string> {
    return normalizeProtectedValues([
      ...this.configuredProtectedValues,
      ...(this.protectedValueState.sessionId === undefined
        ? []
        : [this.protectedValueState.sessionId]),
    ]);
  }

  /** A successful `execute()` call, validated and sanitized before being
   *  handed back as an outcome — the try half of `wrapExecutor`'s wrapped
   *  function. */
  private interpretExecutorResult(
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the negated predicate `!hasPortableMcpResultPayload(rawResult)` below, a shape (predicate named `hasXxx`, not `isXxx`) the structural exemption's single-check parse doesn't recognize.
    rawResult: unknown,
  ): McpCallOutcome {
    if (!hasPortableMcpResultPayload(rawResult)) {
      return {
        disposition: classifyMcpFailure({
          stage: 'call',
          kind: 'invalid_output',
          hasSession: this.protectedValueState.sessionId !== undefined,
        }),
        result: safeFailureResult('invalid_output'),
      };
    }
    const safeResult = sanitizeProtectedValueJson(
      rawResult,
      this.protectedValues(),
    );
    if (!safeResult.success) {
      return {
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'execution_failed',
          message: 'The remote tool returned an unsafe result.',
        },
      };
    }
    if (isRecord(rawResult) && rawResult['isError'] === true) {
      return {
        disposition: 'call_local',
        result: safeFailureResult('is_error'),
      };
    }
    return {
      disposition: 'none',
      result: { status: 'success', output: safeResult.value },
    };
  }

  /** A failed `execute()` call, classified into the same disposition/result
   *  taxonomy as a successful-but-invalid one — the catch half of
   *  `wrapExecutor`'s wrapped function. */
  private interpretExecutorFailure(
    error: unknown,
    abortSignal: AbortSignal | undefined,
  ): McpCallOutcome {
    const kind = failureKind(error, abortSignal);
    const protectedValues = this.protectedValues();
    if (hasProtectedKeyInErrorData(error, protectedValues)) {
      return {
        disposition: classifyMcpFailure({
          stage: 'call',
          kind,
          ...(kind === 'http' && { status: failureHttpStatus(error) }),
          hasSession: this.protectedValueState.sessionId !== undefined,
        }),
        result: safeFailureResult('invalid_output'),
      };
    }
    return {
      disposition: classifyMcpFailure({
        stage: 'call',
        kind,
        ...(kind === 'http' && { status: failureHttpStatus(error) }),
        hasSession: this.protectedValueState.sessionId !== undefined,
      }),
      result: safeFailureResult(kind),
    };
  }

  private wrapExecutor(execute: PackageToolExecutor): McpToolExecutor {
    return async (args, options) => {
      const protectedValues = this.protectedValues();
      if (containsProtectedValueJson(args, protectedValues)) {
        return {
          disposition: 'call_local',
          result: {
            status: 'error',
            type: 'invalid_input',
            message: 'MCP tool arguments contain a protected value.',
          },
        };
      }
      try {
        const rawResult = await execute(args, options);
        return this.interpretExecutorResult(rawResult);
      } catch (error) {
        const trustedError: unknown = error;
        return this.interpretExecutorFailure(trustedError, options.abortSignal);
      }
    };
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeWithinDeadline();
    return this.closePromise;
  }

  private async closeWithinDeadline(): Promise<void> {
    this.disconnectState.closing = true;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(() => {
        this.closeController.abort();
        resolve();
      }, CLOSE_DEADLINE_MS);
    });
    try {
      await Promise.race([
        this.client.close().catch(() => undefined),
        deadline,
      ]);
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      this.closeController.abort();
    }
  }
}
