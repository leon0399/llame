import { parseNodeRequest, queryParams, NODE_REQUEST_PATH, NODE_PRINCIPAL_HEADER, NODE_VERSION_HEADER, NODE_REQUEST_MAX_BYTES, NODE_RESULT_MAX_BYTES } from '@workspace/node-protocol';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { type UnknownRecord, isRecord, isString } from '@workspace/runtime-safety';
import { type Credential } from './auth';
import { request, readJson, sse } from '@workspace/personal-node/http';
import { RemoteCursors } from './remote-cursors';
import { type ClientOutput } from './types';
import { SecretStream } from '@workspace/personal-node/output';
import { aborted, CliError } from '@workspace/personal-node/errors';
import { integer, parseJson, record, text, uuid } from '@workspace/personal-node/validation';

const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);

/** Thin client: the server remains the advancing executor and policy owner. */
export class Remote {
  private readonly base: string;
  private readonly headers: { authorization: string };
  constructor(private readonly credential: Credential, private readonly store: RemoteCursors, private readonly output: ClientOutput) {
    this.base = credential.authority; this.headers = { authorization: `Bearer ${credential.token}` };
    output.protect([credential.token]);
  }

  get authority(): string { return this.base; }
  get principalId(): string { return this.credential.userId; }

  /** Only the shared read contract crosses HTTP; local admin and execution IPC never do. */
  async call(method: string, params: UnknownRecord, signal: AbortSignal): Promise<unknown> {
    if (method !== 'core.describe') queryParams(method, params);
    const input = parseNodeRequest({ jsonrpc: '2.0', id: randomUUID(), method, params });
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > NODE_REQUEST_MAX_BYTES) throw new CliError('request_limit', 'Node request is too large.');
    const response = await request(this.base + NODE_REQUEST_PATH, {
      method: 'POST', headers: { ...this.headers, 'content-type': 'application/json',
        [NODE_VERSION_HEADER]: '1', [NODE_PRINCIPAL_HEADER]: this.credential.userId }, body,
    }, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
    const reply = record(await readJson(response, NODE_RESULT_MAX_BYTES + 4096), 'Node response');
    if (reply.jsonrpc !== '2.0' || reply.id !== input.id ||
      (Object.hasOwn(reply, 'error') === Object.hasOwn(reply, 'result'))) {
      throw new CliError('node_protocol', 'Uncorrelated or invalid Node response.');
    }
    if (reply.error !== undefined) {
      const error = record(reply.error, 'Node error'); const data = record(error.data, 'Node error data');
      // Never display a remote exception/stack or echo untrusted method/parameters.
      throw new CliError(text(data.code, 'error code', 100), 'The selected Node rejected the request. Check its advertised capabilities and account.');
    }
    return reply.result;
  }

  async json(path: string, signal: AbortSignal, method = 'GET', body?: unknown): Promise<unknown> {
    return readJson(await request(this.base + path, {
      method, headers: { ...this.headers, 'content-type': 'application/json', [NODE_VERSION_HEADER]: '1', [NODE_PRINCIPAL_HEADER]: this.credential.userId },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, AbortSignal.any([signal, AbortSignal.timeout(30_000)])));
  }

  async modelId(selected: string | undefined, signal: AbortSignal): Promise<string> {
    const catalogue = record(await this.json('/api/v1/models', signal), 'model catalogue');
    const id = selected || text(catalogue.defaultModelId, 'default model');
    if (!Array.isArray(catalogue.models) || !catalogue.models.some((model) => isRecord(model) && model.id === id)) {
      throw new CliError('unknown_model', 'Selected remote model is not available to this account.');
    }
    return id;
  }

  async run(chat: string, prompt: string, selected: string | undefined, effort: string | undefined, signal: AbortSignal): Promise<string> {
    const chatId = uuid(chat); const messageId = randomUUID();
    const modelId = await this.modelId(selected, signal);
    const body = { modelId, message: { id: messageId, parts: [{ type: 'text', text: prompt }] }, ...(effort ? { effort } : {}) };
    this.output.notice(`remote chat=${chatId} submission=${messageId}`);
    // Admission and event attachment are separate. Losing this response is
    // uncertain; never re-POST to a compatibility route or replay the message.
    let runId: string;
    try {
      const accepted = record(await this.json('/api/v1/runs', signal, 'POST', { chatId, ...body }), 'Run admission');
      runId = uuid(accepted.runId);
      if (accepted.chatId !== chatId || accepted.messageId !== messageId) throw new CliError('admission_binding', 'Run admission did not match the submitted message.');
    } catch (error) {
      if (error instanceof CliError && /^http_4\d\d$/.test(error.code)) throw error;
      throw new CliError('submission_uncertain', `Submission outcome is uncertain. Inspect remote chat ${chatId}; use runs attach ${chatId} for its active run. The message was NOT resubmitted.`);
    }
    this.output.notice(`remote run=${runId}`);
    this.store.saveCursor(this.base, this.credential.userId, runId, chatId, 0);
    await this.follow(runId, signal);
    return runId;
  }

  async attach(chatId: string, signal: AbortSignal): Promise<void> {
    const response = await request(`${this.base}/api/v1/chats/${uuid(chatId)}/stream`, { headers: this.headers }, signal);
    if (response.status === 204) { this.output.notice('No active remote run. Inspect chats show for completed history.'); return; }
    let runId: string | undefined;
    for await (const frame of sse(response)) {
      if (frame.data === '[DONE]') break;
      const chunk = record(parseJson(frame.data), 'UI stream chunk');
      if (chunk.type === 'start') { runId = uuid(chunk.messageId); break; }
    }
    if (!runId) throw new CliError('missing_run', 'Remote active stream supplied no run ID.');
    this.output.notice(`remote run=${runId}`);
    await this.follow(runId, signal);
  }

  async follow(runId: string, signal: AbortSignal, after?: number): Promise<void> {
    uuid(runId);
    const run = record(await this.json(`/api/v1/runs/${runId}`, signal), 'run');
    const chatId = uuid(run.chatId);
    let cursor = after ?? this.store.cursor(this.base, this.credential.userId, runId);
    let failures = 0;
    const stream = new SecretStream([this.credential.token]);
    for (;;) {
      aborted(signal);
      try {
        const response = await request(`${this.base}/api/v1/runs/${runId}/events?after_sequence=${cursor}`, {
          headers: { ...this.headers, accept: 'text/event-stream', 'last-event-id': String(cursor) },
        }, AbortSignal.any([signal, AbortSignal.timeout(320_000)]));
        let done = false;
        for await (const frame of sse(response)) {
          if (frame.data === '[DONE]') { done = true; break; }
          const event = record(parseJson(frame.data), 'run event');
          const sequence = integer(event.sequence, 'event sequence', 1, Number.MAX_SAFE_INTEGER);
          if (sequence <= cursor) continue;
          const eventType = text(event.eventType, 'event type', 100);
          let payload = event.payload ?? null;
          if (eventType === 'model.delta' && isRecord(event.payload) && isString(event.payload.text)) {
            const safeText = stream.push(event.payload.text);
            payload = { ...event.payload, text: safeText };
            this.output.text(safeText);
          } else if (eventType.startsWith('tool.') || eventType.includes('approval')) this.output.notice(`${eventType} (remote policy)`);
          this.output.event({ eventType, payload, sequence, runId, chatId });
          // Deliberate checkpoint AFTER rendering: a crash can replay one event
          // but cannot silently skip an unrendered event. --after 0 replays all.
          if (!stream.hasPending()) this.store.saveCursor(this.base, this.credential.userId, runId, chatId, sequence);
          cursor = sequence; failures = 0;
        }
        if (done) {
          const current = record(await this.json(`/api/v1/runs/${runId}`, signal), 'run');
          const status = text(current.status, 'run status', 100);
          if (terminal.has(status)) {
            const tail = stream.push('', true);
            this.output.text(tail + '\n');
            if (tail) this.output.event({ eventType: 'client.text_flush', payload: { text: tail }, runId, chatId });
            this.store.saveCursor(this.base, this.credential.userId, runId, chatId, cursor);
            if (status !== 'completed') throw new CliError(`run_${status}`, `Remote run ${runId} ${status}.`);
            return;
          }
        }
      } catch (error) {
        aborted(signal);
        if (error instanceof CliError && error.code !== 'connection_failed' && !/^http_5\d\d$/.test(error.code)) throw error;
        this.output.notice(`Remote event connection interrupted; resume cursor=${cursor}.`);
      }
      failures++;
      if (failures > 5) throw new CliError('stream_disconnected', `Remote run may continue. Resume with runs events ${runId}; no message was resubmitted.`);
      await delay(Math.min(200 * 2 ** failures, 5000), undefined, { signal });
    }
  }
}
