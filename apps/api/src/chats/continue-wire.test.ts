/**
 * The Continue request on each real adapter (turn-actions D6): the clients and
 * provider adapters serialize the request, and only the transport is stubbed,
 * so each assertion reads the body a provider would receive. A kept step is one
 * assistant turn — its reasoning with the metadata that authorizes it, its
 * text, and both parallel calls — followed by one turn with their results.
 */
import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';
import type { ModelMessage } from 'ai';

import {
  ANTHROPIC_DEFAULT_BASE_URL,
  createAnthropicModelClient,
} from '../models/anthropic-model-client';
import type { ModelInput } from '../models/model-catalog';
import type { ModelClient } from '../models/model-client';
import { createOpenAICodexModelClient } from '../models/openai-codex-model-client';
import { createOpenAIModelClient } from '../models/openai-model-client';
import type { ProviderMetadata } from 'ai';
import type { MessagePart } from './context-builder';
import { projectContinueParts } from './continue-projection';

const CHAT = { id: 'chat-test', lane: 'main' } as const;
const USER_AGENT = 'llame/0.0.0-test';
const FIRST_TEXT = 'The first file says hello.';
const SECOND_TEXT = 'The second file says goodbye.';
const KEPT_REASONING = 'I should read both files before answering.';

const base = {
  credential: 'sk-test',
  providerModelId: 'model-test',
  modelId: 'system:test:model-test',
  contextWindowTokens: 128_000,
  userAgent: USER_AGENT,
  requestHeaders: {},
};

const sse = (events: ReadonlyArray<string>) =>
  new Response(events.map((event) => `data: ${event}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const RESPONSES_STREAM = () =>
  sse([
    '{"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"item-1"}}',
    '{"type":"response.output_text.delta","item_id":"item-1","delta":"done"}',
    '{"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
    '[DONE]',
  ]);

const MESSAGES_STREAM = () =>
  sse([
    '{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
    '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}',
    '{"type":"content_block_stop","index":0}',
    '{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
    '{"type":"message_stop"}',
  ]);

/** One kept settled `read` call, as the source reply stored it. */
function readPart(toolCallId: string, text: string): MessagePart {
  return {
    type: 'tool-read',
    toolCallId,
    state: 'output-available',
    input: { path: `/work/${toolCallId}.txt` },
    output: { status: 'success', path: `/work/${toolCallId}.txt`, text },
    outcome: 'success',
  };
}

/**
 * The request a Continue Run sends on one wire: the history through the
 * trigger, then the kept step — reasoning with that wire's authorization
 * metadata, text, both parallel calls, and both results.
 */
function continueRequest(metadata: ProviderMetadata): Array<ModelMessage> {
  return [
    { role: 'user', content: 'Compare both files.' },
    ...projectContinueParts({
      parts: [
        { type: 'reasoning', text: KEPT_REASONING, providerMetadata: metadata },
        { type: 'text', text: 'Reading both files.' },
        readPart('call-1', FIRST_TEXT),
        readPart('call-2', SECOND_TEXT),
      ],
      stepNumbers: new Map([
        ['call-1', 0],
        ['call-2', 0],
      ]),
      results: new Map(),
    }),
  ];
}

/**
 * Streams `messages` with `input` through a client built after the transport
 * stub is in place (the fixed transports capture `globalThis.fetch` at
 * construction) and returns the sent body.
 */
async function sentBody(
  build: (input: ReadonlyArray<ModelInput>) => ModelClient,
  response: () => Response,
  messages: Array<ModelMessage>,
): Promise<UnknownRecord> {
  const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(response()),
  );
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    await expect(
      build(['text']).streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('done');
    const [request, init] = fetchMock.mock.calls[0] ?? [];
    if (request === undefined) throw new Error('no request was sent');
    const body: unknown = JSON.parse(await new Request(request, init).text());
    if (!isRecord(body)) throw new TypeError('expected a JSON request body');
    return body;
  } finally {
    globalThis.fetch = previousFetch;
  }
}

/** The sent messages or input items, whichever the wire names them. */
function sentItems(body: UnknownRecord): Array<UnknownRecord> {
  const sent = body['messages'] ?? body['input'];
  if (!Array.isArray(sent)) throw new TypeError('expected a sent item list');
  return sent.filter(isRecord);
}

describe('a Continue request on the Messages wire', () => {
  it('sends the kept thinking block with its step, then both results', async () => {
    const body = await sentBody(
      (input) =>
        createAnthropicModelClient({
          ...base,
          baseUrl: ANTHROPIC_DEFAULT_BASE_URL,
          reasoningDeclared: true,
          input,
        }),
      MESSAGES_STREAM,
      continueRequest({
        anthropic: { signature: 'sig-kept' },
      }),
    );

    const items = sentItems(body);
    const assistant = items.filter(({ role }) => role === 'assistant').at(-1);
    expect(assistant?.['content']).toEqual([
      expect.objectContaining({
        type: 'thinking',
        thinking: KEPT_REASONING,
        signature: 'sig-kept',
      }),
      { type: 'text', text: 'Reading both files.' },
      expect.objectContaining({ type: 'tool_use', id: 'call-1' }),
      expect.objectContaining({ type: 'tool_use', id: 'call-2' }),
    ]);
    // One user turn carries both results, and nothing else follows them.
    const last = items.at(-1);
    expect(last?.['role']).toBe('user');
    const blocks = JSON.stringify(last);
    expect(blocks).toContain('"tool_use_id":"call-1"');
    expect(blocks).toContain('"tool_use_id":"call-2"');
    expect(blocks).toContain(FIRST_TEXT);
    expect(blocks).toContain(SECOND_TEXT);
  });
});

describe('a Continue request on the Responses wire', () => {
  it('carries the kept reasoning as a stored item reference whose step is in progress', async () => {
    const body = await sentBody(
      (input) => createOpenAIModelClient({ ...base, input }),
      RESPONSES_STREAM,
      continueRequest({
        openai: { itemId: 'rs_kept', reasoningEncryptedContent: 'enc-kept' },
      }),
    );

    expect(body['store']).not.toBe(false);
    const items = sentItems(body);
    expect(items).toContainEqual(
      expect.objectContaining({ type: 'item_reference', id: 'rs_kept' }),
    );
    // Both calls of the kept step, then both results, and nothing after them.
    const tail = items.slice(-4).map((item) => ({
      type: item['type'],
      id: item['call_id'],
    }));
    expect(tail).toEqual([
      { type: 'function_call', id: 'call-1' },
      { type: 'function_call', id: 'call-2' },
      { type: 'function_call_output', id: 'call-1' },
      { type: 'function_call_output', id: 'call-2' },
    ]);
    const results = JSON.stringify(items.slice(-2));
    expect(results).toContain(FIRST_TEXT);
    expect(results).toContain(SECOND_TEXT);
  });
});

describe('a Continue request on the Codex wire', () => {
  it('sends store:false and the kept encrypted reasoning with both results', async () => {
    const body = await sentBody(
      (input) =>
        createOpenAICodexModelClient({ ...base, accountId: 'acct', input }),
      RESPONSES_STREAM,
      continueRequest({
        openai: { itemId: 'rs_kept', reasoningEncryptedContent: 'enc-kept' },
      }),
    );

    expect(body['store']).toBe(false);
    const items = sentItems(body);
    expect(items).toContainEqual(
      expect.objectContaining({
        type: 'reasoning',
        encrypted_content: 'enc-kept',
        summary: [expect.objectContaining({ text: KEPT_REASONING })],
      }),
    );
    const outputs = items.filter(
      (item) => item['type'] === 'function_call_output',
    );
    const sent = JSON.stringify(outputs);
    expect(outputs).toHaveLength(2);
    expect(sent).toContain('"call_id":"call-1"');
    expect(sent).toContain('"call_id":"call-2"');
    expect(sent).toContain(FIRST_TEXT);
    expect(sent).toContain(SECOND_TEXT);
  });
});
