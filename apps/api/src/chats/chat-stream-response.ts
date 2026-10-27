/**
 * The streaming half of a chat turn: the abort signal a request's lifecycle
 * supplies, and the write of an AI SDK web response onto the Express response.
 * Shared by a chat send and a follow-up request so both answer identically.
 */

import { Logger } from '@nestjs/common';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response as ExpressResponse } from 'express';

const streamLogger = new Logger('ChatStream');

export type ChatStreamResponse = Writable &
  Pick<ExpressResponse, 'status' | 'setHeader' | 'headersSent'>;

/**
 * DOM's `ReadableStream` type doesn't declare `[Symbol.asyncIterator]` even
 * though the runtime object supports it, and its BYOB-reader overload isn't
 * assignable to `node:stream/web`'s declaration of the same class —
 * `Readable.fromWeb` can't accept it without a cast. Checking async
 * iterability at runtime instead sidesteps both type declarations and lets
 * `Readable.from` (which only needs the iteration protocol) consume it.
 */
function isAsyncIterable(
  value: ReadableStream<Uint8Array>,
): value is ReadableStream<Uint8Array> & AsyncIterable<Uint8Array> {
  return Symbol.asyncIterator in value;
}

/**
 * Creates an abort signal tied to the request and response lifecycle.
 *
 * @returns The abort signal and a cleanup function that removes the registered listeners.
 */
export function requestAbortSignal(response: ChatStreamResponse) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const abortOnResponseClose = () => {
    if (!response.writableEnded) {
      abort();
    }
  };

  // `response` 'close' fires on client disconnect (before or during streaming) — this is
  // the reliable abort signal on Node 20+. (The old request 'aborted' event is deprecated
  // and does not fire reliably, so it is not used.) If the socket is already
  // gone by registration time, abort immediately — 'close' has already fired.
  // response.destroyed = the socket is really gone. (request.destroyed is NOT
  // usable here: a POST whose body stream has been fully consumed can read as
  // destroyed while the connection is perfectly alive.)
  if (response.destroyed) {
    abort();
  }
  response.on('close', abortOnResponseClose);

  return {
    signal: controller.signal,
    cleanup: () => {
      response.off('close', abortOnResponseClose);
    },
  };
}

/**
 * Writes a web response to an Express response.
 *
 * @param streamResponse - The response to send, including status, headers, and optional body
 * @param response - The Express response to write to
 * @param abortSignal - The abort signal used to suppress errors after cancellation
 */
export async function writeWebResponse(
  streamResponse: Response,
  response: ChatStreamResponse,
  abortSignal: AbortSignal,
): Promise<void> {
  response.status(streamResponse.status || 200);
  streamResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  if (!streamResponse.body) {
    response.end();
    return;
  }

  try {
    const body = streamResponse.body;
    if (!isAsyncIterable(body)) {
      throw new Error('Expected the response body to be async-iterable');
    }
    await pipeline(Readable.from(body), response);
  } catch (error) {
    if (abortSignal.aborted) {
      return;
    }
    // A mid-stream failure after the status+headers were flushed cannot be turned into
    // an HTTP error response — re-throwing would trigger ERR_HTTP_HEADERS_SENT. Log and
    // destroy the connection instead. (Pre-headers failures still throw → exception filter.)
    if (response.headersSent) {
      streamLogger.error(
        'Stream pipeline failed after headers were sent',
        error instanceof Error ? error.stack : String(error),
      );
      response.destroy(
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }
    throw error;
  }
}
