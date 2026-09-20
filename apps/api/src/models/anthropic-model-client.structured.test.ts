/**
 * `createAnthropicModelClient` — structured generation, reasoning delivery, and
 * the failure boundaries (anthropic-provider 3.4, 3.8, 3.10). Every fixture is
 * the exact body the pinned `@ai-sdk/anthropic` adapter POSTed (see
 * `anthropic-model-client.fixtures.ts`).
 */
import { jsonSchema, NoOutputGeneratedError } from 'ai';
import { InvalidArgumentError } from '@ai-sdk/provider';

import {
  buildClient,
  buildHarness,
  canaryMessages,
  captureErrors,
  captureReasoning,
  captureText,
  firstRequest,
  messageEnvelope,
  MESSAGES_CANARIES,
  messages,
  textBlock,
  thinkingBlock,
  toolNames,
  truncatedEchoStream,
  unreachableEndpointFailure,
  type RecordedRequest,
} from './anthropic-model-client.fixtures';
import type { AnthropicModelClientConfig } from './anthropic-model-client';
import type { ModelObjectInput } from './model-client';
import type { ClientHarness } from './anthropic-model-client.fixtures';

const titleSchema = jsonSchema<{ title: string }>({
  type: 'object',
  properties: { title: { type: 'string' } },
});

const titleInput: ModelObjectInput<{ title: string }> = {
  messages,
  schemaName: 'chat_title',
  schemaDescription: 'A chat title',
  schema: titleSchema,
};

/** The Messages response content shapes this suite scripts. */
type ResponseContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: { title: string };
    };

function jsonMessage(content: Array<ResponseContentBlock>): Response {
  return new Response(
    JSON.stringify({
      id: 'msg-2',
      type: 'message',
      role: 'assistant',
      model: 'model',
      content,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** The adapter's own JSON-tool answer, used when the request carries that tool. */
function structuredRespond(request: RecordedRequest): Response {
  if (toolNames(request.body).includes('json')) {
    return jsonMessage([
      {
        type: 'tool_use',
        id: 'call-0',
        name: 'json',
        input: { title: 'Fallback title' },
      },
    ]);
  }
  return jsonMessage([{ type: 'text', text: '{"title":"Hi"}' }]);
}

async function generateTitle(
  overrides: Partial<AnthropicModelClientConfig> = {},
): Promise<{ harness: ClientHarness; object: { title: string } }> {
  const harness = buildHarness({ respond: structuredRespond });
  const client = buildClient(harness, overrides);
  if (!client.generateObject) {
    throw new Error('the Messages client must expose generateObject');
  }
  return { harness, object: await client.generateObject(titleInput) };
}

describe('createAnthropicModelClient — structured output (3.8)', () => {
  it('requests the native output format with no tool choice on a supported model', async () => {
    const { harness, object } = await generateTitle();

    expect(object).toEqual({ title: 'Hi' });
    const { body } = firstRequest(harness);
    expect(body['output_config']).toMatchObject({
      format: {
        type: 'json_schema',
        schema: { type: 'object' },
      },
    });
    expect(body).not.toHaveProperty('tool_choice');
    expect(toolNames(body)).toEqual([]);
  });

  it('requests the native output format on an unrecognized claude- id', async () => {
    const { harness, object } = await generateTitle({
      providerModelId: 'claude-mythos-9',
      modelId: 'system:anthropic:claude-mythos-9',
    });

    expect(object).toEqual({ title: 'Hi' });
    const { body } = firstRequest(harness);
    expect(body['model']).toBe('claude-mythos-9');
    expect(body['output_config']).toMatchObject({
      format: {
        type: 'json_schema',
        schema: { type: 'object' },
      },
    });
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('takes the adapter JSON-tool path on a non-claude- id, with the choice the adapter placed', async () => {
    const { harness, object } = await generateTitle({
      providerModelId: 'glm-5',
      modelId: 'system:gateway:glm-5',
    });

    expect(object).toEqual({ title: 'Fallback title' });
    const { body } = firstRequest(harness);
    expect(body['output_config']).toBeUndefined();
    // llame authors no tool choice: the required choice below is the adapter's
    // own JSON-tool mechanism, next to its `json` tool.
    expect(toolNames(body)).toEqual(['json']);
    expect(body['tool_choice']).toEqual({
      type: 'any',
      disable_parallel_tool_use: true,
    });
  });

  it('carries the same client defaults and operator options as streaming, on every request kind', async () => {
    const { harness } = await generateTitle({
      providerOptions: { user_option: 'kept' },
    });

    const { body } = firstRequest(harness);
    expect(body['cache_control']).toEqual({ type: 'ephemeral' });
    // The reasoning declaration is the switch for the thinking default on
    // every request this client sends (D11); `ModelObjectInput` carries no
    // effort, so none is sent.
    expect(body['thinking']).toEqual({
      type: 'adaptive',
      display: 'summarized',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    });
    expect(body['output_config']).toMatchObject({
      format: {
        type: 'json_schema',
        schema: { type: 'object' },
      },
    });
    expect(firstRequest(harness).headers.get('anthropic-beta')).toBe(
      'thinking-binding-controls-2026-08-01',
    );
  });

  it('sends no thinking configuration on an entry without a reasoning declaration', async () => {
    const { harness } = await generateTitle({ reasoningDeclared: false });

    expect(firstRequest(harness).body).not.toHaveProperty('thinking');
  });

  it('fails a rejected structured request explicitly so the caller fallback runs', async () => {
    const harness = buildHarness({
      respond: () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'nope' },
          }),
          { status: 400 },
        ),
    });
    const client = buildClient(harness);
    if (!client.generateObject) {
      throw new Error('the Messages client must expose generateObject');
    }

    await expect(client.generateObject(titleInput)).rejects.toThrow(
      'Anthropic request rejected: invalid model or request option.',
    );
    // No automatic retry (maxRetries 0): the rejected request was attempted
    // once, on the configured endpoint, and no model or provider was
    // substituted.
    expect(harness.requests).toHaveLength(1);
    expect(firstRequest(harness).url).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });
});

describe('createAnthropicModelClient — reasoning delivery (3.4)', () => {
  it('delivers reasoning text, scoped part ids, and metadata from one fullStream consumer', async () => {
    const harness = buildHarness({
      streamEvents: messageEnvelope([
        ...thinkingBlock(0, 'deep thought', 'SIG123'),
        ...textBlock(1, 'answer'),
      ]),
    });
    const client = buildClient(harness);
    const { texts, onTextDelta } = captureText();
    const { deliveries, onReasoningDelta } = captureReasoning();

    await expect(
      client.streamText({ messages, onTextDelta, onReasoningDelta }).text,
    ).resolves.toBe('answer');

    // Exact delivery lists: text travels only on onChunk and reasoning only
    // through the shared helper, so a chunk routed to both would duplicate
    // here. The helper scopes the adapter's per-response block index to the
    // provider invocation, so the first step's block is `0:0`.
    expect(texts).toEqual(['answer']);
    expect(deliveries).toEqual([
      ['deep thought', '0:0', undefined],
      ['', '0:0', { anthropic: { signature: 'SIG123' } }],
    ]);
  });

  it('forwards a redacted block payload untouched', async () => {
    const harness = buildHarness({
      streamEvents: messageEnvelope([
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"redacted_thinking","data":"REDACTED"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        ...textBlock(1, 'answer'),
      ]),
    });
    const client = buildClient(harness);
    const { deliveries, onReasoningDelta } = captureReasoning();

    await expect(
      client.streamText({ messages, onReasoningDelta }).text,
    ).resolves.toBe('answer');

    expect(deliveries).toEqual([
      ['', '0:0', { anthropic: { redactedData: 'REDACTED' } }],
    ]);
  });

  it('completes normally when the response carries no thinking output', async () => {
    const harness = buildHarness({
      streamEvents: messageEnvelope(textBlock(0, 'answer')),
    });
    const client = buildClient(harness);
    const { deliveries, onReasoningDelta } = captureReasoning();

    await expect(
      client.streamText({ messages, onReasoningDelta }).text,
    ).resolves.toBe('answer');

    expect(deliveries).toEqual([]);
  });
});

describe('createAnthropicModelClient — failure boundaries (3.10)', () => {
  const secret = 'sk-auth-canary';

  function failedHarness(status: number, message: string) {
    return buildHarness({
      respond: () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'authentication_error', message },
          }),
          { status },
        ),
    });
  }

  /**
   * Everything the run's own error channel received, as one readable string:
   * the diagnostic surface the assertions below have to keep clean (the run
   * persists the message and logs the stack).
   */
  function delivered(errors: Array<unknown>): string {
    return errors
      .map((error) =>
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
      )
      .join('\n');
  }

  it('fails an authentication rejection once, sanitized, with no credential in the diagnostics', async () => {
    const harness = failedHarness(401, `invalid x-api-key: Bearer ${secret}`);
    const client = buildClient(harness, { credential: secret });
    const { errors, onError } = captureErrors();

    await expect(client.streamText({ messages, onError }).text).rejects.toThrow(
      NoOutputGeneratedError,
    );
    expect(errors).toEqual([
      new Error(
        'Anthropic authentication failed: the configured credential was rejected.',
      ),
    ]);
    expect(delivered(errors)).not.toContain(secret);
    // No automatic retry (maxRetries 0) and no credential substitution: one
    // request, on the configured endpoint, with the configured credential.
    expect(harness.requests).toHaveLength(1);
    expect(firstRequest(harness).headers.get('x-api-key')).toBe(secret);
  });

  it('fails an unknown model with a bounded diagnostic', async () => {
    const harness = failedHarness(404, 'model claude-ghost-9 not found');
    const client = buildClient(harness);
    const { errors, onError } = captureErrors();

    await expect(client.streamText({ messages, onError }).text).rejects.toThrow(
      NoOutputGeneratedError,
    );
    expect(errors).toEqual([
      new Error('Anthropic request failed: unknown model or endpoint.'),
    ]);
  });

  it('reports a rate limit once, with no fallback destination', async () => {
    const harness = failedHarness(429, `slow down: ${secret}`);
    const client = buildClient(harness, { credential: secret });
    const { errors, onError } = captureErrors();

    await expect(client.streamText({ messages, onError }).text).rejects.toThrow(
      NoOutputGeneratedError,
    );
    expect(errors).toEqual([
      new Error('Anthropic rate limit reached. Retry manually later.'),
    ]);
    // maxRetries 0: the rate limit is not re-attempted, no other provider or
    // type is contacted, and the upstream body never reaches diagnostics.
    expect(harness.requests).toHaveLength(1);
    expect(firstRequest(harness).url).toBe(
      'https://api.anthropic.com/v1/messages',
    );
    expect(delivered(errors)).not.toContain(secret);
  });

  it('bounds an HTTP status it does not recognize to the generic diagnostic', async () => {
    const harness = failedHarness(503, `upstream exploded: ${secret}`);
    const client = buildClient(harness);
    const { errors, onError } = captureErrors();

    await expect(client.streamText({ messages, onError }).text).rejects.toThrow(
      NoOutputGeneratedError,
    );
    expect(errors).toEqual([new Error('Anthropic request failed.')]);
    expect(delivered(errors)).not.toContain(secret);
  });

  it('bounds an unreachable endpoint without naming the host it dialed', async () => {
    const harness = buildHarness({
      failWith: () => unreachableEndpointFailure(MESSAGES_CANARIES.endpoint),
    });
    const client = buildClient(harness, {
      baseUrl: `https://${MESSAGES_CANARIES.endpoint}`,
      credential: MESSAGES_CANARIES.credential,
    });
    const { errors, onError } = captureErrors();

    await expect(client.streamText({ messages, onError }).text).rejects.toThrow(
      NoOutputGeneratedError,
    );
    // The transport failure is reported as the class of failure alone: the
    // SDK's own message ("Cannot connect to API: getaddrinfo ENOTFOUND …")
    // names the host and its cause carries the endpoint's address, so neither
    // reaches the run.
    expect(errors).toEqual([
      new Error('Anthropic request failed: the endpoint could not be reached.'),
    ]);
    expect(delivered(errors)).not.toContain(MESSAGES_CANARIES.endpoint);
    expect(delivered(errors)).not.toContain('ENOTFOUND');
    // The SDK's status-less transport error also carries the values of the
    // request llame sent; the delivered diagnostic must not hold them.
    expect(JSON.stringify(errors)).not.toContain(MESSAGES_CANARIES.credential);
    // The one request still went to the configured endpoint, unchanged.
    expect(harness.requests).toHaveLength(1);
    expect(firstRequest(harness).url).toBe(
      `https://${MESSAGES_CANARIES.endpoint}/messages`,
    );
  });

  it('bounds a late malformed event that reflects the request back', async () => {
    const harness = buildHarness({ streamEvents: truncatedEchoStream() });
    const client = buildClient(harness, {
      credential: MESSAGES_CANARIES.credential,
    });
    const { errors, onError } = captureErrors();
    const { texts, onTextDelta } = captureText();

    await expect(
      client.streamText({ messages: canaryMessages, onError, onTextDelta })
        .text,
    ).resolves.toBe('Partial answer.');

    // The failure is late: the stream's valid prefix reached the run first and
    // is kept; the malformed event is what the adapter failed to parse.
    expect(texts).toEqual(['Partial answer.']);
    expect(errors).toEqual([new Error('Anthropic request failed.')]);
    // Neither the parse error's raw text (which spells the event data out, the
    // canaries included) nor the canaries themselves reach the run's channel.
    const diagnostics = delivered(errors);
    expect(diagnostics).not.toContain('JSON parsing failed');
    expect(diagnostics).not.toContain(MESSAGES_CANARIES.prompt);
    expect(diagnostics).not.toContain(MESSAGES_CANARIES.credential);
    expect(JSON.stringify(errors)).not.toContain(MESSAGES_CANARIES.credential);
    // The request really did carry them: the assertion above is about the
    // failure channel, not about a request that never sent the canaries.
    expect(firstRequest(harness).headers.get('x-api-key')).toBe(
      MESSAGES_CANARIES.credential,
    );
    expect(JSON.stringify(firstRequest(harness).body)).toContain(
      MESSAGES_CANARIES.prompt,
    );
  });

  it('bounds a status-less failure it cannot classify', async () => {
    const harness = buildHarness({
      failWith: () => new Error(`socket hang up: ${MESSAGES_CANARIES.prompt}`),
    });
    const client = buildClient(harness);
    const { errors, onError } = captureErrors();

    await expect(client.streamText({ messages, onError }).text).rejects.toThrow(
      NoOutputGeneratedError,
    );
    expect(errors).toEqual([new Error('Anthropic request failed.')]);
    expect(delivered(errors)).not.toContain(MESSAGES_CANARIES.prompt);
  });

  it('keeps an aborted request abort-shaped instead of masking it', async () => {
    const harness = buildHarness({});
    const client = buildClient(harness);
    const controller = new AbortController();
    controller.abort(new DOMException('Aborted', 'AbortError'));

    const rejection = await client
      .streamText({ messages, abortSignal: controller.signal })
      .text.then(
        () => undefined,
        (error: unknown) => error,
      );

    // The stream result rejects with the signal's own reason (a DOMException
    // llame authored), so a caller that classifies a rejection as an abort
    // still can — the sanitizer bounds upstream text, not the abort contract.
    expect(rejection).toBeInstanceOf(DOMException);
    if (rejection instanceof Error) {
      expect(rejection.name).toBe('AbortError');
    } else {
      throw new Error('expected the aborted stream to reject with an Error');
    }
  });

  it('fails a recognized-but-invalid option value at the adapter, before any call', async () => {
    const harness = buildHarness({
      streamEvents: messageEnvelope(textBlock(0, 'hello')),
    });
    const client = buildClient(harness);
    const { errors, onError } = captureErrors();

    await expect(
      client.streamText({ messages, effort: 'ultra', onError }).text,
    ).rejects.toThrow(NoOutputGeneratedError);
    // The adapter's own rejection is llame-authored, bounded, and actionable,
    // so it is what the run keeps: the refusal names the option argument.
    const optionError = errors[0];
    expect(InvalidArgumentError.isInstance(optionError)).toBe(true);
    if (!InvalidArgumentError.isInstance(optionError)) {
      throw new Error('expected an InvalidArgumentError');
    }
    expect(optionError.argument).toBe('providerOptions');
    expect(optionError.message).toContain('invalid anthropic provider options');
    expect(harness.requests).toEqual([]);
  });
});
