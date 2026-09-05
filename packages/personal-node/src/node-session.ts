import { NodeProtocolError, protocolError } from '@workspace/node-protocol';
import { randomUUID } from 'node:crypto';
import { type Readable, type Writable } from 'node:stream';
import { isBoolean } from '@workspace/runtime-safety';
import { NodeService } from './node-service';
import { CliError } from './errors';
import { keys, text, uuid } from './validation';
import { JsonLines } from './json-lines';
import { nodeRequest, MAX_CONNECTION_REQUESTS, MAX_PENDING_REQUESTS, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, type NodeRequest } from './protocol';

/** One authenticated local-owner channel. Approval decisions never cross it. */
export class NodeSession {
  private readonly channelId = randomUUID();
  private closed = false;
  private initialized = false;
  private readonly seen = new Set<string>();
  private readonly requests = new Map<string, { controller: AbortController; method: string }>();
  private readonly approvals = new Map<string, (approved: boolean) => void>();
  private readonly jobs = new Set<Promise<void>>();

  constructor(private readonly service: NodeService, input: Readable, private readonly output: Writable,
    private readonly persistent: boolean) {
    const reader = new JsonLines(MAX_REQUEST_BYTES, value => this.accept(value));
    input.on('data', (data: Buffer) => {
      try { reader.push(data); }
      catch (error) { this.failure(null, error); this.close(); output.end(); }
    });
    input.once('end', () => { this.close(); output.end(); });
    input.once('error', () => this.close());
    output.once('error', () => this.close());
    output.once('close', () => this.close());
  }

  private send(value: unknown): void {
    if (this.closed || this.output.destroyed || this.output.writableEnded) return;
    const frame = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(frame) > MAX_RESPONSE_BYTES || this.output.writableLength > MAX_RESPONSE_BYTES) {
      // Durable events remain readable. A slow observer cannot exhaust Node memory.
      this.close(); this.output.destroy(); return;
    }
    this.output.write(frame);
  }

  private failure(id: string | null, error: unknown): void {
    if (error instanceof NodeProtocolError) { this.send({ jsonrpc: '2.0', id, error: protocolError(error) }); return; }
    const failure = error instanceof CliError ? error : new CliError('node_operation_failed', 'Node operation failed. Inspect durable state before retrying.');
    this.send({ jsonrpc: '2.0', id, error: { code: failure.code === 'method_unknown' ? -32601 : -32000,
      message: failure.message, data: { code: failure.code, exitCode: failure.exitCode } } });
  }

  private accept(value: unknown): void {
    if (this.closed) return;
    let request: NodeRequest;
    try { request = nodeRequest(value); }
    catch (error) { this.failure(null, error); return; }
    if (this.seen.has(request.id)) { this.failure(request.id, new CliError('request_duplicate', 'Request ID was already used on this connection.')); return; }
    if (this.seen.size >= MAX_CONNECTION_REQUESTS || this.requests.size >= MAX_PENDING_REQUESTS) {
      this.failure(request.id, new CliError('protocol_limit', 'Node connection request limit reached.')); return;
    }
    this.seen.add(request.id);
    const controller = new AbortController();
    this.requests.set(request.id, { controller, method: request.method });
    const task = this.respond(request, controller).finally(() => {
      this.requests.delete(request.id); this.jobs.delete(task);
    });
    this.jobs.add(task);
  }

  private async respond(request: NodeRequest, controller: AbortController): Promise<void> {
    try {
      let result: unknown;
      if (request.method === 'core.hello') {
        if (this.initialized) throw new CliError('protocol_sequence', 'This connection already negotiated its protocol.');
        result = this.service.hello(request.params); this.initialized = true;
      } else {
        if (!this.initialized) throw new CliError('handshake_required', 'Negotiate core.hello before using Node capabilities.');
        result = await this.dispatch(request, controller);
      }
      this.send({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) { this.failure(request.id, error); }
  }

  private async dispatch(request: NodeRequest, controller: AbortController): Promise<unknown> {
    const { method, params } = request;
    if (method === 'core.cancel') {
      keys(params, ['requestId'], method); const target = this.requests.get(text(params.requestId, 'requestId', 100));
      target?.controller.abort(); return { cancellationRequested: !!target };
    }
    if (method === 'execution.approval.decide') {
      keys(params, ['approvalId', 'approved'], method);
      const id = uuid(params.approvalId);
      if (!isBoolean(params.approved)) throw new CliError('approval_invalid', 'approved must be a boolean.');
      const resolve = this.approvals.get(id);
      if (!resolve) throw new CliError('approval_unknown', 'Approval is not pending on this connection.');
      resolve(params.approved); return { accepted: true };
    }
    return this.service.dispatch(method, params, {
      channelId: this.channelId, controller, signal: controller.signal,
      approve: (prompt, signal) => this.ask(request.id, prompt, signal),
      emit: (kind, value) => this.send({ jsonrpc: '2.0', method: 'execution.output', params: { requestId: request.id, kind, value } }),
    });
  }

  private async ask(requestId: string, prompt: string, signal: AbortSignal): Promise<boolean> {
    if (this.closed || signal.aborted) return false;
    const id = randomUUID();
    return new Promise<boolean>(resolve => {
      const finish = (approved: boolean) => {
        signal.removeEventListener('abort', deny); this.approvals.delete(id); resolve(approved);
      };
      const deny = () => finish(false);
      this.approvals.set(id, finish);
      signal.addEventListener('abort', deny, { once: true });
      this.send({ jsonrpc: '2.0', method: 'execution.approval.requested', params: { requestId, approvalId: id, prompt } });
    });
  }

  close(force = false): void {
    this.closed = true;
    for (const resolve of this.approvals.values()) resolve(false);
    for (const request of this.requests.values()) {
      if (force || !this.persistent || request.method !== 'execution.run') request.controller.abort();
    }
  }

  async settled(): Promise<void> { await Promise.allSettled(this.jobs); }
}
