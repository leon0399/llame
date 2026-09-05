import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Readable, type Writable } from 'node:stream';
import { isRecord, isString } from '@workspace/runtime-safety';
import { CliError } from '@workspace/personal-node/errors';
import { privateDirectory } from '@workspace/personal-node/private-files';
import { assertPrivateSocket, socketPath } from '@workspace/personal-node/socket';
import { JsonLines } from '@workspace/personal-node/json-lines';
import { MAX_RESPONSE_BYTES } from '@workspace/personal-node/protocol';
import { record, text, uuid } from '@workspace/personal-node/validation';
import { type Approval } from '@workspace/personal-node/types';
import { type Options } from './arguments';
import { Output } from './output';

interface Pending {
  readonly method: string;
  readonly signal: AbortSignal;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly abort: () => void;
  asking: boolean;
  cancellationTimer?: ReturnType<typeof setTimeout>;
}

/** Thin protocol client. Never opens SQLite, executes a tool, or resolves a key. */
export class NodeClient {
  private readonly pending = new Map<string, Pending>();
  private failure?: CliError;
  private readonly exited?: Promise<void>;

  private constructor(input: Readable, private readonly writer: Writable, private readonly output: Output,
    private readonly approve: Approval, private readonly child?: ChildProcessWithoutNullStreams) {
    const reader = new JsonLines(MAX_RESPONSE_BYTES, value => this.receive(value));
    input.on('data', (data: Buffer) => {
      try { reader.push(data); }
      catch { this.fail(new CliError('node_protocol', 'Invalid response from the local Node.')); }
    });
    input.once('end', () => this.fail(new CliError('node_disconnected', 'Local Node disconnected. Inspect Chats/Runs before retrying; no request was resubmitted.')));
    input.once('error', () => this.fail(new CliError('node_disconnected', 'Local Node connection failed.')));
    writer.on('error', () => this.fail(new CliError('node_disconnected', 'Local Node connection closed.')));
    if (child) {
      this.exited = new Promise(done => child.once('close', () => done()));
      child.once('error', () => this.fail(new CliError('node_start_failed', 'Could not launch the bundled personal Node. Build its workspace first.')));
      // Runtime diagnostics are deliberately generic; they never contain config or raw SDK errors.
      child.stderr.resume();
    }
  }

  static async open(options: Options, env: NodeJS.ProcessEnv, output: Output, approve: Approval, signal: AbortSignal): Promise<NodeClient> {
    privateDirectory(options.data);
    const path = process.platform === 'win32' ? undefined : socketPath(options.data);
    let client: NodeClient;
    if (path && existsSync(path)) {
      assertPrivateSocket(path);
      const socket = connect(path);
      client = new NodeClient(socket, socket, output, approve);
    } else {
      if (existsSync(join(options.data, 'node-server.json'))) throw new CliError('node_unavailable', 'The configured local Node is starting or stopped uncleanly. Inspect it and use node recover; no other executor was selected.');
      const args = [require.resolve('@workspace/personal-node/server'), '--stdio', '--config', options.config,
        '--data-dir', options.data, '--cwd', options.cwd, ...(options.native ? ['--native'] : [])];
      const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      client = new NodeClient(child.stdout, child.stdin, output, approve, child);
    }
    try {
      const hello = record(await client.call('core.hello', { version: 1 }, AbortSignal.any([signal, AbortSignal.timeout(5000)])), 'Node hello');
      if (hello.version !== 1 || hello.principal !== 'local-owner' || !isRecord(hello.modules) || hello.modules.core !== 1) {
        throw new CliError('protocol_version', 'Incompatible local Node protocol.');
      }
      uuid(hello.nodeId);
      return client;
    } catch (error) { await client.close(); throw error; }
  }

  async call(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new CliError('cancelled', 'Local request cancelled.', 130);
    if (this.failure) throw this.failure;
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.send({ jsonrpc: '2.0', id: randomUUID(), method: 'core.cancel', params: { requestId: id } });
        const finish = () => {
          this.pending.delete(id); reject(new CliError('cancelled', 'Local request cancelled. Inspect its Run before retrying.', 130));
        };
        const pending = this.pending.get(id);
        // Keep receiving the durable terminal event before closing the channel.
        if (method === 'execution.run' && pending) pending.cancellationTimer = setTimeout(finish, 5000);
        else finish();
      };
      this.pending.set(id, { method, signal, resolve, reject, abort, asking: false });
      signal.addEventListener('abort', abort, { once: true });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private send(value: unknown): void {
    if (!this.writer.destroyed && !this.writer.writableEnded) this.writer.write(JSON.stringify(value) + '\n');
  }

  private receive(value: unknown): void {
    const frame = record(value, 'Node response');
    if (frame.jsonrpc !== '2.0') throw new CliError('node_protocol', 'Expected JSON-RPC 2.0.');
    if (frame.method === 'core.error') {
      const error = record(frame.params, 'Node error');
      this.fail(new CliError(text(error.code, 'code', 100), text(error.message, 'message', 1000))); return;
    }
    if (frame.method) { this.notification(text(frame.method, 'notification', 100), record(frame.params, 'params')); return; }
    const id = text(frame.id, 'response id', 100); const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id); clearTimeout(pending.cancellationTimer); pending.signal.removeEventListener('abort', pending.abort);
    if (frame.error !== undefined) {
      const error = record(frame.error, 'error'); const data = record(error.data, 'error data');
      pending.reject(new CliError(text(data.code, 'code', 100), text(error.message, 'error message', 2000),
        typeof data.exitCode === 'number' && Number.isInteger(data.exitCode) && data.exitCode > 0 && data.exitCode <= 255 ? data.exitCode : 1));
    } else if (pending.signal.aborted) pending.reject(new CliError('cancelled', 'Local request cancelled.', 130));
    else pending.resolve(frame.result);
  }

  private notification(method: string, params: Record<string, unknown>): void {
    const pending = this.pending.get(text(params.requestId, 'request id', 100));
    if (!pending || pending.method !== 'execution.run') return;
    if (method === 'execution.approval.requested') {
      if (pending.asking) throw new CliError('approval_overlap', 'Node sent overlapping approval requests.');
      pending.asking = true;
      const id = uuid(params.approvalId); const prompt = text(params.prompt, 'approval prompt', 262_144);
      void this.approve(prompt, pending.signal).then(approved => this.call('execution.approval.decide', { approvalId: id, approved }, pending.signal))
        .catch(() => undefined).finally(() => { pending.asking = false; });
      return;
    }
    if (method !== 'execution.output') throw new CliError('node_protocol', 'Unknown Node notification.');
    if (params.kind === 'text' && isString(params.value)) { this.output.text(params.value); return; }
    if (params.kind === 'notice' && isString(params.value)) { this.output.notice(params.value); return; }
    if (params.kind === 'event') {
      const event = record(params.value, 'event');
      this.output.event({ eventType: text(event.eventType, 'eventType', 100), payload: event.payload,
        runId: event.runId === undefined ? undefined : uuid(event.runId), chatId: event.chatId === undefined ? undefined : uuid(event.chatId),
        sequence: typeof event.sequence === 'number' ? event.sequence : undefined }); return;
    }
    throw new CliError('node_protocol', 'Invalid Node output notification.');
  }

  private fail(error: CliError): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.cancellationTimer); pending.signal.removeEventListener('abort', pending.abort); pending.reject(this.failure);
    }
    this.pending.clear();
  }

  async close(): Promise<void> {
    this.writer.end();
    if (!this.child || !this.exited) return;
    const terminate = setTimeout(() => this.child?.kill('SIGTERM'), 3000);
    const kill = setTimeout(() => this.child?.kill('SIGKILL'), 5000);
    await this.exited; clearTimeout(terminate); clearTimeout(kill);
  }
}
