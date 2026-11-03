/**
 * The Responses wire's storage contract (design D12): the provider keeps no
 * response for later retrieval through the API, a reasoning entry asks for the
 * encrypted form of its reasoning, and a later turn replays that content
 * instead of a reference to a stored item. Every assertion reads the body a
 * provider would receive: the client and the real `@ai-sdk/openai` adapter
 * serialize the request, and only the transport is stubbed.
 */
import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';
import type { ModelMessage, ProviderMetadata } from 'ai';

import { toPromptReasoningPart } from '../chats/context-builder';
import { createOpenAIModelClient } from './openai-model-client';

const CHAT = { id: 'chat-test', lane: 'main' } as const;
const USER_AGENT = 'llame/0.0.0-test';
const FIRST_TEXT = 'The first file says hello.';
const KEPT_REASONING = 'I should read both files before answering.';

/** One minimal completed turn, enough for the request to settle. */
const RESPONSES_STREAM = () =>
  new Response(
    [
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"item-1"}}\n\n',
      'data: {"type":"response.output_text.delta","item_id":"item-1","delta":"done"}\n\n',
      'data: {"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      'data: [DONE]\n\n',
    ].join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );

const USER_MESSAGE: ModelMessage = {
  role: 'user',
  content: 'Compare both files.',
};

const ANSWER_MESSAGE: ModelMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: FIRST_TEXT }],
};

/** One reasoning part as a later turn replays it. */
function replayedReasoning(providerMetadata: ProviderMetadata): ModelMessage {
  return {
    role: 'assistant',
    content: [
      toPromptReasoningPart({
        type: 'reasoning',
        text: KEPT_REASONING,
        providerMetadata,
      }),
    ],
  };
}

/**
 * Streams `messages` through a client built over a stubbed transport and
 * returns the serialized body of the one request it sent.
 */
async function sentBody(
  config: Partial<Parameters<typeof createOpenAIModelClient>[0]>,
  messages: Array<ModelMessage> = [USER_MESSAGE, ANSWER_MESSAGE],
): Promise<UnknownRecord> {
  const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(RESPONSES_STREAM()),
  );
  const client = createOpenAIModelClient({
    credential: 'sk-test',
    providerModelId: 'gpt-test',
    modelId: 'system:test:gpt-test',
    contextWindowTokens: 128_000,
    userAgent: USER_AGENT,
    requestHeaders: {},
    fetch: fetchMock,
    ...config,
  });

  await expect(client.streamText({ chat: CHAT, messages }).text).resolves.toBe(
    'done',
  );
  const [request, init] = fetchMock.mock.calls[0] ?? [];
  if (request === undefined) throw new Error('no request was sent');
  const body: unknown = JSON.parse(await new Request(request, init).text());
  if (!isRecord(body)) throw new TypeError('expected a JSON request body');
  return body;
}

/** The sent input items. */
function sentItems(body: UnknownRecord): Array<UnknownRecord> {
  const sent = body['input'];
  if (!Array.isArray(sent)) throw new TypeError('expected a sent item list');
  return sent.filter(isRecord);
}

describe('the Responses wire stores no response (design D12)', () => {
  // The adapter decides from a model-id prefix whether a model reasons; a
  // declared entry forces that treatment, so an id it does not know — a proxy
  // (`proxy-reasoner`), a gateway alias, a new model — still asks for the
  // encrypted form the replay needs.
  it('a reasoning entry stores nothing and asks for encrypted reasoning, whatever its id', async () => {
    const body = await sentBody({
      reasoningDeclared: true,
      providerModelId: 'proxy-reasoner',
    });

    expect(body['store']).toBe(false);
    expect(body['include']).toEqual(['reasoning.encrypted_content']);
  });

  // `gpt-4.1` is not a reasoning model: asking it for encrypted reasoning
  // content would be rejected, so the adapter's own rule stays in force.
  it('a non-reasoning entry keeps the adapter default', async () => {
    const body = await sentBody({ providerModelId: 'gpt-4.1' });

    expect(body['store']).toBe(false);
    expect(body['include']).toBeUndefined();
  });

  it('an operator cannot turn storage on', async () => {
    const body = await sentBody({ providerOptions: { store: true } });

    expect(body['store']).toBe(false);
  });

  it('sends a replayed reasoning part as encrypted content, never an item reference', async () => {
    const body = await sentBody({ reasoningDeclared: true }, [
      USER_MESSAGE,
      replayedReasoning({
        openai: { itemId: 'rs_kept', reasoningEncryptedContent: 'enc-kept' },
      }),
      ANSWER_MESSAGE,
    ]);

    expect(sentItems(body)).toContainEqual({
      type: 'reasoning',
      id: 'rs_kept',
      encrypted_content: 'enc-kept',
      summary: [{ type: 'summary_text', text: KEPT_REASONING }],
    });
    expect(JSON.stringify(body['input'])).not.toContain('item_reference');
  });

  it('omits a part that carries only an item id and succeeds', async () => {
    const body = await sentBody({}, [
      USER_MESSAGE,
      replayedReasoning({ openai: { itemId: 'rs_old' } }),
      ANSWER_MESSAGE,
    ]);

    const serialized = JSON.stringify(sentItems(body));
    expect(serialized).not.toContain('item_reference');
    expect(serialized).not.toContain('"type":"reasoning"');
    expect(serialized).not.toContain('rs_old');
    // The turn's own text still reaches the model.
    expect(serialized).toContain(FIRST_TEXT);
  });
});
