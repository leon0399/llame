/**
 * The streaming half of a chat turn (chats/chat-stream-response.ts): the abort
 * signal a request's lifecycle supplies, and the write of an AI SDK web
 * response onto the Express response. Both are pure plumbing with behaviours a
 * broken turn depends on, so each branch is asserted directly.
 */

import { Logger } from '@nestjs/common';
import { Writable } from 'node:stream';
import type { Mock } from 'vitest';

import { asDouble } from '../testing/support';

import {
  requestAbortSignal,
  writeWebResponse,
  type ChatStreamResponse,
} from './chat-stream-response';

afterEach(() => {
  vi.restoreAllMocks();
});

/** An Express-like writable, and the doubles its callers observe. */
type FakeResponse = {
  readonly response: ChatStreamResponse;
  readonly chunks: Array<string>;
  readonly destroy: Mock;
  readonly end: Mock;
  readonly status: Mock;
  readonly setHeader: Mock;
};

/** An Express-like writable that records what was written and what happened. */
function fakeResponse(options: {
  destroyed?: boolean;
  headersSent?: boolean;
}): FakeResponse {
  const chunks: Array<string> = [];
  const status = vi.fn();
  const setHeader = vi.fn();
  const writable = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  // The spies record the call and still perform it: `pipeline` ends the
  // writable itself, so a stub would leave the test hanging.
  const destroy = vi.spyOn(writable, 'destroy');
  const end = vi.spyOn(writable, 'end');
  Object.assign(writable, {
    status: (code: number) => {
      status(code);
      return writable;
    },
    setHeader,
    headersSent: options.headersSent ?? false,
    destroyed: options.destroyed ?? false,
  });
  return {
    response: asDouble<ChatStreamResponse>(writable),
    chunks,
    destroy,
    end,
    status,
    setHeader,
  };
}

/** A body a web response can carry, including one that is not iterable. */
type FakeBody =
  | ReadableStream<Uint8Array>
  | null
  | { readonly notIterable: true };

/** A web response whose body is `body`, as `writeWebResponse` reads it. */
function webResponse(body: FakeBody, status = 200): Response {
  const response = new Response(null, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
  // The body is the value under test, which a real Response cannot wrap.
  Object.defineProperty(response, 'body', { value: body, configurable: true });
  return response;
}

describe('requestAbortSignal', () => {
  it('aborts only once the response closes, and the cleanup stops listening', () => {
    const { response } = fakeResponse({});
    const abort = requestAbortSignal(response);

    expect(abort.signal.aborted).toBe(false);
    response.emit('close');
    expect(abort.signal.aborted).toBe(true);

    const second = fakeResponse({});
    const secondAbort = requestAbortSignal(second.response);
    secondAbort.cleanup();
    second.response.emit('close');
    expect(secondAbort.signal.aborted).toBe(false);
  });

  it('aborts at once when the socket is already gone', () => {
    const abort = requestAbortSignal(
      fakeResponse({ destroyed: true }).response,
    );

    expect(abort.signal.aborted).toBe(true);
  });

  it('does not abort when the response ended before it closed', () => {
    const { response } = fakeResponse({});
    const abort = requestAbortSignal(response);

    Object.defineProperty(response, 'writableEnded', { value: true });
    response.emit('close');

    expect(abort.signal.aborted).toBe(false);
  });
});

describe('writeWebResponse', () => {
  it('copies the status and headers, then streams the body', async () => {
    const fake = fakeResponse({});
    const body = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('chunk');
        controller.close();
      },
    });

    await writeWebResponse(
      webResponse(body.pipeThrough(new TextEncoderStream()), 201),
      fake.response,
      new AbortController().signal,
    );

    expect(fake.status).toHaveBeenCalledWith(201);
    expect(fake.setHeader).toHaveBeenCalledWith(
      'content-type',
      'text/event-stream',
    );
    expect(fake.chunks.join('')).toBe('chunk');
  });

  it('ends a response whose body is absent', async () => {
    const fake = fakeResponse({});

    await writeWebResponse(
      webResponse(null),
      fake.response,
      new AbortController().signal,
    );

    expect(fake.end).toHaveBeenCalled();
  });

  it('refuses a body that is not async-iterable', async () => {
    const fake = fakeResponse({});

    await expect(
      writeWebResponse(
        webResponse({ notIterable: true }),
        fake.response,
        new AbortController().signal,
      ),
    ).rejects.toThrow('Expected the response body to be async-iterable');
  });

  it('logs and destroys a connection whose stream fails after the headers', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const fake = fakeResponse({ headersSent: true });
    const body = new ReadableStream<string>({
      start(controller) {
        controller.error(new Error('provider dropped the connection'));
      },
    });

    await writeWebResponse(
      webResponse(body.pipeThrough(new TextEncoderStream())),
      fake.response,
      new AbortController().signal,
    );

    expect(fake.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'provider dropped the connection' }),
    );
    expect(error).toHaveBeenCalledWith(
      'Stream pipeline failed after headers were sent',
      expect.any(String),
    );
  });

  it('swallows a failure the caller already aborted', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const controller = new AbortController();
    const fake = fakeResponse({ headersSent: true });
    const body = new ReadableStream<string>({
      start(streamController) {
        streamController.error(new Error('connection reset'));
      },
    });
    controller.abort();

    await writeWebResponse(
      webResponse(body.pipeThrough(new TextEncoderStream())),
      fake.response,
      controller.signal,
    );

    // The client is gone, so the failure is not worth a log line of its own.
    expect(error).not.toHaveBeenCalled();
  });

  it('rethrows a failure before the headers were sent', async () => {
    const fake = fakeResponse({ headersSent: false });
    const body = new ReadableStream<string>({
      start(controller) {
        controller.error(new Error('body never started'));
      },
    });

    await expect(
      writeWebResponse(
        webResponse(body.pipeThrough(new TextEncoderStream())),
        fake.response,
        new AbortController().signal,
      ),
    ).rejects.toThrow('body never started');
  });
});
