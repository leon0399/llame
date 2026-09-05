import {
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import {
  McpProtocolUnsupportedError,
  McpServerClient,
  type McpDiscoveredTool,
  type McpDiscoveryResult,
  type McpServerClientConfig,
  type McpStdioServerClientConfig,
} from '@workspace/tool-runtime/mcp-server-client';
import { parseMcpToolId } from '@workspace/tool-runtime/tool-id';
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
import {
  frozenRuntimeDefinition,
  isStdio,
  type McpRuntimeServerDefinition,
} from './mcp-runtime-definition';

export { type McpRuntimeServerDefinition } from './mcp-runtime-definition';

const REFRESH_BASE_MS = 60 * 60 * 1000;
const REFRESH_JITTER_MS = REFRESH_BASE_MS * 0.2;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 5 * 60 * 1000;
const SHUTDOWN_DEADLINE_MS = 5000;
/**
 * Fast-retry budget for a stdio server (design.md D5). A remote server retries
 * indefinitely because reopening a socket is cheap and the usual cause is a
 * transient network fault; respawning a child process is neither, and the usual
 * cause there is a configuration error no number of attempts resolves. Once the
 * budget is spent the record settles, and recovery moves to the periodic
 * occasion below so a host condition that outlives the budget still clears
 * without a restart.
 */
export const STDIO_MAX_FAST_ATTEMPTS = 5;

/**
 * How long a session must hold `ready` before its end refunds the fast-retry
 * budget. Comfortably longer than the ladder itself (1+2+4+8+16s), so a server
 * cycling through the ladder cannot keep earning a fresh one.
 */
export const STDIO_STABLE_AFTER_MS = 60_000;

export type McpRuntimeClient = Pick<McpServerClient, 'discover' | 'close'>;

export type McpRuntimeClientFactory = (
  config: McpServerClientConfig | McpStdioServerClientConfig,
) => Promise<McpRuntimeClient>;

export type McpRuntimeOptions = Readonly<{
  clientFactory?: McpRuntimeClientFactory;
  random?: () => number;
  now?: () => number;
}>;

export type McpDynamicToolResolution = DynamicToolResolution;

type LifecycleState = 'connecting' | 'ready' | 'reconnecting' | 'closing';

type RuntimeCatalogEntry = Readonly<{
  declarationHash: string;
  executor: Tool;
}>;

type RuntimeCatalog = Readonly<{
  entries: ReadonlyMap<string, RuntimeCatalogEntry>;
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
  /** When the current session reached `ready`; undefined when it never did. */
  readyAt?: number;
  catalog: RuntimeCatalog;
  rememberedIds: ReadonlySet<string>;
  client?: McpRuntimeClient;
  operation?: RuntimeOperation;
  timer?: ReturnType<typeof setTimeout>;
};

const EMPTY_CATALOG: RuntimeCatalog = Object.freeze({
  entries: new Map(),
});

/** The connected session `buildCatalog`/`createExecutor` build a catalog
 * entry's executor against — the three facts an in-flight tool call
 * re-checks are still current before it runs. */
type ConnectionContext = Readonly<{
  record: ServerRecord;
  generation: number;
  client: McpRuntimeClient;
}>;

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
  private readonly records: ReadonlyArray<ServerRecord>;
  private readonly clientFactory: McpRuntimeClientFactory;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly inFlightOperations = new Set<Promise<void>>();
  private readonly logger = new Logger(McpRuntimeService.name);

  private started = false;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    servers: Readonly<Record<string, McpRuntimeServerDefinition>>,
    options: McpRuntimeOptions = {},
  ) {
    this.clientFactory =
      options.clientFactory ??
      ((config) =>
        'command' in config
          ? McpServerClient.connectStdio(config)
          : McpServerClient.connect(config));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.records = Object.entries(servers).map(([serverId, definition]) => ({
      serverId,
      definition: frozenRuntimeDefinition(definition),
      generation: 0,
      state: 'connecting',
      unavailableReason: 'source_connecting',
      reconnectAttempt: 0,
      catalog: EMPTY_CATALOG,
      rememberedIds: new Set(),
    }));
  }

  onModuleInit(): void {
    if (this.started || this.shuttingDown) return;
    this.started = true;
    for (const record of this.records) {
      this.beginConnect(record);
    }
  }

  snapshotCandidates(): ReadonlyArray<TurnToolCandidate> {
    const candidates: Array<TurnToolCandidate> = [];
    for (const record of this.records) {
      if (record.state === 'ready') {
        for (const entry of record.catalog.entries.values()) {
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
        }
      } else {
        for (const id of record.rememberedIds) {
          candidates.push(
            Object.freeze({
              source: Object.freeze({
                type: 'mcp' as const,
                serverId: record.serverId,
              }),
              state: 'unavailable' as const,
              id,
              classification: 'read_only' as const,
              reason: record.unavailableReason,
            }),
          );
        }
      }
    }
    candidates.sort((left, right) => {
      const leftId = left.state === 'available' ? left.tool.id : left.id;
      const rightId = right.state === 'available' ? right.tool.id : right.id;
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
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

  /**
   * Connects `operation`'s client, or resolves `undefined` when it was
   * already fully handled (the operation went stale, or the disconnect
   * callback fired before this client was assigned) — never itself throws
   * after a client is assigned, so the caller's `client` stays accurate for
   * its own catch-block cleanup.
   */
  private async establishConnection(
    record: ServerRecord,
    operation: RuntimeOperation,
  ): Promise<McpRuntimeClient | undefined> {
    let callbackClient: McpRuntimeClient | undefined;
    let pendingDisconnect = false;
    const config: McpServerClientConfig | McpStdioServerClientConfig = {
      serverId: record.serverId,
      ...record.definition,
      ...(isStdio(record.definition) && {
        onDiagnostic: (text: string) =>
          this.logger.warn(`[${record.serverId}] ${text}`),
      }),
      signal: operation.controller.signal,
      onDisconnect: () => {
        if (callbackClient !== undefined) {
          this.handleDisconnect(record, operation.generation, callbackClient);
        } else {
          pendingDisconnect = true;
        }
      },
    };
    const client = await this.clientFactory(config);
    callbackClient = client;
    operation.client = client;
    if (!this.isCurrentOperation(record, operation)) {
      closeWithoutWaiting(client);
      return undefined;
    }
    record.client = client;
    if (pendingDisconnect) {
      this.handleDisconnect(record, operation.generation, client);
      return undefined;
    }
    return client;
  }

  private async connectAndDiscover(
    record: ServerRecord,
    operation: RuntimeOperation,
  ): Promise<void> {
    let client: McpRuntimeClient | undefined;
    try {
      client = await this.establishConnection(record, operation);
      if (client === undefined) return;

      const result = await client.discover({
        signal: operation.controller.signal,
      });
      if (!this.isCurrentClient(record, operation.generation, client)) {
        closeWithoutWaiting(client);
        return;
      }
      const catalog = this.buildCatalog(
        { record, generation: operation.generation, client },
        result,
      );
      record.catalog = catalog;
      record.rememberedIds = new Set(catalog.entries.keys());
      record.state = 'ready';
      record.unavailableReason = 'source_disconnected';
      // Reaching `ready` starts the clock rather than refunding the budget.
      // A child that initializes, serves discovery, and then exits would
      // otherwise restart the count on every cycle and respawn forever; the
      // refund is decided when the session ends, by how long it lasted.
      record.readyAt = this.now();
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
        { record, generation: operation.generation, client },
        result,
      );
      if (!this.isCurrentClient(record, operation.generation, client)) return;
      record.catalog = catalog;
      record.rememberedIds = new Set(catalog.entries.keys());
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
    connection: ConnectionContext,
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
            connection,
            discovered,
            declarationHash,
          ),
        }),
      );
    }
    return Object.freeze({ entries });
  }

  private createExecutor(
    connection: ConnectionContext,
    discovered: McpDiscoveredTool,
    declarationHash: string,
  ): Tool {
    const { record, generation, client } = connection;
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
    this.noteSessionEnded(record);
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
    this.noteSessionEnded(record);
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
    const delay = this.refreshDelay();
    const timer = setTimeout(() => {
      if (record.timer !== timer) return;
      record.timer = undefined;
      if (!this.isCurrentClient(record, generation, client)) return;
      this.beginRefresh(record, generation, client);
    }, delay);
    record.timer = timer;
  }

  /** The 48-72 minute jittered periodic cadence, shared by refresh and settled retry. */
  private refreshDelay(): number {
    return Math.floor(
      REFRESH_BASE_MS -
        REFRESH_JITTER_MS +
        clampRandom(this.random()) * REFRESH_JITTER_MS * 2,
    );
  }

  /**
   * Refunds the retry budget only to a session that proved itself.
   *
   * A momentary blip after a long healthy run should get the fast ladder
   * again. A child that dies as fast as it starts should not: without this,
   * each brief `ready` reset the counter, the settled state was unreachable,
   * and llame would respawn a crash-looping server about once a second for as
   * long as it stayed configured.
   */
  private noteSessionEnded(record: ServerRecord): void {
    const readyAt = record.readyAt;
    record.readyAt = undefined;
    if (readyAt === undefined) return;
    // Remote is untouched by design (D5): reopening a socket is cheap, its
    // backoff is unbounded anyway, and any complete success refunds it.
    if (!isStdio(record.definition)) {
      record.reconnectAttempt = 0;
      return;
    }
    if (this.now() - readyAt >= STDIO_STABLE_AFTER_MS) {
      record.reconnectAttempt = 0;
    }
  }

  private scheduleReconnect(record: ServerRecord): void {
    if (this.shuttingDown || record.timer !== undefined) return;
    const generation = record.generation;
    // A settled stdio record stays scheduled, but on the periodic occasion
    // rather than the exponential one: the fast budget is for a momentary
    // blip, and this path is for a condition that outlives it.
    const settled =
      isStdio(record.definition) &&
      record.reconnectAttempt >= STDIO_MAX_FAST_ATTEMPTS;
    const delay = settled
      ? this.refreshDelay()
      : Math.floor(
          clampRandom(this.random()) *
            Math.min(
              RECONNECT_CAP_MS,
              RECONNECT_BASE_MS * 2 ** Math.min(record.reconnectAttempt, 1024),
            ),
        );
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
