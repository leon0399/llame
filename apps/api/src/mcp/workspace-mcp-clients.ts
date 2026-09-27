import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';

import {
  type DynamicToolExecutorResolver,
  type DynamicToolResolution,
} from '../runs/snapshot-tool-execution';
import {
  AttemptToolAdditions,
  type AttemptToolAdditionResult,
} from '../tools/attempt-tool-additions';
import { type TurnToolCandidate } from '../tools/turn-tool-catalog';
import { parseMcpToolId } from './tool-id';
import {
  McpRuntimeService,
  type McpRuntimeClientFactory,
  type McpRuntimeServerDefinition,
  type McpRuntimeServerState,
} from './mcp-runtime.service';
import {
  readWorkspaceMcpConfig,
  type WorkspaceMcpServerConfig,
} from './workspace-mcp-config';
import { isStdio } from './mcp-runtime-definition';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export type WorkspaceMcpKey = Readonly<{
  chatId: string;
  root: string;
  generation: number;
}>;

export type WorkspaceMcpServerState = Readonly<{
  id: string;
  state: 'available' | 'unavailable';
  reason?: string;
}>;

export type WorkspaceMcpEntryState = Readonly<{
  key: WorkspaceMcpKey;
  servers: ReadonlyArray<WorkspaceMcpServerState>;
}>;

export type WorkspaceMcpClientsOptions = Readonly<{
  clientFactory?: McpRuntimeClientFactory;
  now?: () => number;
  readConfig?: typeof readWorkspaceMcpConfig;
}>;

type OperatorRuntime = Pick<
  McpRuntimeService,
  'snapshotCandidates' | 'resolveDynamicTool' | 'snapshotServerIds'
>;

type ClientSet = {
  readonly key: WorkspaceMcpKey;
  readonly configs: ReadonlyArray<WorkspaceMcpServerConfig>;
  readonly runtime: McpRuntimeService;
  activeAttempts: number;
  lastUsed: number;
};

function keyString(key: WorkspaceMcpKey): string {
  return `${key.chatId}\u0000${key.root}\u0000${key.generation}`;
}

function sameKey(left: WorkspaceMcpKey, right: WorkspaceMcpKey): boolean {
  return (
    left.chatId === right.chatId &&
    left.root === right.root &&
    left.generation === right.generation
  );
}

function asciiFold(value: string): string {
  return value.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

function unavailable(id: string, reason: string): WorkspaceMcpServerState {
  return { id, state: 'unavailable', reason };
}
function runtimeDefinition(
  config: Extract<WorkspaceMcpServerConfig, { state: 'configured' }>,
): McpRuntimeServerDefinition {
  return isStdio(config.definition)
    ? {
        ...config.definition,
        protectedValues: config.protectedValues,
      }
    : {
        ...config.definition,
        protectedValues: config.protectedValues,
      };
}

function configuredEntries(
  configs: ReadonlyArray<WorkspaceMcpServerConfig>,
  operatorIds: ReadonlyArray<string>,
): ReadonlyArray<Extract<WorkspaceMcpServerConfig, { state: 'configured' }>> {
  return configs.filter(
    (
      config,
    ): config is Extract<WorkspaceMcpServerConfig, { state: 'configured' }> =>
      config.state === 'configured' &&
      !isCaseOnlyCollision(config.id, operatorIds),
  );
}

function runtimeDefinitions(
  configs: ReadonlyArray<
    Extract<WorkspaceMcpServerConfig, { state: 'configured' }>
  >,
): Readonly<Record<string, McpRuntimeServerDefinition>> {
  return Object.freeze(
    Object.fromEntries(
      configs.map((config) => [config.id, runtimeDefinition(config)]),
    ),
  );
}

function isCaseOnlyCollision(
  id: string,
  operatorIds: ReadonlyArray<string>,
): boolean {
  return operatorIds.some(
    (operatorId) =>
      operatorId !== id && asciiFold(operatorId) === asciiFold(id),
  );
}

function runtimeState(
  id: string,
  states: ReadonlyArray<McpRuntimeServerState>,
): WorkspaceMcpServerState {
  const state = states.find((entry) => entry.serverId === id);
  if (state === undefined) return unavailable(id, 'source_connecting');
  return state.state === 'available'
    ? { id, state: 'available' }
    : unavailable(id, state.reason ?? 'source_disconnected');
}

@Injectable()
export class WorkspaceMcpClients implements OnModuleDestroy {
  private readonly records = new Map<string, ClientSet>();
  private readonly starts = new Map<string, Promise<ClientSet>>();
  private readonly stopEpochs = new Map<string, number>();
  private readonly operator: OperatorRuntime;
  private readonly clientFactory: McpRuntimeClientFactory | undefined;
  private readonly now: () => number;
  private readonly readConfig: typeof readWorkspaceMcpConfig;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;
  private stopping = false;

  constructor(
    @Inject(McpRuntimeService) operator: OperatorRuntime,
    @Optional() options: WorkspaceMcpClientsOptions = {},
  ) {
    this.operator = operator;
    this.clientFactory = options.clientFactory;
    this.now = options.now ?? Date.now;
    this.readConfig = options.readConfig ?? readWorkspaceMcpConfig;
    this.cleanupTimer = setInterval(
      () => this.cleanupIdle(),
      CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref?.();
  }
  async startForChat(key: WorkspaceMcpKey): Promise<WorkspaceMcpEntryState> {
    this.cleanupIdle();
    const id = keyString(key);
    const existing = this.records.get(id);
    if (existing !== undefined) {
      existing.lastUsed = this.now();
      return this.describe(existing);
    }
    const pending = this.starts.get(id);
    if (pending !== undefined) {
      const record = await pending;
      return this.describe(record);
    }
    const epoch = this.bumpStopEpoch(key.chatId);
    await this.stopStaleForChat(key);
    await this.awaitPendingStarts(key.chatId);
    const record = await this.startKey(key, epoch);
    record.lastUsed = this.now();
    return this.describe(record);
  }

  stateForKey(key: WorkspaceMcpKey): WorkspaceMcpEntryState | undefined {
    const record = this.records.get(keyString(key));
    if (record === undefined) return undefined;
    record.lastUsed = this.now();
    return this.describe(record);
  }

  beginAttempt(key: WorkspaceMcpKey): void {
    const record = this.records.get(keyString(key));
    if (record === undefined) return;
    record.activeAttempts += 1;
    record.lastUsed = this.now();
  }

  endAttempt(key: WorkspaceMcpKey): void {
    const record = this.records.get(keyString(key));
    if (record === undefined) return;
    record.activeAttempts = Math.max(0, record.activeAttempts - 1);
    record.lastUsed = this.now();
  }

  async addToAttempt(
    key: WorkspaceMcpKey,
    additions: AttemptToolAdditions,
  ): Promise<WorkspaceMcpEntryState> {
    const record = this.records.get(keyString(key));
    if (record === undefined) return { key, servers: [] };
    record.lastUsed = this.now();
    const statuses = this.describe(record).servers.map((status) =>
      this.addServerToAttempt(record, status, additions),
    );
    return { key, servers: await Promise.all(statuses) };
  }

  snapshotCandidates(
    key: WorkspaceMcpKey,
    operatorCandidates: ReadonlyArray<TurnToolCandidate> = this.operator.snapshotCandidates(),
  ): ReadonlyArray<TurnToolCandidate> {
    const record = this.records.get(keyString(key));
    if (record === undefined) return operatorCandidates;
    const activeServers = new Set(
      this.describe(record)
        .servers.filter(({ state }) => state === 'available')
        .map(({ id }) => id),
    );
    return [
      ...operatorCandidates.filter((candidate) =>
        candidate.source.type === 'mcp'
          ? !activeServers.has(candidate.source.serverId)
          : true,
      ),
      ...record.runtime
        .snapshotCandidates()
        .filter((candidate) =>
          candidate.state === 'available' && candidate.source.type === 'mcp'
            ? activeServers.has(candidate.source.serverId)
            : false,
        ),
    ];
  }

  resolverFor(
    key: WorkspaceMcpKey,
    operatorResolver: DynamicToolExecutorResolver | undefined,
  ): DynamicToolExecutorResolver {
    return {
      resolveDynamicTool: (id) => this.resolveForKey(key, id, operatorResolver),
    };
  }

  async stopForChat(chatId: string): Promise<void> {
    this.bumpStopEpoch(chatId);
    const matches = [...this.records.values()].filter(
      (record) => record.key.chatId === chatId,
    );
    await Promise.all(matches.map((record) => this.stopRecord(record)));
    await this.awaitPendingStarts(chatId);
  }
  cleanupIdle(now = this.now()): void {
    for (const record of this.records.values()) {
      if (
        record.activeAttempts > 0 ||
        now - record.lastUsed < IDLE_TIMEOUT_MS
      ) {
        continue;
      }
      void this.stopRecord(record);
    }
  }
  async onModuleDestroy(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    clearInterval(this.cleanupTimer);
    for (const record of this.records.values()) {
      this.bumpStopEpoch(record.key.chatId);
    }
    await Promise.allSettled(this.starts.values());
    await Promise.all(
      [...this.records.values()].map((record) => this.stopRecord(record)),
    );
  }
  private async awaitPendingStarts(chatId: string): Promise<void> {
    const prefix = `${chatId}\u0000`;
    const pending: Array<Promise<ClientSet>> = [];
    for (const [id, operation] of this.starts) {
      if (id.startsWith(prefix)) pending.push(operation);
    }
    await Promise.allSettled(pending);
  }

  private bumpStopEpoch(chatId: string): number {
    const epoch = (this.stopEpochs.get(chatId) ?? 0) + 1;
    this.stopEpochs.set(chatId, epoch);
    return epoch;
  }

  private async startKey(
    key: WorkspaceMcpKey,
    epoch: number,
  ): Promise<ClientSet> {
    const existing = this.records.get(keyString(key));
    if (existing !== undefined) return existing;
    const pending = this.starts.get(keyString(key));
    if (pending !== undefined) return pending;
    const operation = this.createClientSet(key);
    this.starts.set(keyString(key), operation);
    try {
      const record = await operation;
      if (this.stopping || this.stopEpochs.get(key.chatId) !== epoch) {
        await record.runtime.stop();
        return record;
      }
      this.records.set(keyString(key), record);
      return record;
    } finally {
      this.starts.delete(keyString(key));
    }
  }

  private async createClientSet(key: WorkspaceMcpKey): Promise<ClientSet> {
    let configs: ReadonlyArray<WorkspaceMcpServerConfig>;
    try {
      configs = await this.readConfig(key.root);
    } catch {
      configs = [
        unavailableConfig(
          'workspace',
          'Workspace MCP configuration unavailable',
        ),
      ];
    }
    const operatorIds = this.operator.snapshotServerIds();
    const configured = configuredEntries(configs, operatorIds);
    const runtime = new McpRuntimeService(runtimeDefinitions(configured), {
      ...(this.clientFactory !== undefined && {
        clientFactory: this.clientFactory,
      }),
    });
    await runtime.start();
    return { key, configs, runtime, activeAttempts: 0, lastUsed: this.now() };
  }

  private async stopStaleForChat(key: WorkspaceMcpKey): Promise<void> {
    const stale = [...this.records.values()].filter(
      (record) => record.key.chatId === key.chatId && !sameKey(record.key, key),
    );
    await Promise.all(stale.map((record) => this.stopRecord(record)));
  }

  private async stopRecord(record: ClientSet): Promise<void> {
    const id = keyString(record.key);
    if (this.records.get(id) !== record) return;
    this.records.delete(id);
    await record.runtime.stop();
  }

  private describe(record: ClientSet): WorkspaceMcpEntryState {
    const operatorIds = this.operator.snapshotServerIds();
    const states = record.runtime.snapshotServerStates();
    return {
      key: record.key,
      servers: Object.freeze(
        record.configs.map((config) => {
          if (config.state === 'unavailable') {
            return unavailable(config.id, config.reason);
          }
          if (isCaseOnlyCollision(config.id, operatorIds)) {
            return unavailable(
              config.id,
              'case-only collision with an operator server',
            );
          }
          return runtimeState(config.id, states);
        }),
      ),
    };
  }

  private async addServerToAttempt(
    record: ClientSet,
    status: WorkspaceMcpServerState,
    additions: AttemptToolAdditions,
  ): Promise<WorkspaceMcpServerState> {
    if (status.state !== 'available') return status;
    if (this.operator.snapshotServerIds().some((id) => id === status.id)) {
      if (additions.hasOperatorDeclaration(status.id)) {
        return {
          ...status,
          reason: 'shadows from the next Run',
        };
      }
    }
    const tools = record.runtime
      .snapshotCandidatesForServer(status.id)
      .flatMap((candidate) =>
        candidate.state === 'available' ? [candidate.tool] : [],
      );
    if (tools.length === 0) return status;
    const result = await additions.add(status.id, tools);
    return this.statusAfterAddition(status, result);
  }

  private statusAfterAddition(
    status: WorkspaceMcpServerState,
    result: AttemptToolAdditionResult,
  ): WorkspaceMcpServerState {
    return result.availableFromNextRun.length === 0
      ? status
      : { ...status, reason: 'available from the next Run' };
  }

  private resolveForKey(
    key: WorkspaceMcpKey,
    id: string,
    operatorResolver: DynamicToolExecutorResolver | undefined,
  ): DynamicToolResolution {
    const record = this.records.get(keyString(key));
    const parsed = parseMcpToolId(id);
    if (record !== undefined && parsed.success) {
      const status = this.describe(record).servers.find(
        ({ id: serverId }) => serverId === parsed.serverId,
      );
      if (status?.state === 'available') {
        const resolution = record.runtime.resolveDynamicTool(id);
        return resolution.state === 'available'
          ? { ...resolution, workspaceServer: parsed.serverId }
          : resolution;
      }
    }
    return operatorResolver?.resolveDynamicTool(id) ?? { state: 'not_dynamic' };
  }
}

function unavailableConfig(
  id: string,
  reason: string,
): WorkspaceMcpServerConfig {
  return { id, state: 'unavailable', reason };
}
