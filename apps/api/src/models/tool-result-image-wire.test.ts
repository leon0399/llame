/**
 * A replayed `read` image result on every wire (vision-media D6): the real
 * clients and provider adapters serialize the request, and only the transport
 * is stubbed, so each assertion reads the body a provider would receive.
 */
import type { ModelMessage } from 'ai';
import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';

import { toolResultOutput } from '../media/epoch-admission';
import { descriptor, fakeResolver } from '../media/media-fixtures';
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  createAnthropicModelClient,
} from './anthropic-model-client';
import type { ModelInput } from './model-catalog';
import type { ModelClient } from './model-client';
import { createOpenAICodexModelClient } from './openai-codex-model-client';
import { createOpenAICompletionsModelClient } from './openai-completions-model-client';
import { createOpenAIModelClient } from './openai-model-client';
import { createOpenCodeGoModelClient } from './opencode-go-model-client';

const ID = '0192f3a4-5b6c-7d8e-9f01-00000000000a';
const ID2 = '0192f3a4-5b6c-7d8e-9f01-00000000000b';
const CHAT = { id: 'chat-test', lane: 'main' } as const;
const USER_AGENT = 'llame/0.0.0-test';
const ENVELOPE = `{"status":"success","kind":"image","media":"media://${ID}"}`;
const ENVELOPE2 = `{"status":"success","kind":"image","media":"media://${ID2}"}`;
/** The model variant bytes the fake resolver serves for `ID` and `ID2`. */
const VARIANT_BASE64 = Buffer.from([ID.codePointAt(35) ?? 0]).toString(
  'base64',
);
const VARIANT2_BASE64 = Buffer.from([ID2.codePointAt(35) ?? 0]).toString(
  'base64',
);
const VISION: ReadonlyArray<ModelInput> = ['text', 'image'];

const messages: Array<ModelMessage> = [
  { role: 'user', content: 'Look at the screenshot.' },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: '/work/shot.png' },
      },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'read',
        output: toolResultOutput(ENVELOPE, ID),
      },
    ],
  },
];

/** Two consecutive `read` image results, from one step's two calls. */
const twoReads: Array<ModelMessage> = [
  { role: 'user', content: 'Compare the screenshots.' },
  {
    role: 'assistant',
    content: ['call-1', 'call-2'].map((toolCallId, at) => ({
      type: 'tool-call',
      toolCallId,
      toolName: 'read',
      input: { path: `/work/shot-${at + 1}.png` },
    })),
  },
  ...(
    [
      ['call-1', ENVELOPE, ID],
      ['call-2', ENVELOPE2, ID2],
    ] as const
  ).map(
    ([toolCallId, envelope, id]): ModelMessage => ({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: 'read',
          output: toolResultOutput(envelope, id),
        },
      ],
    }),
  ),
];

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

const COMPLETIONS_STREAM = () =>
  sse([
    '{"id":"c","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}]}',
    '{"id":"c","object":"chat.completion.chunk","created":0,"model":"m","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
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

const base = {
  credential: 'sk-test',
  providerModelId: 'model-test',
  modelId: 'system:test:model-test',
  contextWindowTokens: 128_000,
  userAgent: USER_AGENT,
  requestHeaders: {},
};

/**
 * Streams `history` (by default one read) with `input` and the owner's media through a
 * client built after the transport stub is in place (the fixed transports
 * capture `globalThis.fetch` at construction), and returns the sent body.
 */
async function sentBody(
  build: (input: ReadonlyArray<ModelInput>) => ModelClient,
  response: () => Response,
  input: ReadonlyArray<ModelInput> = VISION,
  history: Array<ModelMessage> = messages,
): Promise<UnknownRecord> {
  const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(response()),
  );
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const { resolver } = fakeResolver([descriptor(ID), descriptor(ID2)]);
    await expect(
      build(input).streamText({
        chat: CHAT,
        messages: history,
        media: resolver,
      }).text,
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

describe('a replayed read image on each wire', () => {
  it.each([
    [
      'Responses',
      (input: ReadonlyArray<ModelInput>) =>
        createOpenAIModelClient({ ...base, input }),
    ],
    [
      'Codex',
      (input: ReadonlyArray<ModelInput>) =>
        createOpenAICodexModelClient({ ...base, accountId: 'acct', input }),
    ],
  ])(
    'sends the text and the image in the function call output on the %s wire',
    async (_, build) => {
      const body = await sentBody(build, RESPONSES_STREAM);

      expect(body.input).toContainEqual(
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call-1',
          output: [
            { type: 'input_text', text: ENVELOPE },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${VARIANT_BASE64}`,
            },
          ],
        }),
      );
      // The reference itself never reaches the provider as an image URL.
      expect(JSON.stringify(body)).not.toContain('"image_url":"media://');
    },
  );

  it('sends the text and the image in the tool result on the Messages wire', async () => {
    const body = await sentBody(
      (input) =>
        createAnthropicModelClient({
          ...base,
          baseUrl: ANTHROPIC_DEFAULT_BASE_URL,
          reasoningDeclared: false,
          input,
        }),
      MESSAGES_STREAM,
    );

    expect(body.messages).toContainEqual({
      role: 'user',
      content: [
        expect.objectContaining({
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: [
            { type: 'text', text: ENVELOPE },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: VARIANT_BASE64,
              },
            },
          ],
        }),
      ],
    });
  });

  describe.each([
    [
      'openai-completions',
      (input: ReadonlyArray<ModelInput>) =>
        createOpenAICompletionsModelClient({
          ...base,
          baseUrl: 'https://api.example.test/v1',
          input,
        }),
    ],
    [
      'opencode-go',
      (input: ReadonlyArray<ModelInput>) =>
        createOpenCodeGoModelClient({ ...base, input }),
    ],
  ])('on the %s wire', (_, build) => {
    /** The sent `role: tool` messages. */
    const toolMessages = (body: UnknownRecord): Array<UnknownRecord> => {
      const sent: unknown = body.messages;
      return Array.isArray(sent)
        ? sent.filter(isRecord).filter(({ role }) => role === 'tool')
        : [];
    };

    it('moves the images of consecutive tool results into one following user message as image_url parts', async () => {
      const body = await sentBody(build, COMPLETIONS_STREAM, VISION, twoReads);

      expect(Array.isArray(body.messages) && body.messages.slice(2)).toEqual([
        {
          role: 'tool',
          tool_call_id: 'call-1',
          content: `${ENVELOPE}\n(image attached below)`,
        },
        {
          role: 'tool',
          tool_call_id: 'call-2',
          content: `${ENVELOPE2}\n(image attached below)`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Images from tool results:' },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${VARIANT_BASE64}` },
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${VARIANT2_BASE64}` },
            },
          ],
        },
      ]);
    });

    it('gives a text-only model the omitted placeholder and no image message', async () => {
      const body = await sentBody(build, COMPLETIONS_STREAM, ['text']);

      expect(toolMessages(body)).toEqual([
        {
          role: 'tool',
          tool_call_id: 'call-1',
          content: `${ENVELOPE}\n[image media://${ID} 0a.png 1600×900, omitted: this model has no image input]`,
        },
      ]);
      const serialized = JSON.stringify(body);
      for (const absent of [
        '(image attached below)',
        'Images from tool results:',
        'image_url',
      ]) {
        expect(serialized).not.toContain(absent);
      }
    });
  });

  it('gives a text-only model the omitted placeholder on a content wire', async () => {
    const body = await sentBody(
      (input) => createOpenAIModelClient({ ...base, input }),
      RESPONSES_STREAM,
      ['text'],
    );

    expect(body.input).toContainEqual(
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call-1',
        output: `${ENVELOPE}\n[image media://${ID} 0a.png 1600×900, omitted: this model has no image input]`,
      }),
    );
  });
});
