import { randomUUID } from 'node:crypto';
import { type Options } from './arguments';
import { initializeConfig, loadConfig, selectModel } from './config';
import { commandEnvironment } from './env';
import { CliError } from './errors';
import { LocalStore } from './store';
import { Output } from './output';
import { runLocal } from './local-run';
import { Auth } from './auth';
import { Remote } from './remote';
import { approvals, password, question, readStdin } from './terminal';
import { text, uuid } from './validation';
import { executionLock, removeDeadLock } from './execution-lock';

export class Application {
  constructor(private readonly options: Options, private readonly env: NodeJS.ProcessEnv,
    private readonly output: Output, private readonly signal: AbortSignal) {}

  async execute(): Promise<void> {
    const { positionals } = this.options;
    if (positionals[0] === 'auth') { await this.auth(positionals[1] || 'status'); return; }
    if (positionals[0] === 'config') {
      if (this.options.remote || positionals[1] !== 'init') throw new CliError('command', 'Use config init in local mode.');
      initializeConfig(this.options.config); this.output.notice(`Created ${this.options.config}; set the provider model name before running.`); return;
    }
    const store = new LocalStore(this.options.data);
    try { await this.withStore(store); }
    finally { store.close(); }
  }

  private async withStore(store: LocalStore): Promise<void> {
    const [command, action, id] = this.options.positionals;
    if (command === 'status') {
      this.output.value({ mode: this.options.remote ? 'remote' : 'local', nodeId: store.nodeId, remote: this.options.remote ?? null, enrolled: false }); return;
    }
    if (command === 'recover') {
      if (this.options.remote) throw new CliError('command', 'recover applies only to the local executor.');
      removeDeadLock(store.directory); const unlock = executionLock(store.directory);
      try { store.recover(); } finally { unlock(); }
      this.output.notice('Local recovery complete. Interrupted runs were marked; no action was replayed.'); return;
    }
    const remote = this.options.remote ? new Remote(await this.authClient().credential(this.env, this.signal), store, this.output) : undefined;
    if (command === 'models') { await this.models(remote); return; }
    if (command === 'chats') { await this.chats(store, remote, action, id); return; }
    if (command === 'runs') { await this.runs(store, remote, action, id); return; }
    if (command && command !== 'run') throw new CliError('command', 'Unknown command. Use --help.');
    if (command === 'run' || !process.stdin.isTTY) {
      const words = this.options.positionals.slice(command === 'run' ? 1 : 0);
      if (!words.length && process.stdin.isTTY) throw new CliError('prompt_required', 'Provide a prompt, or use run - to read until EOF.');
      const prompt = words.length && words.join(' ') !== '-' ? words.join(' ') : await readStdin(80_000, this.signal);
      await this.turn(store, remote, this.options.chat || randomUUID(), prompt, this.options.model); return;
    }
    await this.repl(store, remote);
  }

  private async turn(store: LocalStore, remote: Remote | undefined, chat: string, prompt: string, model?: string): Promise<void> {
    if (!text(prompt, 'prompt').trim()) throw new CliError('empty_prompt', 'Prompt must not be blank.');
    if (remote) { await remote.run(chat, prompt, model, this.options.effort, this.signal); return; }
    const config = loadConfig(this.options.config, this.env); this.output.protect(config.protectedValues);
    if (this.options.native) this.output.notice('Native Workspace enabled: OS-user authority, not a sandbox. Each edit/process still requires approval.');
    await runLocal({ store, config, model: selectModel(config, model), chatId: chat, prompt,
      cwd: this.options.cwd, configPath: this.options.config, native: this.options.native,
      approve: approvals(this.output), processEnv: commandEnvironment(this.env), signal: this.signal, output: this.output });
  }

  private async models(remote?: Remote): Promise<void> {
    if (remote) { this.output.value(await remote.json('/api/v1/models', this.signal)); return; }
    const config = loadConfig(this.options.config, this.env); this.output.protect(config.protectedValues);
    this.output.value({ defaultModel: config.defaultModel ?? null,
      models: config.models.map(({ id, model, baseUrl }) => ({ id, model, baseUrl })) });
  }

  private async chats(store: LocalStore, remote: Remote | undefined, action?: string, id?: string): Promise<void> {
    if (!action || action === 'list') { this.output.value(remote ? await remote.json('/api/v1/chats', this.signal) : store.chats()); return; }
    if (action !== 'show') throw new CliError('command', 'Use chats list or chats show UUID.');
    const chatId = uuid(id);
    this.output.value(remote ? await remote.json(`/api/v1/chats/${chatId}/messages`, this.signal) : store.history(chatId));
  }

  private async runs(store: LocalStore, remote: Remote | undefined, action?: string, id?: string): Promise<void> {
    const runId = uuid(id);
    if (action === 'show') { this.output.value(remote ? await remote.json(`/api/v1/runs/${runId}`, this.signal) : store.run(runId)); return; }
    if (action === 'events') {
      if (remote) await remote.follow(runId, this.signal, this.options.after);
      else for (const event of store.events(runId, this.options.after)) this.output.value(event);
      return;
    }
    if (!remote) throw new CliError('command', 'Use runs show/events locally. Cancel a local executor with Ctrl-C.');
    if (action === 'attach') { await remote.attach(runId, this.signal); return; }
    if (action === 'receipt') { this.output.value(await remote.json(`/api/v1/runs/${runId}/context-receipt`, this.signal)); return; }
    if (action === 'cancel') { this.output.value(await remote.json(`/api/v1/runs/${runId}`, this.signal, 'PATCH', { status: 'cancelled' })); return; }
    throw new CliError('command', 'Unknown runs command. Use --help.');
  }

  private async repl(store: LocalStore, remote?: Remote): Promise<void> {
    let chat = this.options.chat || randomUUID(); let model = this.options.model;
    this.output.notice(`llame ${remote ? 'remote' : 'local'} · /help for commands · chat=${chat}`);
    for (;;) {
      const line = (await question('llame> ', this.signal)).trim();
      if (!line) continue;
      if (line === '/exit') return;
      if (line === '/help') { this.output.notice('/new · /model ID · /history · /exit. Ctrl-C exits; remote work continues.'); continue; }
      if (line === '/new') { chat = randomUUID(); this.output.notice(`chat=${chat}`); continue; }
      if (line.startsWith('/model ')) { model = line.slice(7).trim(); this.output.notice(`model=${model}`); continue; }
      if (line === '/history') { await this.chats(store, remote, 'show', chat); continue; }
      if (line.startsWith('/')) { this.output.notice('Unknown slash command. Use /help.'); continue; }
      try { await this.turn(store, remote, chat, line, model); }
      catch (error) {
        if (this.signal.aborted) throw error;
        this.output.notice(error instanceof CliError ? `${error.code}: ${error.message}` : 'Run failed. Inspect recorded events.');
      }
    }
  }

  private authClient(): Auth {
    if (!this.options.remote) throw new CliError('remote_required', 'Authentication needs an explicit --remote URL. Standalone mode has no account.');
    return new Auth(this.options.remote, this.options.data, this.output);
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
