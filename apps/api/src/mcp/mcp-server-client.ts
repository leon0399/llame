import {
  createMCPClient,
  type ListToolsResult,
  type MCPClient,
} from '@ai-sdk/mcp';

import {
  admitMcpToolDefinitions,
  type AdmittedMcpToolDefinition,
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
import { type ToolResult } from '../tools/types';

const ONE_MIB = 1024 * 1024;
const MAX_TOOLS_PER_PAGE = 256;
const MAX_TOOLS_TOTAL = 1000;
const MAX_DISCOVERY_PAGES = 1000;
const DISCOVERY_DEADLINE_MS = 30_000;
const CLOSE_DEADLINE_MS = 5_000;
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
  args: unknown,
  options: McpToolExecutionOptions,
) => Promise<McpCallOutcome>;

export type McpDiscoveredTool = {
  readonly definition: AdmittedMcpToolDefinition;
  readonly execute: McpToolExecutor;
};

export type McpDiscoveryResult = {
  readonly tools: readonly McpDiscoveredTool[];
  readonly refused: readonly {
    readonly index: number;
    readonly reason:
      | McpDeclarationRefusalReason
      | 'declaration_too_large'
      | 'schema_too_deep';
  }[];
};

export type McpServerClientConfig = {
  readonly serverId: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
};

type ProtectedValueState = {
  sessionId?: string;
};

type DiscoveryByteState = {
  active?: { bytes: number };
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function rpcRequest(init: RequestInit | undefined): {
  readonly id?: string | number;
  readonly method?: string;
} {
  if (typeof init?.body !== 'string') return {};
  try {
    const body = JSON.parse(init.body) as unknown;
    if (!isRecord(body)) return {};
    const method = body['method'];
    const id = body['id'];
    return {
      ...(typeof method === 'string' ? { method } : {}),
      ...(typeof id === 'string' || typeof id === 'number' ? { id } : {}),
    };
  } catch {
    return {};
  }
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

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

function errorRecord(error: unknown): Record<string, unknown> | undefined {
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

function failureKind(
  error: unknown,
  callerSignal: AbortSignal | undefined,
): McpFailureKind {
  if (callerSignal?.aborted) {
    const reason = errorRecord(callerSignal.reason);
    return reason?.['name'] === 'TimeoutError' ? 'timeout' : 'cancelled';
  }
  if (
    findCause(
      error,
      (candidate): candidate is McpBodyLimitError =>
        candidate instanceof McpBodyLimitError,
    ) !== undefined
  ) {
    return 'body_limit';
  }
  if (
    findCause(
      error,
      (candidate): candidate is McpRequestLimitError =>
        candidate instanceof McpRequestLimitError,
    ) !== undefined
  ) {
    return 'malformed_protocol';
  }
  if (
    findCause(
      error,
      (
        candidate,
      ): candidate is McpSessionChangedError | McpMatchingResponseError =>
        candidate instanceof McpSessionChangedError ||
        candidate instanceof McpMatchingResponseError,
    ) !== undefined
  ) {
    return 'malformed_protocol';
  }
  if (failureHttpStatus(error) !== undefined) return 'http';
  if (
    findCause(
      error,
      (candidate): candidate is Record<string, unknown> =>
        errorRecord(candidate)?.['name'] === 'ZodError',
    ) !== undefined
  ) {
    return 'invalid_output';
  }
  if (
    findCause(
      error,
      (candidate): candidate is Record<string, unknown> =>
        errorRecord(candidate)?.['name'] === 'SyntaxError',
    ) !== undefined
  ) {
    return 'malformed_protocol';
  }
  if (
    findCause(
      error,
      (candidate): candidate is Record<string, unknown> =>
        typeof errorRecord(candidate)?.['code'] === 'number',
    ) !== undefined
  ) {
    return 'tool_error';
  }
  return 'network';
}

function failureHttpStatus(error: unknown): number | undefined {
  const failure = findCause(
    error,
    (candidate): candidate is Record<string, unknown> =>
      typeof errorRecord(candidate)?.['statusCode'] === 'number',
  );
  const status = failure?.['statusCode'];
  return typeof status === 'number' ? status : undefined;
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

function hasPortableMcpResultShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    (Array.isArray(value['content']) ||
      (Object.hasOwn(value, 'toolResult') && value['toolResult'] !== undefined))
  );
}

function hasProtectedKeyInErrorData(
  error: unknown,
  protectedValues: readonly string[],
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
  value: unknown,
  requestId: string | number,
): Record<string, unknown> | undefined {
  const messages = Array.isArray(value) ? value : [value];
  return messages.find(
    (message): message is Record<string, unknown> =>
      isRecord(message) &&
      message['id'] === requestId &&
      (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')),
  );
}

function assertSupportedInitializeResponse(
  message: Record<string, unknown>,
): void {
  const result = message['result'];
  if (!isRecord(result)) return;
  const protocolVersion = result['protocolVersion'];
  if (
    typeof protocolVersion === 'string' &&
    !MCP_SERVER_CLIENT_PROTOCOL_VERSIONS.some(
      (supported) => supported === protocolVersion,
    )
  ) {
    throw new McpProtocolUnsupportedError();
  }
}

function jsonResponse(response: Response, message: unknown): Response {
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
  const data: string[] = [];
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

async function readMatchingSseResponse(
  response: Response,
  requestId: string | number,
): Promise<Record<string, unknown>> {
  if (response.body === null) throw new McpMatchingResponseError();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new McpMatchingResponseError();
      pending += value;
      while (true) {
        const boundary = sseEventBoundary(pending);
        if (boundary === undefined) break;
        const event = pending.slice(0, boundary.eventEnd);
        pending = pending.slice(boundary.consumed);
        const data = sseData(event);
        if (data === undefined) continue;
        let message: unknown;
        try {
          message = JSON.parse(data) as unknown;
        } catch {
          throw new McpMatchingResponseError();
        }
        const matching = matchingRpcResponse(message, requestId);
        if (matching !== undefined) return matching;
      }
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

export class McpServerClient {
  private closePromise: Promise<void> | undefined;

  private constructor(
    private readonly serverId: string,
    private readonly configuredProtectedValues: readonly string[],
    private readonly protectedValueState: ProtectedValueState,
    private readonly discoveryByteState: DiscoveryByteState,
    private readonly closeController: AbortController,
    private readonly client: MCPClient,
  ) {}

  static async connect(
    config: McpServerClientConfig,
  ): Promise<McpServerClient> {
    const protectedValueState: ProtectedValueState = {};
    const discoveryByteState: DiscoveryByteState = {};
    const closeController = new AbortController();
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(
      () => deadlineController.abort(),
      DISCOVERY_DEADLINE_MS,
    );
    const configuredProtectedValues = normalizeProtectedValues(
      Object.values(config.headers ?? {}),
    );
    const boundedFetch = createMcpBoundedFetch({
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
    const protocolGuardedFetch: typeof boundedFetch = async (request, init) => {
      const boundedInit =
        init?.method === 'DELETE'
          ? {
              ...init,
              signal:
                init.signal === undefined || init.signal === null
                  ? closeController.signal
                  : AbortSignal.any([init.signal, closeController.signal]),
            }
          : init;
      const response = await boundedFetch(request, boundedInit);
      const sessionId = response.headers.get('mcp-session-id');
      if (sessionId !== null && sessionId.length > 0) {
        if (protectedValueState.sessionId === undefined) {
          protectedValueState.sessionId = sessionId;
        } else if (protectedValueState.sessionId !== sessionId) {
          await response.body?.cancel().catch(() => undefined);
          throw new McpSessionChangedError();
        }
      }
      if (!response.ok) return response;
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
    };
    let client: MCPClient;
    try {
      client = await createMCPClient({
        transport: {
          type: 'http',
          url: config.url,
          ...(config.headers === undefined
            ? {}
            : { headers: { ...config.headers } }),
          redirect: 'error',
          fetch: protocolGuardedFetch,
        },
        maxRetries: 0,
        initializationOptions: { signal: deadlineController.signal },
        onUncaughtError: () => undefined,
      });
    } catch (error) {
      const unsupportedProtocol = findCause(
        error,
        (candidate): candidate is McpProtocolUnsupportedError =>
          candidate instanceof McpProtocolUnsupportedError,
      );
      if (unsupportedProtocol !== undefined) throw unsupportedProtocol;
      if (deadlineController.signal.aborted) {
        throw new McpServerOperationError('initialize', 'timeout');
      }
      const trustedError: unknown = error;
      const trustedUnsupportedProtocol = findCause(
        trustedError,
        (candidate): candidate is McpProtocolUnsupportedError =>
          candidate instanceof McpProtocolUnsupportedError,
      );
      if (trustedUnsupportedProtocol !== undefined) {
        throw trustedUnsupportedProtocol;
      }
      throw safeOperationError('initialize', trustedError);
    } finally {
      clearTimeout(deadlineTimer);
    }
    return new McpServerClient(
      config.serverId,
      configuredProtectedValues,
      protectedValueState,
      discoveryByteState,
      closeController,
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
      return await this.discoverCompleteCatalog(signal);
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

  private async discoverCompleteCatalog(
    signal: AbortSignal,
  ): Promise<McpDiscoveryResult> {
    const rawTools: ListToolsResult['tools'] = [];
    const seenCursors = new Set<string>();
    let pageCount = 0;
    let cursor: string | undefined;
    do {
      if (pageCount >= MAX_DISCOVERY_PAGES) {
        throw new McpDiscoveryLimitError('pages');
      }
      pageCount += 1;
      const page = await this.client.listTools({
        ...(cursor === undefined ? {} : { params: { cursor } }),
        options: { signal },
      });
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

    const protectedValues = this.protectedValues();
    const boundedTools: ListToolsResult['tools'] = [];
    const originalIndexes: number[] = [];
    const refused: McpDiscoveryResult['refused'][number][] = [];
    rawTools.forEach((rawTool, index) => {
      if (serializedBytes(rawTool) > MAX_DECLARATION_BYTES) {
        refused.push({ index, reason: 'declaration_too_large' });
      } else if (exceedsDepth(rawTool.inputSchema, MAX_SCHEMA_DEPTH)) {
        refused.push({ index, reason: 'schema_too_deep' });
      } else {
        boundedTools.push(rawTool);
        originalIndexes.push(index);
      }
    });
    const admission = await admitMcpToolDefinitions({
      serverId: this.serverId,
      protectedValues,
      definitions: boundedTools,
    });
    refused.push(
      ...admission.refused.map(({ index, reason }) => ({
        index: originalIndexes[index],
        reason,
      })),
    );
    let retainedCatalogBytes = 0;
    for (const definition of admission.admitted) {
      retainedCatalogBytes += serializedBytes(definition);
      if (retainedCatalogBytes > MAX_RETAINED_CATALOG_BYTES) {
        throw new McpDiscoveryLimitError('retained_catalog_bytes');
      }
    }
    const refusedAdmissionIndexes = new Set(
      admission.refused.map(({ index }) => index),
    );
    const executableEntries = boundedTools.flatMap((rawTool, boundedIndex) =>
      refusedAdmissionIndexes.has(boundedIndex)
        ? []
        : [{ boundedIndex, rawTool }],
    );
    const packageTools = this.client.toolsFromDefinitions({
      tools: executableEntries.map(({ rawTool }) => rawTool),
    });
    const tools: McpDiscoveredTool[] = [];
    for (const [
      admittedIndex,
      { boundedIndex },
    ] of executableEntries.entries()) {
      const definition = admission.admitted[admittedIndex];
      if (definition === undefined) {
        throw new Error('MCP declaration admission lost index alignment.');
      }
      const packageTool = Object.getOwnPropertyDescriptor(
        packageTools,
        definition.remoteName,
      )?.value as PackageTool | undefined;
      if (packageTool?.execute === undefined) {
        refused.push({
          index: originalIndexes[boundedIndex],
          reason: 'invalid_declaration',
        });
        continue;
      }
      tools.push({
        definition,
        execute: this.wrapExecutor(packageTool.execute),
      });
    }

    tools.sort(({ definition: left }, { definition: right }) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
    refused.sort((left, right) => left.index - right.index);
    return { tools, refused };
  }

  private protectedValues(): readonly string[] {
    return normalizeProtectedValues([
      ...this.configuredProtectedValues,
      ...(this.protectedValueState.sessionId === undefined
        ? []
        : [this.protectedValueState.sessionId]),
    ]);
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
        if (!hasPortableMcpResultShape(rawResult)) {
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
      } catch (error) {
        const trustedError: unknown = error;
        const kind = failureKind(trustedError, options.abortSignal);
        const protectedValues = this.protectedValues();
        if (hasProtectedKeyInErrorData(trustedError, protectedValues)) {
          return {
            disposition: classifyMcpFailure({
              stage: 'call',
              kind,
              ...(kind === 'http'
                ? { status: failureHttpStatus(trustedError) }
                : {}),
              hasSession: this.protectedValueState.sessionId !== undefined,
            }),
            result: safeFailureResult('invalid_output'),
          };
        }
        return {
          disposition: classifyMcpFailure({
            stage: 'call',
            kind,
            ...(kind === 'http'
              ? { status: failureHttpStatus(trustedError) }
              : {}),
            hasSession: this.protectedValueState.sessionId !== undefined,
          }),
          result: safeFailureResult(kind),
        };
      }
    };
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeWithinDeadline();
    return this.closePromise;
  }

  private async closeWithinDeadline(): Promise<void> {
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
