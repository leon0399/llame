import { type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import {
  McpProtocolUnsupportedError,
  McpServerClient,
  type McpDiscoveredTool,
  type McpDiscoveryResult,
  type McpServerClientConfig,
} from './mcp-server-client';
import { parseMcpToolId } from './tool-id';
import {
  type DynamicToolExecutorResolver,
  type DynamicToolResolution,
} from '../runs/snapshot-tool-execution';
import {
  hashToolDeclaration,
  type ToolUnavailableReason,
  type TurnToolCandidate,
} from '../tools/turn-tool-catalog';
import { type Tool } from '../tools/types';

const REFRESH_BASE_MS = 60 * 60 * 1000;
const REFRESH_JITTER_MS = REFRESH_BASE_MS * 0.2;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 5 * 60 * 1000;
const SHUTDOWN_DEADLINE_MS = 5000;

export type McpRuntimeServerDefinition = Readonly<{
  url: string;
  headers?: Readonly<Record<string, string>>;
  fetch?: typeof globalThis.fetch;
}>;

export type McpRuntimeClient = Pick<McpServerClient, 'discover' | 'close'>;

export type McpRuntimeClientFactory = (
  config: McpServerClientConfig,
) => Promise<McpRuntimeClient>;

export type McpRuntimeOptions = Readonly<{
  clientFactory?: McpRuntimeClientFactory;
  random?: () => number;
}>;

export type McpDynamicToolResolution = DynamicToolResolution;

type LifecycleState = 'connecting' | 'ready' | 'reconnecting' | 'closing';

type RuntimeCatalogEntry = Readonly<{
  declarationHash: string;
  executor: Tool;
}>;

type RuntimeCatalog = Readonly<{
  entries: ReadonlyMap<string, RuntimeCatalogEntry>;
  refusalReasons: ReadonlyMap<string, ToolUnavailableReason>;
}>;

type RuntimeOperation = {
  readonly generation: number;
  readonly controller: AbortController;
  client?: McpRuntimeClient;
};

type ServerRecord = {
  readonly serverId: string;
  readonly definition: McpRuntimeServerDefinition;
  generation: number;
  state: LifecycleState;
  unavailableReason: ToolUnavailableReason;
  reconnectAttempt: number;
  catalog: RuntimeCatalog;
  client?: McpRuntimeClient;
  operation?: RuntimeOperation;
  timer?: ReturnType<typeof setTimeout>;
};

const EMPTY_CATALOG: RuntimeCatalog = Object.freeze({
  entries: new Map(),
  refusalReasons: new Map(),
});

function clampRandom(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function closeWithoutWaiting(client: McpRuntimeClient): void {
  void client.close().catch(() => undefined);
}

export class McpRuntimeService
  implements OnModuleInit, OnModuleDestroy, DynamicToolExecutorResolver
{
  private readonly records: readonly ServerRecord[];
  private readonly clientFactory: McpRuntimeClientFactory;
  private readonly random: () => number;
  private readonly inFlightOperations = new Set<Promise<void>>();
  private started = false;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    servers: Readonly<Record<string, McpRuntimeServerDefinition>>,
    options: McpRuntimeOptions = {},
  ) {
    this.clientFactory =
      options.clientFactory ?? ((config) => McpServerClient.connect(config));
    this.random = options.random ?? Math.random;
    this.records = Object.entries(servers).map(([serverId, definition]) => ({
      serverId,
      definition: Object.freeze({
        url: definition.url,
        ...(definition.headers === undefined
          ? {}
          : { headers: Object.freeze({ ...definition.headers }) }),
        ...(definition.fetch === undefined ? {} : { fetch: definition.fetch }),
      }),
      generation: 0,
      state: 'connecting',
      unavailableReason: 'source_connecting',
      reconnectAttempt: 0,
      catalog: EMPTY_CATALOG,
    }));
  }

  onModuleInit(): void {
    if (this.started || this.shuttingDown) return;
    this.started = true;
    for (const record of this.records) {
      this.beginConnect(record);
    }
  }

  snapshotCandidates(
    allowedToolIds: ReadonlySet<string>,
  ): readonly TurnToolCandidate[] {
    const candidates: TurnToolCandidate[] = [];
    const ids = [...allowedToolIds].sort();
    for (const id of ids) {
      const record = this.recordForToolId(id);
      if (record === undefined) continue;
      const entry = record.catalog.entries.get(id);
      if (record.state === 'ready' && entry !== undefined) {
        candidates.push(
          Object.freeze({
            source: Object.freeze({
              type: 'mcp' as const,
              serverId: record.serverId,
            }),
            state: 'available' as const,
            tool: entry.executor,
          }),
        );
      } else {
        candidates.push(
          Object.freeze({
            source: Object.freeze({
              type: 'mcp' as const,
              serverId: record.serverId,
            }),
            state: 'unavailable' as const,
            id,
            classification: 'read_only' as const,
            reason:
              record.state === 'ready'
                ? (record.catalog.refusalReasons.get(id) ??
                  ('tool_missing' as const))
                : record.unavailableReason,
          }),
        );
      }
    }
    return Object.freeze(candidates);
  }

  resolveDynamicTool(id: string): McpDynamicToolResolution {
    const record = this.recordForToolId(id);
    if (record === undefined) return { state: 'not_dynamic' };
    if (record.state !== 'ready') return { state: 'unavailable' };
    const entry = record.catalog.entries.get(id);
    return entry === undefined
      ? { state: 'unavailable' }
      : {
          state: 'available',
          declarationHash: entry.declarationHash,
          executor: entry.executor,
        };
  }

  onModuleDestroy(): Promise<void> {
    this.shutdownPromise ??= this.shutdown();
    return this.shutdownPromise;
  }

  private recordForToolId(id: string): ServerRecord | undefined {
    return this.records.find((record) => this.isCanonicalToolId(record, id));
  }

  private isCanonicalToolId(record: ServerRecord, id: string): boolean {
    const parsed = parseMcpToolId(id);
    return parsed.success && parsed.serverId === record.serverId;
  }

  private beginConnect(record: ServerRecord): void {
    if (this.shuttingDown || record.operation !== undefined) return;
    if (record.timer !== undefined) {
      clearTimeout(record.timer);
      record.timer = undefined;
    }
    record.generation += 1;
    record.state = record.generation === 1 ? 'connecting' : 'reconnecting';
    const operation: RuntimeOperation = {
      generation: record.generation,
      controller: new AbortController(),
    };
    record.operation = operation;
    this.trackOperation(this.connectAndDiscover(record, operation));
  }

  private async connectAndDiscover(
    record: ServerRecord,
    operation: RuntimeOperation,
  ): Promise<void> {
    let client: McpRuntimeClient | undefined;
    try {
      let callbackClient: McpRuntimeClient | undefined;
      let pendingDisconnect = false;
      const config: McpServerClientConfig = {
        serverId: record.serverId,
        ...record.definition,
        signal: operation.controller.signal,
        onDisconnect: () => {
          if (callbackClient !== undefined) {
            this.handleDisconnect(record, operation.generation, callbackClient);
          } else {
            pendingDisconnect = true;
          }
        },
      };
      client = await this.clientFactory(config);
      callbackClient = client;
      operation.client = client;
      if (!this.isCurrentOperation(record, operation)) {
        closeWithoutWaiting(client);
        return;
      }
      record.client = client;
      if (pendingDisconnect) {
        this.handleDisconnect(record, operation.generation, client);
        return;
      }
      const result = await client.discover({
        signal: operation.controller.signal,
      });
      if (!this.isCurrentClient(record, operation.generation, client)) {
        closeWithoutWaiting(client);
        return;
      }
      record.catalog = this.buildCatalog(
        record,
        operation.generation,
        client,
        result,
      );
      record.state = 'ready';
      record.unavailableReason = 'source_disconnected';
      record.reconnectAttempt = 0;
      this.scheduleRefresh(record, operation.generation, client);
    } catch (error) {
      if (this.isCurrentOperation(record, operation)) {
        this.failCurrentOperation(
          record,
          operation,
          client,
          this.failureReason(error, client === undefined),
        );
      } else if (client !== undefined) {
        closeWithoutWaiting(client);
      }
    } finally {
      if (record.operation === operation) record.operation = undefined;
    }
  }

  private beginRefresh(
    record: ServerRecord,
    generation: number,
    client: McpRuntimeClient,
  ): void {
    if (
      this.shuttingDown ||
      record.operation !== undefined ||
      !this.isCurrentClient(record, generation, client)
    ) {
      return;
    }
    const operation: RuntimeOperation = {
      generation,
      controller: new AbortController(),
      client,
    };
    record.operation = operation;
    this.trackOperation(this.refresh(record, operation, client));
  }

  private trackOperation(operation: Promise<void>): void {
    this.inFlightOperations.add(operation);
    void operation.then(
      () => this.inFlightOperations.delete(operation),
      () => this.inFlightOperations.delete(operation),
    );
  }

  private async refresh(
    record: ServerRecord,
    operation: RuntimeOperation,
    client: McpRuntimeClient,
  ): Promise<void> {
    try {
      const result = await client.discover({
        signal: operation.controller.signal,
      });
      if (!this.isCurrentClient(record, operation.generation, client)) return;
      const catalog = this.buildCatalog(
        record,
        operation.generation,
        client,
        result,
      );
      if (!this.isCurrentClient(record, operation.generation, client)) return;
      record.catalog = catalog;
      this.scheduleRefresh(record, operation.generation, client);
    } catch {
      if (this.isCurrentClient(record, operation.generation, client)) {
        this.transitionToReconnect(
          record,
          operation.generation,
          client,
          'discovery_failed',
        );
      }
    } finally {
      if (record.operation === operation) record.operation = undefined;
    }
  }

  private buildCatalog(
    record: ServerRecord,
    generation: number,
    client: McpRuntimeClient,
    result: McpDiscoveryResult,
  ): RuntimeCatalog {
    const entries = new Map<string, RuntimeCatalogEntry>();
    for (const discovered of result.tools) {
      if (entries.has(discovered.definition.id)) {
        throw new Error('MCP discovery returned a duplicate admitted tool id.');
      }
      const declaration = {
        id: discovered.definition.id,
        description: discovered.definition.description,
        inputSchema: discovered.definition.inputSchema,
      };
      const declarationHash = hashToolDeclaration(declaration);
      entries.set(
        discovered.definition.id,
        Object.freeze({
          declarationHash,
          executor: this.createExecutor(
            record,
            generation,
            client,
            discovered,
            declarationHash,
          ),
        }),
      );
    }
    const refusalReasons = new Map<string, ToolUnavailableReason>();
    for (const refused of result.refused) {
      if (
        refused.id === undefined ||
        !this.isCanonicalToolId(record, refused.id)
      ) {
        continue;
      }
      const reason: ToolUnavailableReason =
        refused.reason === 'name_collision'
          ? 'name_collision'
          : 'declaration_refused';
      if (
        reason === 'name_collision' ||
        refusalReasons.get(refused.id) !== 'name_collision'
      ) {
        refusalReasons.set(refused.id, reason);
      }
    }
    return Object.freeze({ entries, refusalReasons });
  }

  private createExecutor(
    record: ServerRecord,
    generation: number,
    client: McpRuntimeClient,
    discovered: McpDiscoveredTool,
    declarationHash: string,
  ): Tool {
    const definition = discovered.definition;
    const executor: Tool = {
      id: definition.id,
      description: definition.description,
      classification: 'read_only',
      inputSchema: definition.inputSchema,
      execute: async (context, args) => {
        const current = record.catalog.entries.get(definition.id);
        if (
          this.shuttingDown ||
          record.generation !== generation ||
          record.client !== client ||
          record.state !== 'ready' ||
          current?.declarationHash !== declarationHash
        ) {
          return {
            status: 'error',
            type: 'not_available',
            message: `Tool "${definition.id}" is not available.`,
          };
        }
        const outcome = await discovered.execute(args, {
          toolCallId: context.toolCallId ?? definition.id,
          messages: [],
          abortSignal: context.abortSignal,
        });
        if (outcome.disposition === 'reconnect') {
          this.handleDisconnect(record, generation, client);
        }
        return outcome.result;
      },
    };
    return Object.freeze(executor);
  }

  private failCurrentOperation(
    record: ServerRecord,
    operation: RuntimeOperation,
    client: McpRuntimeClient | undefined,
    reason: ToolUnavailableReason,
  ): void {
    operation.controller.abort();
    record.catalog = EMPTY_CATALOG;
    record.state = 'reconnecting';
    record.unavailableReason = reason;
    if (record.client === client) record.client = undefined;
    if (client !== undefined) closeWithoutWaiting(client);
    this.scheduleReconnect(record);
  }

  private handleDisconnect(
    record: ServerRecord,
    generation: number,
    client: McpRuntimeClient,
  ): void {
    if (this.shuttingDown) return;
    if (!this.isCurrentClient(record, generation, client)) {
      closeWithoutWaiting(client);
      return;
    }
    this.transitionToReconnect(
      record,
      generation,
      client,
      'source_disconnected',
    );
  }

  private transitionToReconnect(
    record: ServerRecord,
    generation: number,
    client: McpRuntimeClient,
    reason: ToolUnavailableReason,
  ): void {
    if (!this.isCurrentClient(record, generation, client)) return;
    if (record.timer !== undefined) {
      clearTimeout(record.timer);
      record.timer = undefined;
    }
    record.catalog = EMPTY_CATALOG;
    record.state = 'reconnecting';
    record.unavailableReason = reason;
    record.client = undefined;
    record.generation += 1;
    if (record.operation?.client === client) {
      record.operation.controller.abort();
      record.operation = undefined;
    }
    closeWithoutWaiting(client);
    this.scheduleReconnect(record);
  }

  private scheduleRefresh(
    record: ServerRecord,
    generation: number,
    client: McpRuntimeClient,
  ): void {
    if (
      this.shuttingDown ||
      !this.isCurrentClient(record, generation, client)
    ) {
      return;
    }
    if (record.timer !== undefined) clearTimeout(record.timer);
    const delay = Math.floor(
      REFRESH_BASE_MS -
        REFRESH_JITTER_MS +
        clampRandom(this.random()) * REFRESH_JITTER_MS * 2,
    );
    const timer = setTimeout(() => {
      if (record.timer !== timer) return;
      record.timer = undefined;
      if (!this.isCurrentClient(record, generation, client)) return;
      this.beginRefresh(record, generation, client);
    }, delay);
    record.timer = timer;
  }

  private scheduleReconnect(record: ServerRecord): void {
    if (this.shuttingDown || record.timer !== undefined) return;
    const generation = record.generation;
    const exponent = Math.min(record.reconnectAttempt, 1024);
    const cap = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** exponent);
    const delay = Math.floor(clampRandom(this.random()) * cap);
    record.reconnectAttempt = Math.min(record.reconnectAttempt + 1, 1024);
    const timer = setTimeout(() => {
      if (record.timer !== timer) return;
      record.timer = undefined;
      if (
        this.shuttingDown ||
        record.generation !== generation ||
        record.state !== 'reconnecting'
      ) {
        return;
      }
      this.beginConnect(record);
    }, delay);
    record.timer = timer;
  }

  private failureReason(
    error: unknown,
    initializeFailed: boolean,
  ): ToolUnavailableReason {
    if (error instanceof McpProtocolUnsupportedError) {
      return 'protocol_unsupported';
    }
    return initializeFailed ? 'source_disconnected' : 'discovery_failed';
  }

  private isCurrentOperation(
    record: ServerRecord,
    operation: RuntimeOperation,
  ): boolean {
    return (
      !this.shuttingDown &&
      record.operation === operation &&
      record.generation === operation.generation
    );
  }

  private isCurrentClient(
    record: ServerRecord,
    generation: number,
    client: McpRuntimeClient,
  ): boolean {
    return (
      !this.shuttingDown &&
      record.generation === generation &&
      record.client === client
    );
  }

  private async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const clients = new Set<McpRuntimeClient>();
    const operations = [...this.inFlightOperations];
    for (const record of this.records) {
      if (record.timer !== undefined) {
        clearTimeout(record.timer);
        record.timer = undefined;
      }
      record.generation += 1;
      record.state = 'closing';
      record.catalog = EMPTY_CATALOG;
      if (record.client !== undefined) clients.add(record.client);
      if (record.operation !== undefined) {
        record.operation.controller.abort();
        if (record.operation.client !== undefined) {
          clients.add(record.operation.client);
        }
      }
      record.client = undefined;
      record.operation = undefined;
    }

    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(resolve, SHUTDOWN_DEADLINE_MS);
    });
    try {
      await Promise.race([
        Promise.allSettled([
          ...operations,
          ...[...clients].map((client) => client.close()),
        ]),
        deadline,
      ]);
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    }
  }
}
