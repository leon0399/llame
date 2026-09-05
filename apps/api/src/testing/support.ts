/**
 * Shared e2e test helpers. The session-cookie format and the AI SDK SSE event
 * shape are protocol facts each spec used to restate — keep them in one place
 * so a change (cookie name, stream event schema) can't silently miss a copy.
 * The fake streaming model client lives in `./fake-streaming-model-client`
 * (re-exported below) so each file stays under the size trip-wire.
 */

import { expect } from 'vitest';

import { isContextItemPart } from '../chats/context-item';
import { isTemporalPayload } from '../chats/context-item-producers';
import type request from 'supertest';
import type { ModelMessage } from 'ai';

import { isRecord, isString, type UnknownRecord } from '@workspace/runtime-safety';

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
