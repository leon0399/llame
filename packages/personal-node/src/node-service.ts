import { accessOperation, isQueryMethod } from '@workspace/node-protocol';
import { PersonalNodeAccess } from './node-access';
import { createHash } from 'node:crypto';
import { type UnknownRecord } from '@workspace/runtime-safety';
import { isBoolean, isRecord, isString, redactProtectedString, normalizeProtectedValues, sanitizeProtectedValueJson } from '@workspace/runtime-safety';
import { PersonalKnowledge } from './knowledge';
import { rebuildSearch } from './store-migration';
import { loadConfig, selectModel, configDocument } from './config';
import { commandEnvironment } from './env';
import { LocalStore } from './store';
import { runLocal } from './local-run';
import { CliError } from './errors';
import { executionLock, removeDeadLock } from './execution-lock';
import { integer, keys, text, uuid } from './validation';
import { McpHost } from './mcp-host';
import { parseMcpServers } from './mcp-config';
import { NodeOutput } from './node-output';
import { type Approval } from './types';
import { pathIdentity, NODE_PROTOCOL_VERSION, type NodeHello } from './protocol';

export interface NodeBoot {
  readonly data: string;
  readonly config: string;
  readonly cwd: string;
  readonly native: boolean;
  readonly transport: 'stdio' | 'unix';
  readonly env: NodeJS.ProcessEnv;
}

export interface RequestContext {
  readonly channelId: string;
  readonly signal: AbortSignal;
  readonly controller: AbortController;
  readonly approve: Approval;
  readonly emit: (kind: string, value: unknown) => void;
}

/** State and execution owner. No terminal streams, user input, or remote login. */
export class NodeService {
  readonly store: LocalStore;
  private readonly active = new Map<string, AbortController>();
  private readonly controllers = new Set<AbortController>();
  private readonly jobs = new Set<Promise<unknown>>();

  constructor(readonly boot: NodeBoot) { this.store = new LocalStore(boot.data); }

  hello(params: UnknownRecord): NodeHello {
    keys(params, ['version'], 'core.hello');
    if (params.version !== NODE_PROTOCOL_VERSION) throw new CliError('protocol_version', `This Node requires private protocol version ${NODE_PROTOCOL_VERSION}. Restart older Nodes; no fallback was attempted.`);
    return { version: NODE_PROTOCOL_VERSION, nodeId: this.store.nodeId, principal: 'local-owner', transport: this.boot.transport,
      modules: { core: 1, realm: 1, execution: 1, admin: 1 },
      capabilities: ['chats', 'runs', 'mcp', 'approvals', 'run-cancellation', 'event-replay', 'conversation-recall', 'local-markdown-knowledge'],
      configIdentity: pathIdentity(this.boot.config), workspaceIdentity: this.boot.native ? pathIdentity(this.boot.cwd) : null,
      synchronization: false };
  }

  async dispatch(method: string, params: UnknownRecord, context: RequestContext): Promise<unknown> {
    if (method === 'core.describe' || isQueryMethod(method)) {
      return accessOperation({ method, params }, new PersonalNodeAccess(this.store), context.signal);
    }
    switch (method) {
      case 'core.status': keys(params, [], method); return { nodeId: this.store.nodeId, transport: this.boot.transport, enrolled: false, synchronization: false };
      case 'realm.models.list': return this.models(params);
      case 'realm.knowledge.create': return new PersonalKnowledge(this.store).create(params);
      case 'realm.knowledge.list': keys(params, [], method); return { items: new PersonalKnowledge(this.store).list(), nextCursor: null };
      case 'realm.knowledge.get': keys(params, ['knowledgeSpaceId'], method); return new PersonalKnowledge(this.store).get(uuid(params.knowledgeSpaceId));
      case 'realm.chats.list': keys(params, [], method); return this.store.chats();
      case 'realm.chats.read': keys(params, ['chatId'], method); return this.store.history(uuid(params.chatId));
      case 'execution.run': return this.execute(params, context);
      case 'execution.runs.list': keys(params, [], method); return this.store.runs();
      case 'execution.runs.get': keys(params, ['runId'], method); return this.store.run(uuid(params.runId));
      case 'execution.runs.events': keys(params, ['runId', 'after'], method); return this.store.eventPage(uuid(params.runId), integer(params.after ?? 0, 'after', 0, Number.MAX_SAFE_INTEGER));
      case 'execution.runs.cancel': return this.cancel(params);
      case 'admin.search.rebuild': keys(params, [], method); this.store.transaction(() => rebuildSearch(this.store.db)); return { rebuilt: true, sourceUnchanged: true };
      case 'admin.recover': return this.recover(params);
      case 'admin.mcp.discover': return this.mcp(params, context);
      default: throw new CliError('method_unknown', 'This Node does not implement the requested method.');
    }
  }

  private configuration(params: UnknownRecord): void {
    if (params.configIdentity !== pathIdentity(this.boot.config)) throw new CliError('node_config_mismatch', 'The running Node owns a different config. Stop it or use its configuration path; no credentials were resolved.');
  }

  private models(params: UnknownRecord): unknown {
    keys(params, ['configIdentity'], 'realm.models.list'); this.configuration(params);
    const config = loadConfig(this.boot.config, this.boot.env);
    const value = { defaultModel: config.defaultModel ?? null, models: config.models.map(({ id, model, baseUrl }) => ({ id, model, baseUrl })) };
    const safe = sanitizeProtectedValueJson(value, config.protectedValues);
    if (!safe.success) throw new CliError('protected_output', 'Model metadata contains a protected value.');
    return safe.value;
  }

  private async execute(params: UnknownRecord, context: RequestContext): Promise<unknown> {
    keys(params, ['chatId', 'prompt', 'model', 'native', 'workspaceIdentity', 'configIdentity'], 'execution.run');
    this.configuration(params);
    if (!isBoolean(params.native)) throw new CliError('arguments', 'native must be a boolean.');
    if (params.native && (!this.boot.native || params.workspaceIdentity !== pathIdentity(this.boot.cwd))) {
      throw new CliError('workspace_grant', 'The Node was not launched with native authority for this startup Workspace. No action was attempted.');
    }
    const prompt = text(params.prompt, 'prompt', 80_000);
    if (!prompt.trim()) throw new CliError('empty_prompt', 'Prompt must not be blank.');
    const chatId = uuid(params.chatId);
    const config = loadConfig(this.boot.config, this.boot.env);
    let runId: string | undefined;
    const output = new NodeOutput((kind, value) => {
      if (kind === 'event' && isRecord(value) && isString(value.runId)) {
        runId = value.runId; this.active.set(runId, context.controller);
      }
      context.emit(kind, value);
    });
    const model = selectModel(config, params.model === undefined ? undefined : text(params.model, 'model', 200));
    this.controllers.add(context.controller);
    const promise = runLocal({ store: this.store, config, model,
      chatId, prompt, cwd: this.boot.cwd, configPath: this.boot.config, native: params.native,
      approve: async (description, signal) => {
        const prompt = redactProtectedString(description, config.protectedValues);
        const approved = await context.approve(prompt, signal);
        if (runId) output.event({ ...this.store.event(runId, 'surface.approval.decided', {
          principal: 'local-owner', channelId: context.channelId, transport: this.boot.transport,
          promptHash: createHash('sha256').update(prompt).digest('hex'), approved,
        }), chatId });
        return approved;
      }, processEnv: commandEnvironment(this.boot.env), signal: context.signal, output });
    this.jobs.add(promise);
    try { return { runId: await promise }; }
    finally { this.controllers.delete(context.controller); this.jobs.delete(promise); if (runId) this.active.delete(runId); }
  }

  private cancel(params: UnknownRecord): unknown {
    keys(params, ['runId'], 'execution.runs.cancel'); const id = uuid(params.runId);
    const controller = this.active.get(id);
    if (controller) controller.abort();
    return { runId: id, cancellationRequested: !!controller, run: this.store.run(id) };
  }

  private recover(params: UnknownRecord): unknown {
    keys(params, [], 'admin.recover'); removeDeadLock(this.store.directory);
    const unlock = executionLock(this.store.directory);
    try { this.store.recover(); } finally { unlock(); }
    return { recovered: true, actionsReplayed: false };
  }

  private async mcp(params: UnknownRecord, context: RequestContext): Promise<unknown> {
    keys(params, ['id', 'configIdentity'], 'admin.mcp.discover'); this.configuration(params);
    const secrets: string[] = [];
    const servers = parseMcpServers(configDocument(this.boot.config).mcp, this.boot.env, this.boot.config, secrets,
      params.id === undefined ? undefined : text(params.id, 'MCP id', 100));
    const protectedValues = normalizeProtectedValues(secrets);
    const host = await McpHost.connect(servers, protectedValues, commandEnvironment(this.boot.env), AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]));
    try {
      const value = sanitizeProtectedValueJson({ scope: 'local', tools: host.catalog.map(tool => tool.function), availability: host.availability }, protectedValues);
      if (!value.success) throw new CliError('protected_output', 'MCP metadata contains a protected key.');
      return value.value;
    } finally { await host.close(); }
  }

  async stop(): Promise<void> {
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled(this.jobs);
    this.store.close();
  }
}
