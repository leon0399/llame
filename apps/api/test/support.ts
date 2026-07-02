/**
 * Shared e2e test helpers. The session-cookie format and the AI SDK SSE event
 * shape are protocol facts each spec used to restate — keep them in one place
 * so a change (cookie name, stream event schema) can't silently miss a copy.
 */

import type request from 'supertest';

/** Extracts the llame session cookie pair from a response, or '' when absent. */
export const cookieOf = (res: request.Response): string => {
  const set = (res.headers['set-cookie'] as unknown as string[]) ?? [];
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
export function parseSseEvents(body: string): unknown[] {
  return body
    .split('\n\n')
    .map((event) => event.trim())
    .filter((event) => event.startsWith('data: '))
    .map((event) => event.slice('data: '.length))
    .filter((data) => data !== '[DONE]')
    .map((data): unknown => JSON.parse(data) as unknown);
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
        typeof event === 'object' &&
        event !== null &&
        (event as { type?: unknown }).type === 'text-delta',
    )
    .map((event) => event.delta)
    .join('');
}
