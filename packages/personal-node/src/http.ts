import { CliError, aborted } from './errors';
import { parseJson } from './validation';

export interface SseFrame { readonly id?: string; readonly event?: string; readonly data: string; }

export async function request(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  aborted(signal);
  try {
    const response = await fetch(url, { ...init, signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CliError(`http_${response.status}`, `Request failed (HTTP ${response.status}). No request was retried.`);
    }
    return response;
  } catch (error) {
    aborted(signal);
    if (error instanceof CliError) throw error;
    throw new CliError('connection_failed', 'Connection failed, timed out, or redirected. No request was retried.');
  }
}

export async function readJson(response: Response, maxBytes = 4_194_304): Promise<unknown> {
  if (!response.body) throw new CliError('empty_response', 'Expected a JSON response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new CliError('response_limit', 'HTTP response exceeds the permitted size.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

/** Incremental SSE, including CRLF split across packets and multiline data. */
export async function* sse(response: Response): AsyncGenerator<SseFrame> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') || !response.body) {
    await response.body?.cancel();
    throw new CliError('not_sse', 'Expected a text/event-stream response.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parser = new SseParser();
  try {
    for (;;) {
      const next = await reader.read();
      for (const frame of parser.feed(decoder.decode(next.value, { stream: !next.done }), next.done)) yield frame;
      if (next.done) break;
    }
    // An incomplete frame at EOF is never committed as a complete event.
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

class SseParser {
  private buffer = '';
  private data: string[] = [];
  private id?: string;
  private event?: string;
  private size = 0;
  private first = true;

  *feed(chunk: string, final = false): Generator<SseFrame> {
    this.buffer += chunk;
    if (this.first && this.buffer.length) { this.buffer = this.buffer.replace(/^\uFEFF/, ''); this.first = false; }
    for (;;) {
      const index = this.buffer.search(/[\r\n]/);
      if (index === -1 || (!final && this.buffer[index] === '\r' && index === this.buffer.length - 1)) break;
      const line = this.buffer.slice(0, index);
      const width = this.buffer[index] === '\r' && this.buffer[index + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(index + width);
      const frame = this.line(line);
      if (frame) yield frame;
    }
    if (this.buffer.length + this.size > 1_048_576) throw new CliError('event_limit', 'SSE event exceeds 1 MiB.');
  }

  private line(line: string): SseFrame | undefined {
    this.size += line.length;
    if (this.size > 1_048_576) throw new CliError('event_limit', 'SSE event exceeds 1 MiB.');
    if (line === '') {
      const frame = this.data.length ? { id: this.id, event: this.event, data: this.data.join('\n') } : undefined;
      this.data = []; this.id = undefined; this.event = undefined; this.size = 0;
      return frame;
    }
    const index = line.indexOf(':');
    const field = index === -1 ? line : line.slice(0, index);
    const value = index === -1 ? '' : line.slice(index + 1).replace(/^ /, '');
    if (field === 'data') this.data.push(value);
    if (field === 'id' && !value.includes('\0')) this.id = value;
    if (field === 'event') this.event = value;
    return undefined;
  }
}
