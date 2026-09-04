import {
  NoOutputGeneratedError,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from 'ai';

import { createFakeModelClient, ZERO_USAGE } from './fake-model-client';

/**
 * A tool whose `inputSchema` the AI SDK cannot prepare, so reaching it at all
 * errors the stream. `ToolSet` has no shape for a deliberately invalid schema.
 */
function unpreparableTools(): ToolSet {
  // SAFETY: this value is never executed as a tool — the SDK rejects the schema
  // while preparing the call, which is exactly what the assertion below checks.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return { bad_tool: { description: 'bad', inputSchema: 42 } } as never;
}

async function collectText(stream: AsyncIterable<string>): Promise<string> {
  let text = '';

  for await (const chunk of stream) {
    text += chunk;
  }

  return text;
}

async function collectFullText(
  stream: AsyncIterable<TextStreamPart<ToolSet>>,
): Promise<string> {
  let text = '';

  for await (const part of stream) {
    if (part.type === 'text-delta') {
      text += part.text;
    }
  }

  return text;
}

const messages = [
  {
    role: 'user',
    content: 'Hello',
  },
] satisfies Array<ModelMessage>;

describe('createFakeModelClient', () => {
  it('fires callbacks when a response stream is consumed', async () => {
    const client = createFakeModelClient(['done']);
    const onTextDelta = vi.fn();
    const onFinish = vi.fn();
    const result = client.streamText({
      messages,
      onTextDelta,
      onFinish,
    });

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();

    await expect(collectText(result.textStream)).resolves.toBe('done');

    expect(onTextDelta).toHaveBeenCalledWith('done');
    expect(onFinish).toHaveBeenCalledWith({
      text: 'done',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });
  });

  it('keeps empty and unconsumed responses lazy', async () => {
    const client = createFakeModelClient([]);
    const onTextDelta = vi.fn();
    const onFinish = vi.fn();
    const result = client.streamText({
      messages,
      onTextDelta,
      onFinish,
    });

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();

    await expect(result.text).resolves.toBe('');

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledWith({
      text: '',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });
  });

  it('does not resolve text until an async onFinish settles', async () => {
    const client = createFakeModelClient(['done']);
    let finish: () => void = () => undefined;
    const finishPromise = new Promise<void>((resolve) => {
      finish = () => resolve();
    });
    const onFinish = vi.fn(() => finishPromise);
    const textPromise = client.streamText({ messages, onFinish }).text;
    let textResolved = false;

    void textPromise.then(() => {
      textResolved = true;
    });
    await vi.waitFor(() => {
      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    expect(textResolved).toBe(false);

    finish();

    await expect(textPromise).resolves.toBe('done');
  });

  it('rejects text when an async onFinish rejects', async () => {
    const client = createFakeModelClient(['done']);
    const error = new Error('finish failed');

    await expect(
      client.streamText({
        messages,
        onFinish: () => Promise.reject(error),
      }).text,
    ).rejects.toBe(error);
  });

  it('cycles through preset responses', async () => {
    const client = createFakeModelClient(['first', 'second']);

    await expect(
      collectText(client.streamText({ messages }).textStream),
    ).resolves.toBe('first');
    await expect(
      collectText(client.streamText({ messages }).textStream),
    ).resolves.toBe('second');
    await expect(
      collectText(client.streamText({ messages }).textStream),
    ).resolves.toBe('first');
  });

  it('keeps text and full-stream surfaces in agreement', async () => {
    const client = createFakeModelClient(['same']);

    await expect(client.streamText({ messages }).text).resolves.toBe('same');
    await expect(
      collectFullText(client.streamText({ messages }).fullStream),
    ).resolves.toBe('same');
  });

  it('exposes fake model metadata', () => {
    expect(createFakeModelClient(['response'])).toMatchObject({
      model: 'fake-model',
      provider: 'fake',
    });
  });
});

async function collectParts(
  stream: AsyncIterable<TextStreamPart<ToolSet>>,
): Promise<Array<TextStreamPart<ToolSet>>> {
  const parts: Array<TextStreamPart<ToolSet>> = [];

  for await (const part of stream) {
    parts.push(part);
  }

  return parts;
}

describe('createFakeModelClient stream shape', () => {
  it('emits no text delta at all for an empty response', async () => {
    const parts = await collectParts(
      createFakeModelClient([]).streamText({ messages }).fullStream,
    );

    expect(parts.map(({ type }) => type)).toStrictEqual([
      'start',
      'start-step',
      'text-start',
      'text-end',
      'finish-step',
      'finish',
    ]);
  });

  it('opens and closes the text block under one id', async () => {
    const parts = await collectParts(
      createFakeModelClient(['done']).streamText({ messages }).fullStream,
    );

    const ids = parts
      .filter(
        (part) =>
          part.type === 'text-start' ||
          part.type === 'text-delta' ||
          part.type === 'text-end',
      )
      .map((part) => ('id' in part ? part.id : undefined));
    expect(ids).toStrictEqual([
      'fake-response',
      'fake-response',
      'fake-response',
    ]);
  });

  it('reports the fake provider and model on the completed step', async () => {
    const result = createFakeModelClient(['done']).streamText({ messages });
    await result.text;

    expect((await result.steps)[0]?.model).toStrictEqual({
      provider: 'fake',
      modelId: 'fake-model',
    });
  });

  it('forwards caller tools to the model rather than dropping them', async () => {
    // A tool the SDK cannot prepare fails the stream — but only if the tools
    // reached `streamText` at all.
    await expect(
      createFakeModelClient(['done']).streamText({
        messages,
        tools: unpreparableTools(),
      }).text,
    ).rejects.toThrow(NoOutputGeneratedError);

    await expect(
      createFakeModelClient(['done']).streamText({ messages }).text,
    ).resolves.toBe('done');
  });
});
