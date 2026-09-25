/**
 * Shared e2e test helpers. The session-cookie format and the AI SDK SSE event
 * shape are protocol facts each spec used to restate — keep them in one place
 * so a change (cookie name, stream event schema) can't silently miss a copy.
 * The fake streaming model client lives in `./fake-streaming-model-client`
 * (re-exported below) so each file stays under the size trip-wire.
 */

import { expect } from 'vitest';
import { z } from 'zod';
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server,
} from 'node:http';

import { isContextItemPart } from '../chats/context-item';
import { isTemporalPayload } from '../chats/context-item-producers';
import type request from 'supertest';
import type { ModelMessage } from 'ai';

import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

export {
  FakeStreamingModelClient,
  FakeModelsService,
  type FakeTurn,
} from './fake-streaming-model-client';

/**
 * Asserts a register (or any auth) response body carries `user.id` as a
 * string — the one shape assertion nearly every integration suite otherwise
 * re-derives inline right after registering a fixture user. Centralizing it
 * also gives the underlying `isRecord`/`typeof` narrowing a real type-guard
 * home (`allowInTypeGuards`), instead of a bare inline check.
 */
export function expectRegisteredUserId(
  body: unknown,
): asserts body is { user: { id: string } } {
  if (
    !isRecord(body) ||
    !isRecord(body.user) ||
    typeof body.user.id !== 'string'
  ) {
    throw new Error('Expected register response with user.id');
  }
}

/** Extracts the llame session cookie pair from a response, or '' when absent. */
export const cookieOf = (res: request.Response): string => {
  const set = res.get('Set-Cookie') ?? [];
  for (const c of set) {
    const m = /llame_session=([^;]+)/.exec(c);
    if (m) return `llame_session=${m[1]}`;
  }
  return '';
};

/**
 * Parses SSE data events into JSON values.
 *
 * @param body - The SSE payload to parse
 * @returns The parsed JSON values from each `data: ` event, excluding `[DONE]`
 */
export function parseSseEvents(body: string): Array<unknown> {
  // SAFETY: JSON.parse returns any; the final .map's assertion to unknown
  // forces callers to narrow before use rather than silently inheriting any.
  return (
    body
      .split('\n\n')
      // Per-line search within each frame: proper SSE frames can carry
      // `event:`/`id:` lines before `data:` (the run-event replay does),
      // not just the bare data-only frames the AI SDK stream emits.
      .map((event) =>
        event
          .trim()
          .split('\n')
          .find((line) => line.startsWith('data: ')),
      )
      .filter((line): line is string => line !== undefined)
      .map((line) => line.slice('data: '.length))
      .filter((data) => data !== '[DONE]')
      .map((data) => JSON.parse(data) as unknown)
  );
}

/**
 * Extracts streamed text content from an SSE payload.
 *
 * @returns The concatenated `delta` values from `text-delta` events.
 */
export function streamedText(body: string): string {
  return parseSseEvents(body)
    .filter(
      (event): event is { type: 'text-delta'; delta: string } =>
        isRecord(event) && event.type === 'text-delta',
    )
    .map((event) => event.delta)
    .join('');
}

/**
 * Poll until `poll` returns a defined value or the timeout elapses. The shared
 * copy — integration/e2e suites poll for async outcomes (consumed jobs,
 * compaction rows) instead of sleeping fixed amounts.
 */
export async function waitFor<T>(
  poll: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await poll();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The UI message stream fields an incremental reader's callers assert on. */
const uiStreamFrame = z.object({
  type: z.string(),
  messageId: z.string().optional(),
});

export type UiStreamFrame = z.infer<typeof uiStreamFrame>;

/**
 * A live SSE response read one frame at a time. supertest resolves only on the
 * complete body, so it cannot observe a stream whose first frame arrives while
 * the Run feeding it is still queued — exactly what the acceptance `start`
 * frame claims.
 */
export type IncrementalSseResponse = {
  status: number;
  /**
   * The next frame this reader has not returned yet.
   *
   * @param what - What is being waited for, named in the failure message
   * @param timeoutMs - How long to wait before failing
   * @returns The frame, parsed at this boundary
   * @throws Error when the body ends first or the timeout elapses
   */
  nextFrame(what: string, timeoutMs?: number): Promise<UiStreamFrame>;
  /** Abort the request. The Run keeps executing; only the bridge stops. */
  close(): void;
};

/**
 * Appends each complete frame of a live SSE body to `frames`.
 *
 * @param res - The response whose body is being read
 * @param frames - The list each parsed frame is appended to
 * @returns Whether the body has ended
 */
function collectSseFrames(
  res: IncomingMessage,
  frames: Array<unknown>,
): () => boolean {
  let trailing = '';
  let ended = false;
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => {
    trailing += chunk;
    const complete = trailing.split('\n\n');
    trailing = complete.pop() ?? '';
    for (const frame of complete) {
      frames.push(...parseSseEvents(`${frame}\n\n`));
    }
  });
  const markEnded = () => {
    ended = true;
  };
  res.on('end', markEnded);
  res.on('close', markEnded);
  res.on('error', markEnded);
  return () => ended;
}

/** Frame reader over a live SSE body; `parseSseEvents` owns the frame format. */
function readSseFrames(
  req: ClientRequest,
  res: IncomingMessage,
): IncrementalSseResponse {
  const frames: Array<unknown> = [];
  const hasEnded = collectSseFrames(res, frames);
  let returned = 0;
  return {
    status: res.statusCode ?? 0,
    nextFrame: (what, timeoutMs = 15_000) =>
      waitFor(
        () => {
          if (returned < frames.length) {
            return uiStreamFrame.parse(frames[returned++]);
          }
          if (hasEnded()) {
            throw new Error(`SSE stream ended before ${what}`);
          }
          return undefined;
        },
        timeoutMs,
        what,
      ),
    close: () => req.destroy(),
  };
}

/**
 * Open an SSE request against a listening server and read its body
 * incrementally. The server must already listen on a port (`app.listen(0)`),
 * because supertest's per-request listen would not outlive this stream.
 *
 * @param options - Server, request line, session cookie, and JSON body
 * @returns The response as soon as its headers arrive
 */
export function openSseStream(options: {
  server: Server;
  method: 'GET' | 'POST';
  path: string;
  cookie: string;
  body?: UnknownRecord;
}): Promise<IncrementalSseResponse> {
  const address = options.server.address();
  if (address === null || isString(address)) {
    throw new Error('openSseStream needs a TCP-listening server');
  }
  const payload =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      method: options.method,
      path: options.path,
      headers: {
        cookie: options.cookie,
        accept: 'text/event-stream',
        ...(payload !== undefined && {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        }),
      },
    });
    req.on('error', reject);
    req.on('response', (res) => resolve(readSseFrames(req, res)));
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Every user message now carries a `temporal` row stating when its turn was
 * received. Specs that assert an exact `parts` array care about the OTHER
 * parts, and cannot pin this one: its instant is the moment the turn was
 * accepted and its zone is whatever the host resolves.
 *
 * Strip it here and assert it with `expectTemporalRow` where it is the point,
 * rather than restating a matcher for it in every spec.
 */
export function withoutTemporalRow<T>(parts: ReadonlyArray<T>): Array<T> {
  return parts.filter(
    (part) => !(isContextItemPart(part) && part.data.producer === 'temporal'),
  );
}

/** Assert the turn carries exactly one well-formed temporal row. */
export function expectTemporalRow(
  parts: ReadonlyArray<unknown>,
  runId?: string,
): void {
  const rows = parts
    .filter(isContextItemPart)
    .filter((part) => part.data.producer === 'temporal');
  expect(rows).toHaveLength(1);
  expect(isTemporalPayload(rows[0].data.payload)).toBe(true);
  expect(rows[0].data.form).toBe('snapshot');
  expect(rows[0].data.text).toMatch(
    /^<system-reminder producer="temporal" form="snapshot">[\s\S]+<\/system-reminder>$/u,
  );
  if (runId !== undefined) expect(rows[0].data.runId).toBe(runId);
}

function parseMessagePartAssertions(
  parts: ReadonlyArray<unknown>,
): Array<UnknownRecord> {
  return parts.map((part) => {
    if (!isRecord(part)) {
      throw new TypeError('Expected a message part object');
    }
    return part;
  });
}

function withoutContextText(part: UnknownRecord): UnknownRecord {
  if (!isContextItemPart(part) || part.data.text === undefined) return part;
  const { text: _text, ...data } = part.data;
  return { ...part, data };
}

/**
 * Assert a turn's parts: the temporal row, plus everything else exactly.
 *
 * The two halves are one call because they are one claim — a spec that
 * stripped the row without also asserting it would quietly stop checking that
 * turns are stamped at all.
 */
export function expectMessageParts(
  parts: ReadonlyArray<unknown>,
  expected: ReadonlyArray<unknown>,
  runId?: string,
): void {
  const actualParts = parseMessagePartAssertions(withoutTemporalRow(parts));
  const expectedParts = parseMessagePartAssertions(expected);
  expect(actualParts.map(withoutContextText)).toEqual(expectedParts);
  expectTemporalRow(parts, runId);
}

/** Text of each content block, so a message's blocks can be asserted apart. */
export function contentBlockTexts(
  content: ModelMessage['content'],
): Array<string> {
  if (isString(content)) return [content];
  return content.map((block) =>
    isRecord(block) && isString(block['text']) ? block['text'] : '',
  );
}

/** One message's content flattened, blocks joined as the model reads them. */
export function contentText(content: ModelMessage['content']): string {
  return contentBlockTexts(content).join('\n\n');
}
