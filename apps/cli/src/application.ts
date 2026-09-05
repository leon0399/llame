import { mcpCommand } from './mcp-commands';
import { randomUUID } from 'node:crypto';
import { type Options } from './arguments';
import { initializeConfig, configDocument, remoteConfiguration, configureRemote } from '@workspace/personal-node/config';
import { CliError } from '@workspace/personal-node/errors';
import { Output } from './output';
import { Auth } from './auth';
import { Remote } from './remote';
import { approvals, password, question, readStdin } from './terminal';
import { record, text, uuid } from '@workspace/personal-node/validation';
import { NodeClient } from './node-client';
import { RemoteCursors } from './remote-cursors';
import { pathIdentity } from '@workspace/personal-node/protocol';
import { recoverServer } from '@workspace/personal-node/socket';
import { setTimeout as delay } from 'node:timers/promises';

export class Application {
  private node?: NodeClient;
  constructor(private readonly options: Options, private readonly env: NodeJS.ProcessEnv,
    private readonly output: Output, private readonly signal: AbortSignal) {}

  async execute(): Promise<void> {
    try { await this.executeCommand(); }
    finally { await this.node?.close(); }
  }

  private async localClient(): Promise<NodeClient> {
    this.node ??= await NodeClient.open(this.options, this.env, this.output, approvals(this.output), this.signal);
    return this.node;
  }

  private async local(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return (await this.localClient()).call(method, params, this.signal);
  }

  private async executeCommand(): Promise<void> {
    const { positionals } = this.options;
    if (positionals[0] === 'mcp') { await mcpCommand(this.options, this.output, id => this.local('admin.mcp.discover', { id, configIdentity: pathIdentity(this.options.config) })); return; }
    if (positionals[0] === 'node') { await this.nodeCommand(); return; }
    if (positionals[0] === 'remote') { this.connection(); return; }
    if (positionals[0] === 'auth') { await this.auth(positionals[1] || 'status'); return; }
    if (positionals[0] === 'config') {
      if (this.options.remote || positionals[1] !== 'init') throw new CliError('command', 'Use config init in local mode.');
      initializeConfig(this.options.config); this.output.notice(`Created ${this.options.config}; set the provider model name before running.`); return;
    }
    await this.withNode();
  }

  private async nodeCommand(): Promise<void> {
    const [, action = 'status', ...extra] = this.options.positionals;
    if (extra.length || this.options.remote) throw new CliError('arguments', 'Use node serve/status/recover locally.');
    if (action === 'serve') {
      const { serveNode } = await import('@workspace/personal-node/server');
      await serveNode({ data: this.options.data, config: this.options.config, cwd: this.options.cwd,
        native: this.options.native, transport: 'unix', env: this.env }); return;
    }
    if (action === 'recover') { recoverServer(this.options.data); this.output.value({ endpointRecovered: true, actionsReplayed: false }); return; }
    if (action !== 'status') throw new CliError('command', 'Use node serve, node status, or node recover.');
    this.output.value(await this.local('core.status'));
  }

  private async withNode(): Promise<void> {
    const [command, action, id] = this.options.positionals;
    if (command === 'status') {
      this.output.value({ mode: this.options.remote ? 'remote' : 'local', modeSource: this.options.modeSource,
        remote: this.options.remote ?? null, ...(this.options.remote ? {} : record(await this.local('core.status'), 'Node status')), enrolled: false }); return;
    }
    if (command === 'search' && action === 'rebuild' && !id && !this.options.remote) {
      this.output.value(await this.local('admin.search.rebuild')); return;
    }
    if (command === 'recover') {
      if (this.options.remote) throw new CliError('command', 'recover applies only to the local executor.');
      await this.local('admin.recover');
      this.output.notice('Local recovery complete. Interrupted runs were marked; no action was replayed.'); return;
    }
    const remote = this.options.remote ? new Remote(await this.authClient().credential(this.env, this.signal), new RemoteCursors(this.options.data), this.output) : undefined;
    if (command === 'models') { await this.models(remote); return; }
    if (command === 'knowledge') { await this.knowledge(remote, action, id); return; }
    if (command === 'chats') { await this.chats(remote, action, id); return; }
    if (command === 'runs') { await this.runs(remote, action, id); return; }
    if (command && command !== 'run') throw new CliError('command', 'Unknown command. Use --help.');
    if (command === 'run' || !process.stdin.isTTY) {
      const words = this.options.positionals.slice(command === 'run' ? 1 : 0);
      if (!words.length && process.stdin.isTTY) throw new CliError('prompt_required', 'Provide a prompt, or use run - to read until EOF.');
      if (!words.length || words.join(' ') === '-') this.output.notice('Reading prompt from standard input (Ctrl-C cancels).');
      const prompt = words.length && words.join(' ') !== '-' ? words.join(' ') : await readStdin(80_000, this.signal);
      await this.turn(remote, this.options.chat || randomUUID(), prompt, this.options.model); return;
    }
    await this.repl(remote);
  }

  private async turn(remote: Remote | undefined, chat: string, prompt: string, model?: string): Promise<void> {
    if (!text(prompt, 'prompt').trim()) throw new CliError('empty_prompt', 'Prompt must not be blank.');
    if (remote) { await remote.run(chat, prompt, model, this.options.effort, this.signal); return; }
    if (this.options.native) this.output.notice('Native Workspace enabled: OS-user authority, not a sandbox. Each edit/process still requires approval.');
    await this.local('execution.run', { chatId: chat, prompt, model, native: this.options.native,
      configIdentity: pathIdentity(this.options.config), workspaceIdentity: this.options.native ? pathIdentity(this.options.cwd) : undefined });
  }

  private async models(remote?: Remote): Promise<void> {
    this.output.value(remote ? await remote.json('/api/v1/models', this.signal)
      : await this.local('realm.models.list', { configIdentity: pathIdentity(this.options.config) }));
  }

  private async chats(remote: Remote | undefined, action?: string, id?: string): Promise<void> {
    if (!action || action === 'list') { this.output.value(remote ? await remote.json('/api/v1/chats', this.signal) : await this.local('realm.chats.list')); return; }
    if (action === 'search') {
      const query = text(this.options.positionals.slice(2).join(' '), 'search query', 200).trim();
      if (!query) throw new CliError('query_required', 'Use chats search QUERY.');
      this.output.value(remote ? await remote.json(`/api/v1/chats/search?${new URLSearchParams({ q: query, limit: '20' })}`, this.signal) : await this.local('realm.chats.search', { query })); return;
    }
    if (action === 'read' && !remote) {
      const args = this.options.positionals.slice(2);
      if (args.length < 2 || args.length > 4) throw new CliError('arguments', 'Use chats read UUID SEQ [OFFSET] [LIMIT].');
      this.output.value(await this.local('realm.conversations.read', { chatId: uuid(id), messageSeq: Number(args[1]),
        offset: args[2] === undefined ? undefined : Number(args[2]), limit: args[3] === undefined ? undefined : Number(args[3]) })); return;
    }
    if (action !== 'show') throw new CliError('command', 'Use chats list, chats show UUID, or chats search QUERY.');
    const chatId = uuid(id);
    this.output.value(remote ? await remote.json(`/api/v1/chats/${chatId}/messages`, this.signal) : await this.local('realm.chats.read', { chatId }));
  }

  private async knowledge(remote: Remote | undefined, action = 'list', id?: string): Promise<void> {
    if (!remote) { await this.localKnowledge(action, id); return; }
    if (this.options.positionals.length > 3) throw new CliError('arguments', 'Use knowledge list [CURSOR] or knowledge show UUID.');
    if (action === 'list') {
      const query = new URLSearchParams({ limit: '50' });
      if (id) query.set('after', text(id, 'Knowledge Space cursor', 2048));
      this.output.value(await remote.json(`/api/v1/knowledge-spaces?${query}`, this.signal)); return;
    }
    if (action === 'show') { this.output.value(await remote.json(`/api/v1/knowledge-spaces/${uuid(id)}`, this.signal)); return; }
    throw new CliError('command', 'Use knowledge list [CURSOR] or knowledge show UUID. Ask the remote assistant to search/read their contents.');
  }

  private async localKnowledge(action: string, id?: string): Promise<void> {
    const args = this.options.positionals.slice(2);
    if (action === 'list' && !args.length) { this.output.value(await this.local('realm.knowledge.list')); return; }
    if (action === 'create') { this.output.value(await this.local('realm.knowledge.create', { name: text(args.join(' '), 'Knowledge name', 100) })); return; }
    if (action === 'show' && args.length === 1) { this.output.value(await this.local('realm.knowledge.get', { knowledgeSpaceId: uuid(id) })); return; }
    if (action === 'search') { this.output.value(await this.local('realm.knowledge.search', { query: text(args.join(' '), 'query', 200) })); return; }
    if (action === 'read' && args.length >= 2 && args.length <= 4) {
      this.output.value(await this.local('realm.knowledge.read', { knowledgeSpaceId: uuid(id), path: args[1],
        offset: args[2] === undefined ? undefined : Number(args[2]), limit: args[3] === undefined ? undefined : Number(args[3]) })); return;
    }
    throw new CliError('command', 'Use knowledge list/create NAME/show UUID/search QUERY/read UUID PATH [OFFSET] [LIMIT].');
  }

  private async runs(remote: Remote | undefined, action?: string, id?: string): Promise<void> {
    if (action === 'list' && !remote && !id) { this.output.value(await this.local('execution.runs.list')); return; }
    const runId = uuid(id);
    if (action === 'show') { this.output.value(remote ? await remote.json(`/api/v1/runs/${runId}`, this.signal) : await this.local('execution.runs.get', { runId })); return; }
    if (action === 'events' || action === 'follow') {
      if (remote) await remote.follow(runId, this.signal, this.options.after);
      else await this.localEvents(runId, action === 'follow');
      return;
    }
    if (action === 'tools' || action === 'receipt') {
      if (this.options.positionals.length !== 3) throw new CliError('arguments', 'Use runs tools/receipt UUID.');
      const receipt = remote
        ? record(await remote.json(`/api/v1/runs/${runId}/context-receipt`, this.signal), 'context receipt')
        : record(record(await this.local('execution.runs.get', { runId }), 'local Run').snapshot, 'local context receipt');
      this.output.value(action === 'receipt' ? receipt : {
        runId, mode: remote ? 'remote' : 'local',
        tools: receipt.tools,
        toolAvailability: receipt.toolAvailability ?? { version: 0, state: 'unobserved' },
        availabilityHash: receipt.availabilityHash ?? null,
        historical: true,
      }); return;
    }
    if (!remote) {
      if (action === 'cancel') { this.output.value(await this.local('execution.runs.cancel', { runId })); return; }
      throw new CliError('command', 'Use runs list/show/events/follow/tools/receipt/cancel locally.');
    }
    if (action === 'attach') { await remote.attach(runId, this.signal); return; }
    if (action === 'cancel') { this.output.value(await remote.json(`/api/v1/runs/${runId}`, this.signal, 'PATCH', { status: 'cancelled' })); return; }
    throw new CliError('command', 'Unknown runs command. Use --help.');
  }

  private async localEvents(runId: string, follow: boolean): Promise<void> {
    let after = this.options.after ?? 0;
    for (;;) {
      const page = record(await this.local('execution.runs.events', { runId, after }), 'events page');
      if (!Array.isArray(page.events)) throw new CliError('node_protocol', 'Invalid events page.');
      for (const event of page.events) {
        const entry = record(event, 'event');
        if (typeof entry.sequence !== 'number' || entry.sequence <= after) throw new CliError('node_protocol', 'Invalid event sequence.');
        this.output.value(entry); after = entry.sequence;
      }
      if (page.hasMore === true) continue;
      if (!follow) return;
      if (page.status !== 'running') return;
      await delay(100, undefined, { signal: this.signal });
    }
  }

  private async repl(remote?: Remote): Promise<void> {
    let chat = this.options.chat || randomUUID(); let model = this.options.model;
    this.output.notice(`llame ${remote ? 'remote' : 'local'} · /help for commands · chat=${chat}`);
    for (;;) {
      const line = (await question('llame> ', this.signal)).trim();
      if (!line) continue;
      if (line === '/exit') return;
      if (line === '/help') { this.output.notice('/new · /model ID · /history · /exit. Ctrl-C exits; remote work continues.'); continue; }
      if (line === '/new') { chat = randomUUID(); this.output.notice(`chat=${chat}`); continue; }
      if (line.startsWith('/model ')) { model = line.slice(7).trim(); this.output.notice(`model=${model}`); continue; }
      if (line === '/history') { await this.chats(remote, 'show', chat); continue; }
      if (line.startsWith('/')) { this.output.notice('Unknown slash command. Use /help.'); continue; }
      try { await this.turn(remote, chat, line, model); }
      catch (error) {
        if (this.signal.aborted) throw error;
        this.output.notice(error instanceof CliError ? `${error.code}: ${error.message}` : 'Run failed. Inspect recorded events.');
      }
    }
  }

  private connection(): void {
    const [, action = 'status', url, ...extra] = this.options.positionals;
    if (extra.length || (action !== 'enable' && url)) throw new CliError('arguments', 'Use remote enable [URL], remote disable, or remote status.');
    if (action === 'status') {
      this.output.value({ remote: remoteConfiguration(configDocument(this.options.config)) }); return;
    }
    if (action !== 'enable' && action !== 'disable') throw new CliError('command', 'Use remote enable [URL], remote disable, or remote status.');
    const remote = configureRemote(this.options.config, action === 'enable', url);
    this.output.value({ remote, authentication: 'unchanged' });
    this.output.notice(remote.enabled ? 'Remote is now the default. Use auth login to authenticate, or --local for one standalone invocation.' : 'Local is now the default. Saved remote credentials were retained; auth logout revokes a session.');
  }

  private authClient(): Auth {
    const remote = this.options.remote ?? (this.options.modeSource !== 'flag'
      ? remoteConfiguration(configDocument(this.options.config)).url : undefined);
    if (!remote) throw new CliError('remote_required', 'Configure a remote with remote enable URL or supply --remote URL. Standalone mode has no account.');
    return new Auth(remote, this.options.data, this.output);
  }

  private async auth(action: string): Promise<void> {
    const auth = this.authClient();
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]);
    if (action === 'forget') { auth.forget(); this.output.notice('Local credential removed. Remote session was NOT revoked.'); return; }
    if (action === 'login') {
      const email = this.options.email || await question('Email: ', signal);
      const secret = this.options.passwordStdin ? await readStdin(1024, signal) : await password(signal);
      const credential = await auth.login(email, text(secret, 'password', 256), signal);
      this.output.value({ authenticated: true, authority: credential.authority, userId: credential.userId, enrolled: false }); return;
    }
    if (action === 'import') {
      if (!this.options.tokenStdin) throw new CliError('token_input', 'Use auth import --token-stdin. Tokens are never accepted in argv.');
      const credential = await auth.importToken(await readStdin(4096, signal), signal);
      this.output.value({ authenticated: true, authority: credential.authority, userId: credential.userId, enrolled: false }); return;
    }
    if (action !== 'status' && action !== 'logout') throw new CliError('command', 'Unknown auth command. Use --help.');
    if (action === 'logout') { await auth.logout(auth.session(this.env), signal); this.output.notice('Remote session revoked or already expired; its saved local credential was removed.'); return; }
    const credential = await auth.credential(this.env, signal);
    this.output.value({ authenticated: true, authority: credential.authority, userId: credential.userId, source: credential.source, enrolled: false });
  }
}
