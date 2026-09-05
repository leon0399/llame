import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { isRecord, isString } from '@workspace/runtime-safety';
import { type Credential } from './auth';
import { request, readJson, sse } from '@workspace/personal-node/http';
import { RemoteCursors } from './remote-cursors';
import { Output } from './output';
import { SecretStream } from '@workspace/personal-node/output';
import { aborted, CliError } from '@workspace/personal-node/errors';
import { integer, parseJson, record, text, uuid } from '@workspace/personal-node/validation';

const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);

/** Thin client: the server remains the advancing executor and policy owner. */
export class Remote {
  private readonly base: string;
  private readonly headers: { authorization: string };
  constructor(private readonly credential: Credential, private readonly store: RemoteCursors, private readonly output: Output) {
    this.base = credential.authority; this.headers = { authorization: `Bearer ${credential.token}` };
    output.protect([credential.token]);
  }

  async json(path: string, signal: AbortSignal, method = 'GET', body?: unknown): Promise<unknown> {
    return readJson(await request(this.base + path, {
      method, headers: { ...this.headers, 'content-type': 'application/json' },
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
    // Capture the run ID from the existing AI SDK start chunk, then use the
    // authoritative cursor-based event endpoint. Cancelling this HTTP reader
    // detaches the bridge only; it does not cancel the durable worker.
    let runId: string | undefined;
    try {
      const response = await request(`${this.base}/api/v1/chats/${chatId}/messages`, {
        method: 'POST', headers: { ...this.headers, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body),
      }, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
      for await (const frame of sse(response)) {
        if (frame.data === '[DONE]') break;
        const chunk = record(parseJson(frame.data), 'UI stream chunk');
        if (chunk.type === 'start') { runId = uuid(chunk.messageId); break; }
        if (chunk.type === 'error') throw new CliError('remote_error', 'Remote stream returned an error.');
      }
      if (!runId) throw new CliError('missing_run', 'No run ID arrived.');
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
