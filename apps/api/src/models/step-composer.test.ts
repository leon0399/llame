import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import {
  simulateReadableStream,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type ToolResultPart,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import {
  EPOCH_MAX_BASE64_BYTES,
  toolResultOutput,
} from '../media/epoch-admission';
import { descriptor, fakeResolver } from '../media/media-fixtures';
import { buildContext, type StoredMessage } from '../chats/context-builder';
import type { ModelStreamInput } from './model-client';
import { composeStepMessages, installStepPreparation } from './step-composer';

const A = '0192f3a4-5b6c-7d8e-9f01-00000000000a';
const B = '0192f3a4-5b6c-7d8e-9f01-00000000000b';
const MISSING = '0192f3a4-5b6c-7d8e-9f01-0000000000ff';

const CHAT = {
  id: '7b1f4c2a-3d5e-4a68-9f02-1c8d6b3e5a47',
  lane: 'main',
} as const;

const fileRef = (id: string) =>
  ({ type: 'file', data: `media://${id}`, mediaType: 'image/png' }) as const;

describe('composeStepMessages', () => {
  it('labels each attachment and sends the model variant after the rail items, before the text', async () => {
    const { resolver } = fakeResolver([descriptor(A), descriptor(B)]);
    const messages: Array<ModelMessage> = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'rail item' },
          { type: 'text', text: 'temporal row' },
          fileRef(A),
          fileRef(B),
          { type: 'text', text: 'compare these' },
        ],
      },
    ];

    expect(
      await composeStepMessages(messages, {
        resolver,
        imageInput: true,
        toolResultImages: 'content',
      }),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'rail item' },
          { type: 'text', text: 'temporal row' },
          { type: 'text', text: `Image 1 (media://${A}):` },
          {
            type: 'image',
            image: new Uint8Array([0x61]),
            mediaType: 'image/png',
          },
          { type: 'text', text: `Image 2 (media://${B}):` },
          {
            type: 'image',
            image: new Uint8Array([0x62]),
            mediaType: 'image/png',
          },
          { type: 'text', text: 'compare these' },
        ],
      },
    ]);
  });

  it('restarts labels in each message', async () => {
    const { resolver } = fakeResolver([descriptor(A), descriptor(B)]);
    const composed = await composeStepMessages(
      [
        { role: 'user', content: [fileRef(A)] },
        { role: 'assistant', content: [{ type: 'text', text: 'seen' }] },
        { role: 'user', content: [fileRef(B)] },
      ],
      { resolver, imageInput: true, toolResultImages: 'content' },
    );

    expect(composed[0]?.content).toContainEqual({
      type: 'text',
      text: `Image 1 (media://${A}):`,
    });
    expect(composed[2]?.content).toContainEqual({
      type: 'text',
      text: `Image 1 (media://${B}):`,
    });
  });

  it('gives a text-only model the omitted placeholder and loads no bytes', async () => {
    const { resolver } = fakeResolver([descriptor(A, { name: 'shot.png' })]);
    const loadModelBytes = vi.spyOn(resolver, 'loadModelBytes');
    const composed = await composeStepMessages(
      [
        {
          role: 'user',
          content: [fileRef(A), { type: 'text', text: 'what?' }],
        },
      ],
      { resolver, imageInput: false, toolResultImages: 'content' },
    );

    expect(composed).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: `Image 1 (media://${A}):` },
          {
            type: 'text',
            text: `[image media://${A} shot.png 1600×900, omitted: this model has no image input]`,
          },
          { type: 'text', text: 'what?' },
        ],
      },
    ]);
    expect(loadModelBytes).not.toHaveBeenCalled();
  });

  it('keeps the label and an unavailable placeholder for an unresolvable reference', async () => {
    const { resolver, loads } = fakeResolver([]);
    const composed = await composeStepMessages(
      [{ role: 'user', content: [fileRef(MISSING)] }],
      { resolver, imageInput: true, toolResultImages: 'content' },
    );

    expect(composed).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: `Image 1 (media://${MISSING}):` },
          { type: 'text', text: `[image media://${MISSING} unavailable]` },
        ],
      },
    ]);
    expect(loads).toEqual([]);
  });

  it('gives an attached image whose bytes cannot be read the unavailable placeholder', async () => {
    const { resolver } = fakeResolver([descriptor(A)]);
    const composed = await composeStepMessages(
      [{ role: 'user', content: [fileRef(A)] }],
      {
        resolver: {
          ...resolver,
          loadModelBytes: () => Promise.resolve(new Map()),
        },
        imageInput: true,
        toolResultImages: 'content',
      },
    );

    expect(composed).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: `Image 1 (media://${A}):` },
          { type: 'text', text: `[image media://${A} unavailable]` },
        ],
      },
    ]);
  });

  it('sends the limit placeholder past the window and loads only attached bytes', async () => {
    // Each base64 variant is two thirds of the byte bound, so only one fits.
    const modelByteSize = EPOCH_MAX_BASE64_BYTES / 2;
    const { resolver, loads } = fakeResolver([
      descriptor(A, { modelByteSize }),
      descriptor(B, { modelByteSize }),
    ]);
    const composed = await composeStepMessages(
      [A, B].map(
        (id): ModelMessage => ({ role: 'user', content: [fileRef(id)] }),
      ),
      { resolver, imageInput: true, toolResultImages: 'content' },
    );

    expect(loads).toEqual([A]);
    const anImage: unknown = expect.objectContaining({ type: 'image' });
    expect(composed[0]?.content).toEqual([
      { type: 'text', text: `Image 1 (media://${A}):` },
      anImage,
    ]);
    expect(composed[1]?.content).toEqual([
      { type: 'text', text: `Image 1 (media://${B}):` },
      {
        type: 'text',
        text: `[image media://${B} 0b.png 1600×900, not attached: this context's image limit is reached]`,
      },
    ]);
  });

  it('is idempotent and returns messages without references unchanged', async () => {
    const { resolver } = fakeResolver([descriptor(A)]);
    const plain: Array<ModelMessage> = [{ role: 'user', content: 'hello' }];
    expect(
      await composeStepMessages(plain, {
        resolver,
        imageInput: true,
        toolResultImages: 'content',
      }),
    ).toBe(plain);

    const once = await composeStepMessages(
      [{ role: 'user', content: [fileRef(A)] }],
      { resolver, imageInput: true, toolResultImages: 'content' },
    );
    expect(
      await composeStepMessages(once, {
        resolver,
        imageInput: true,
        toolResultImages: 'content',
      }),
    ).toBe(once);
  });

  describe('tool results', () => {
    const ENVELOPE = '{"status":"success","kind":"image"}';
    const readResult = (toolCallId: string, id: string): ModelMessage => ({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: 'read',
          output: toolResultOutput(ENVELOPE, id),
        },
      ],
    });
    const outputOf = (message: ModelMessage | undefined) =>
      message?.role === 'tool' && message.content[0]?.type === 'tool-result'
        ? message.content[0].output
        : undefined;

    it('sends an attached read image as content after the result text, in request order with attachments', async () => {
      const { resolver, loads } = fakeResolver([descriptor(A), descriptor(B)]);
      const composed = await composeStepMessages(
        [{ role: 'user', content: [fileRef(A)] }, readResult('call-1', B)],
        { resolver, imageInput: true, toolResultImages: 'content' },
      );

      expect(loads).toEqual([A, B]);
      expect(outputOf(composed[1])).toEqual({
        type: 'content',
        value: [
          { type: 'text', text: ENVELOPE },
          {
            type: 'image-data',
            data: Buffer.from([0x62]).toString('base64'),
            mediaType: 'image/png',
          },
        ],
      });
    });

    it('sends an attached read image as the interim placeholder on a Chat Completions wire and loads no bytes for it', async () => {
      const { resolver, loads } = fakeResolver([
        descriptor(A, { name: 'shot.png' }),
        descriptor(B),
      ]);
      const composed = await composeStepMessages(
        [readResult('call-1', A), { role: 'user', content: [fileRef(B)] }],
        { resolver, imageInput: true, toolResultImages: 'placeholder' },
      );

      expect(loads).toEqual([B]);
      expect(outputOf(composed[0])).toEqual({
        type: 'text',
        value: `${ENVELOPE}\n[image media://${A} shot.png 1600×900, omitted: this connection cannot carry tool-result images yet]`,
      });
      // Owner attachments are still sent as images on that wire.
      expect(composed[1]?.content).toContainEqual(
        expect.objectContaining({ type: 'image' }),
      );
    });

    it.each([
      [
        'a text-only model',
        [descriptor(A, { name: 'shot.png' })],
        false,
        `[image media://${A} shot.png 1600×900, omitted: this model has no image input]`,
      ],
      [
        'another owner or an unknown id',
        [],
        true,
        `[image media://${A} unavailable]`,
      ],
    ])(
      'gives %s a text output with the placeholder and no image',
      async (_, descriptors, imageInput, placeholder) => {
        const { resolver, loads } = fakeResolver(descriptors);
        for (const toolResultImages of ['content', 'placeholder'] as const) {
          const composed = await composeStepMessages(
            [readResult('call-1', A)],
            { resolver, imageInput, toolResultImages },
          );
          expect(outputOf(composed[0])).toEqual({
            type: 'text',
            value: `${ENVELOPE}\n${placeholder}`,
          });
        }
        expect(loads).toEqual([]);
      },
    );

    it('admits read images into the same window as attachments, oldest first', async () => {
      const modelByteSize = EPOCH_MAX_BASE64_BYTES / 2;
      const { resolver, loads } = fakeResolver([
        descriptor(A, { modelByteSize }),
        descriptor(B, { modelByteSize }),
      ]);
      const composed = await composeStepMessages(
        [readResult('call-1', A), readResult('call-2', B)],
        { resolver, imageInput: true, toolResultImages: 'content' },
      );

      expect(loads).toEqual([A]);
      expect(outputOf(composed[0])).toMatchObject({ type: 'content' });
      expect(outputOf(composed[1])).toEqual({
        type: 'text',
        value: `${ENVELOPE}\n[image media://${B} 0b.png 1600×900, not attached: this context's image limit is reached]`,
      });
    });

    it('projects a stored read image result replayed by buildContext', async () => {
      const stored: StoredMessage = {
        id: 'msg-1',
        chatId: 'chat-1',
        seq: 1,
        role: 'assistant',
        senderUserId: null,
        attachments: [],
        createdAt: new Date(0),
        parts: [
          {
            type: 'tool-read',
            toolCallId: 'call-1',
            state: 'output-available',
            input: { path: '/work/shot.png' },
            output: {
              status: 'success',
              kind: 'image',
              media: `media://${A}`,
              mediaType: 'image/png',
              width: 1600,
              height: 900,
              path: '/work/shot.png',
            },
            outcome: 'success',
          },
        ],
      };
      const { messages } = buildContext([stored], {
        systemPrompt: 'system',
        requestKind: 'continuation',
      });
      const composed = await composeStepMessages(messages, {
        resolver: fakeResolver([descriptor(A)]).resolver,
        imageInput: true,
        toolResultImages: 'content',
      });

      expect(
        outputOf(composed.find((message) => message.role === 'tool')),
      ).toMatchObject({
        type: 'content',
        value: [{ type: 'text' }, { type: 'image-data' }],
      });
    });

    it('is idempotent over composed tool outputs and leaves other tool results alone', async () => {
      const { resolver } = fakeResolver([descriptor(A)]);
      const textResult: ModelMessage = {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-0',
            toolName: 'read',
            output: { type: 'text', value: 'plain' },
          },
        ],
      };
      const options = {
        resolver,
        imageInput: true,
        toolResultImages: 'content',
      } as const;
      const once = await composeStepMessages(
        [textResult, readResult('call-1', A)],
        options,
      );
      expect(once[0]).toBe(textResult);
      expect(await composeStepMessages(once, options)).toBe(once);
    });

    it('projects every result of a tool message and leaves a content result without references as is', async () => {
      const { resolver } = fakeResolver([descriptor(A)]);
      const plain: ToolResultPart = {
        type: 'tool-result',
        toolCallId: 'call-0',
        toolName: 'read',
        output: { type: 'content', value: [{ type: 'text', text: 'plain' }] },
      };
      const image = readResult('call-1', A);
      if (image.role !== 'tool') throw new Error('Expected a tool message');

      const [composed] = await composeStepMessages(
        [{ role: 'tool', content: [plain, ...image.content] }],
        { resolver, imageInput: true, toolResultImages: 'content' },
      );

      expect(composed?.content[0]).toBe(plain);
      expect(composed?.content[1]).toMatchObject({
        output: {
          type: 'content',
          value: [{ type: 'text', text: ENVELOPE }, { type: 'image-data' }],
        },
      });
    });
  });
});

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function toolStep(toolCallId: string): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'tool-call', toolCallId, toolName: 'noop', input: '{}' },
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: undefined },
      usage: ZERO_USAGE,
    },
  ];
}

const TEXT_STEP: Array<LanguageModelV3StreamPart> = [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: 'ok' },
  { type: 'text-end', id: 't' },
  {
    type: 'finish',
    finishReason: { unified: 'stop', raw: undefined },
    usage: ZERO_USAGE,
  },
];

/** A model that answers `ok` once per step and records each provider prompt. */
function recordingModel(steps: Array<'tool' | 'text'> = ['text']) {
  const prompts: Array<LanguageModelV3CallOptions['prompt']> = [];
  const model = new MockLanguageModelV3({
    doStream: ({ prompt }) => {
      const step = steps[prompts.length] ?? 'text';
      prompts.push(prompt);
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks:
            step === 'tool' ? toolStep(`call-${prompts.length}`) : TEXT_STEP,
        }),
      });
    },
  });
  return { model, prompts };
}

/** The `data` of a provider prompt's user file parts. */
function promptFileData(prompt: LanguageModelV3CallOptions['prompt']) {
  return prompt.flatMap((message) =>
    message.role === 'user'
      ? message.content.flatMap((part) =>
          part.type === 'file' ? [part.data] : [],
        )
      : [],
  );
}

describe('installStepPreparation', () => {
  it('composes a tool-less request, so no media reference reaches the provider', async () => {
    const { resolver } = fakeResolver([descriptor(A)]);
    const { model, prompts } = recordingModel();
    const input: ModelStreamInput = {
      chat: CHAT,
      messages: [
        { role: 'user', content: [fileRef(A), { type: 'text', text: 'hi' }] },
      ],
      media: resolver,
    };
    const streamOptions = { model, messages: input.messages };
    installStepPreparation(streamOptions, input, ['text', 'image']);

    await expect(streamText(streamOptions).text).resolves.toBe('ok');

    // Only bytes reach the provider: no file part carries a `media://` string.
    expect(promptFileData(prompts[0] ?? [])).toEqual([new Uint8Array([0x61])]);
  });

  it('leaves messages as they are without a resolver and calls no tool hook without tools', async () => {
    const { model, prompts } = recordingModel();
    const onStepStart = vi.fn();
    const input: ModelStreamInput = {
      chat: CHAT,
      messages: [{ role: 'user', content: 'hello' }],
      onStepStart,
    };
    const streamOptions = { model, messages: input.messages };
    installStepPreparation(streamOptions, input, undefined);

    await expect(streamText(streamOptions).text).resolves.toBe('ok');

    expect(onStepStart).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(1);
  });

  it('composes the onStepStart override after the step cap disables tools', async () => {
    const { resolver } = fakeResolver([descriptor(A)]);
    const { model, prompts } = recordingModel(['tool', 'text']);
    const onCapReached = vi.fn();
    const seen: Array<Array<ModelMessage>> = [];
    const input: ModelStreamInput = {
      chat: CHAT,
      messages: [{ role: 'user', content: 'start' }],
      tools: {
        noop: tool({ inputSchema: z.object({}), execute: () => 'done' }),
      },
      maxSteps: 1,
      media: resolver,
      onCapReached,
      onStepStart: ({ messages }) => {
        seen.push(messages);
        return [...messages, { role: 'user', content: [fileRef(A)] }];
      },
    };
    const streamOptions = {
      model,
      messages: input.messages,
      tools: input.tools,
      stopWhen: stepCountIs(2),
    };
    installStepPreparation(streamOptions, input, ['text', 'image']);

    await expect(streamText(streamOptions).text).resolves.toBe('ok');

    // The hook saw the untransformed messages on every step.
    expect(JSON.stringify(seen)).not.toContain('"type":"image"');
    expect(onCapReached).toHaveBeenCalledOnce();
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(promptFileData(prompt)).toEqual([new Uint8Array([0x61])]);
    }
  });

  describe('reads inside a Run', () => {
    const IDS = [1, 2, 3, 4, 5].map(
      (n) => `0192f3a4-5b6c-7d8e-9f01-0000000000a${n}`,
    );
    // Each base64 variant is 5 MiB, so four fit the 24 MiB bound.
    const modelByteSize = (5 * 2 ** 20 * 3) / 4;

    /** A Run that reads `IDS` one per step and then answers. */
    async function readFive() {
      const { resolver } = fakeResolver(
        IDS.map((id) => descriptor(id, { modelByteSize })),
      );
      const { model, prompts } = recordingModel([
        'tool',
        'tool',
        'tool',
        'tool',
        'tool',
      ]);
      let reads = 0;
      const input: ModelStreamInput = {
        chat: CHAT,
        messages: [{ role: 'user', content: 'read them' }],
        tools: {
          noop: tool({
            inputSchema: z.object({}),
            execute: () => ({ media: `media://${IDS[reads++]}` }),
            toModelOutput: ({ output }) =>
              toolResultOutput('envelope', output.media.slice(8)),
          }),
        },
        media: resolver,
      };
      const streamOptions = {
        model,
        messages: input.messages,
        tools: input.tools,
        stopWhen: stepCountIs(6),
      };
      installStepPreparation(streamOptions, input, ['text', 'image']);
      await expect(streamText(streamOptions).text).resolves.toBe('ok');
      return prompts;
    }

    /** The tool-result outputs of a provider prompt, in order. */
    function toolOutputs(prompt: LanguageModelV3CallOptions['prompt']) {
      return prompt.flatMap((message) =>
        message.role === 'tool'
          ? message.content.flatMap((part) =>
              part.type === 'tool-result' ? [part.output] : [],
            )
          : [],
      );
    }

    it('sends every read in the window as image content and only the newest past the bounds as the limit placeholder', async () => {
      const prompts = await readFive();

      expect(prompts).toHaveLength(6);
      const last = toolOutputs(prompts[5] ?? []);
      expect(last.slice(0, 4)).toEqual(
        IDS.slice(0, 4).map((id) => ({
          type: 'content',
          value: [
            { type: 'text', text: 'envelope' },
            {
              type: 'image-data',
              data: Buffer.from([id.codePointAt(35) ?? 0]).toString('base64'),
              mediaType: 'image/png',
            },
          ],
        })),
      );
      expect(last[4]).toEqual({
        type: 'text',
        value: `envelope\n[image media://${IDS[4]} a5.png 1600×900, not attached: this context's image limit is reached]`,
      });
      // Each step projects the same prefix: earlier steps attached the same reads.
      expect(toolOutputs(prompts[4] ?? [])).toEqual(last.slice(0, 4));
    });
  });

  it('treats a model without declared input as text-only', async () => {
    const { resolver, loads } = fakeResolver([descriptor(A)]);
    const { model, prompts } = recordingModel();
    const input: ModelStreamInput = {
      chat: CHAT,
      messages: [{ role: 'user', content: [fileRef(A)] }],
      media: resolver,
    };
    const streamOptions = { model, messages: input.messages };
    installStepPreparation(streamOptions, input, undefined);

    await expect(streamText(streamOptions).text).resolves.toBe('ok');

    expect(promptFileData(prompts[0] ?? [])).toEqual([]);
    expect(JSON.stringify(prompts[0])).toContain(
      'omitted: this model has no image input',
    );
    expect(loads).toEqual([]);
  });
});

describe('installStepPreparation step cap', () => {
  const toolStepResult = { toolCalls: [{ toolName: 'noop' }] };
  const textStepResult = { toolCalls: [] };

  /** The installed `prepareStep` result after `steps` prior steps. */
  async function prepare(
    input: Partial<ModelStreamInput>,
    steps: ReadonlyArray<{ toolCalls: ReadonlyArray<unknown> }>,
  ) {
    const onCapReached = vi.fn();
    const streamOptions: Parameters<typeof streamText>[0] = {
      model: recordingModel().model,
      messages: [],
    };
    installStepPreparation(
      streamOptions,
      { chat: CHAT, messages: [], onCapReached, ...input },
      undefined,
    );
    // SAFETY: the installed `prepareStep` reads only `messages`, `stepNumber`
    // and each prior step's `toolCalls`, which these stand-ins carry.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const args = { messages: [], stepNumber: steps.length, steps } as never;
    const result = await streamOptions.prepareStep?.(args);
    return { result, onCapReached };
  }

  const tools = {
    noop: tool({ inputSchema: z.object({}), execute: () => 'done' }),
  };

  it('keeps tools until maxSteps prior steps requested one', async () => {
    const { result, onCapReached } = await prepare({ tools, maxSteps: 1 }, []);

    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('declares no tools once maxSteps prior steps requested one', async () => {
    const { result, onCapReached } = await prepare({ tools, maxSteps: 1 }, [
      toolStepResult,
    ]);

    expect(result).toEqual({ activeTools: [] });
    expect(onCapReached).toHaveBeenCalledOnce();
  });

  it('counts only the prior steps that requested a tool', async () => {
    const { result, onCapReached } = await prepare({ tools, maxSteps: 2 }, [
      textStepResult,
      toolStepResult,
    ]);

    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('never reaches a cap without tools', async () => {
    const { result, onCapReached } = await prepare({ maxSteps: 0 }, []);

    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('never reaches a cap without maxSteps', async () => {
    const { result, onCapReached } = await prepare({ tools }, [toolStepResult]);

    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });
});
