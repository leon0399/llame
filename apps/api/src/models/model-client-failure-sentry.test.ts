/**
 * The Responses wire forwards an SSE `error` event after output has started as
 * a structured object rather than an `Error` (`@ai-sdk/openai`):
 * `{ type: 'error', message }`, and `{ type: 'response.failed', response: {
 * error: { message } } }`. The run hands that value to Sentry, whose event
 * builder lifts a plain object's `message` into the exception and serializes
 * the object into `extra.__serialized__`, so the client boundary must redact
 * the structured graph itself. This proves it against a real partial stream
 * and the installed Sentry event builder.
 */
import * as Sentry from '@sentry/nestjs';
import type { ModelMessage } from 'ai';
import { isRecord } from '@workspace/runtime-safety';

import { createModelClient } from './model-client-factory';
import type { UnknownRecord } from '@workspace/runtime-safety';

import type { ChatIdentity, ModelClient } from './model-client';
import { createOpenAIModelClient } from './openai-model-client';

const CHAT: ChatIdentity = { id: 'chat-sentry', lane: 'main' };

const messages = [
  { role: 'user', content: 'Say hello.' },
] satisfies Array<ModelMessage>;

const KEY = 'CONFIGURED-KEY-CANARY-2f9d';
const MARKER = '[REDACTED]';
const USER_AGENT = 'llame/0.0.0-test';

function sse(...events: Array<string>): Response {
  return new Response(events.map((event) => `data: ${event}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function partialErrorStream(error: UnknownRecord): Response {
  return sse(
    JSON.stringify({
      type: 'response.output_text.delta',
      sequence_number: 0,
      item_id: 'msg-1',
      output_index: 0,
      content_index: 0,
      delta: 'partial answer',
    }),
    JSON.stringify(error),
  );
}

function clientFor(response: () => Response): ModelClient {
  return createModelClient(
    {
      provider: {
        id: 'responses',
        type: 'openai-responses',
        key: KEY,
        baseUrl: 'https://endpoint.example.test/v1',
        headers: {},
      },
      model: {
        id: 'system:test:test-model',
        source: 'system',
        provider: 'responses',
        providerModelId: 'test-model',
        contextWindowTokens: 128_000,
        input: ['text'],
        systemPromptTemplate: 'Test prompt',
        systemPromptSource: 'project_default',
        referencesSkills: false,
      },
      userAgent: USER_AGENT,
      credentials: [KEY],
    },
    {
      createOpenAIModelClient: (config) =>
        createOpenAIModelClient({
          ...config,
          fetch: () => Promise.resolve(response()),
        }),
    },
  );
}

/** The failure the run reports: what `onError` delivered after output started. */
async function reportedFailure(
  response: () => Response,
): Promise<UnknownRecord> {
  const reported: Array<UnknownRecord> = [];
  await clientFor(response)
    .streamText({
      chat: CHAT,
      messages,
      onError: ({ error }) => {
        if (!isRecord(error)) {
          throw new TypeError('expected the wire to forward a failure object');
        }

        reported.push(error);
      },
    })
    .text.then(
      () => undefined,
      () => undefined,
    );
  const [failure] = reported;

  if (failure === undefined) throw new Error('no failure was reported');

  return failure;
}

/** The event the installed Sentry builder produces for `failure`, serialized. */
async function sentryEvent(error: UnknownRecord): Promise<string> {
  const captured = new Promise<string>((resolve) => {
    Sentry.init({
      dsn: 'https://public@example.test/1',
      defaultIntegrations: false,
      // The nested `response.error` sits deeper than the default depth, so
      // the builder would elide it as `[Object]`; reach it to prove the
      // nested message is redacted in the serialized event too.
      normalizeDepth: 10,
      beforeSend: (event) => {
        resolve(JSON.stringify(event));

        return null;
      },
    });
  });

  Sentry.captureException(error, {
    tags: { 'llame.run_id': 'run-1', 'llame.chat_id': CHAT.id },
  });

  try {
    return await captured;
  } finally {
    await Sentry.close();
  }
}

describe('a structured Responses stream failure', () => {
  it('reaches Sentry with its credential redacted (error event)', async () => {
    const failure = await reportedFailure(() =>
      partialErrorStream({
        type: 'error',
        sequence_number: 1,
        code: `upstream-code-${KEY}`,
        message: `Upstream echoed ${KEY}`,
      }),
    );

    const event = await sentryEvent(failure);

    expect(event).toContain(MARKER);
    expect(event).not.toContain(KEY);
  });

  it('reaches Sentry with its credential redacted (response.failed event)', async () => {
    const failure = await reportedFailure(() =>
      partialErrorStream({
        type: 'response.failed',
        sequence_number: 2,
        response: {
          error: {
            code: `server-error-${KEY}`,
            message: `Upstream echoed ${KEY}`,
          },
          incomplete_details: { reason: 'error' },
        },
      }),
    );

    const event = await sentryEvent(failure);

    expect(event).toContain('response.failed');
    expect(event).toContain(MARKER);
    expect(event).not.toContain(KEY);
  });
});
