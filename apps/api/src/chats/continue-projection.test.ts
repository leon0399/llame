/**
 * The Continue projection (turn-actions D5/D6): the kept parts of a source
 * reply as the messages a Continue Run sends. A step is one model response —
 * its reasoning, its text, and all its calls — followed by one message with the
 * results; a kept in-Run item follows its step's results, and no budget applies.
 */

import type { AssistantContent, ModelMessage, ToolResultPart } from 'ai';

import { serializeNativeModelOutput } from '@workspace/native-file-tools';

import { composeStepMessages } from '../models/step-composer';
import { neutralizeToolResult } from './tool-observation-neutralizer';
import { fakeResolver } from '../media/media-fixtures';
import type { MessagePart } from './context-builder';
import {
  continueStateFromEvents,
  continuedRecords,
  projectContinueParts,
  type ContinueState,
} from './continue-projection';

const CALL_ID = 'call-1';
const CALL_ID_2 = 'call-2';

function toolPart(
  toolCallId: string,
  output: string,
  toolName = 'read',
): MessagePart {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: 'output-available',
    input: { path: `/work/${toolCallId}` },
    output: { status: 'success', text: output },
    outcome: 'success',
  };
}

function reasoning(text: string, signature?: string): MessagePart {
  return {
    type: 'reasoning',
    text,
    ...(signature !== undefined && {
      providerMetadata: { anthropic: { signature } },
    }),
  };
}

function contextItem(text: string): MessagePart {
  return {
    type: 'data-context',
    data: {
      v: 1,
      producer: 'instructions',
      runId: '0192f3a4-5b6c-7d8e-9f01-000000000001',
      payload: {},
      text,
    },
  };
}

/** The assistant content parts of the message at `index`. */
function assistantContent(
  messages: Array<ModelMessage>,
  index: number,
): Array<AssistantContent[number]> {
  const message = messages[index];
  if (message?.role !== 'assistant') {
    throw new TypeError(`message ${index} is not an assistant message`);
  }
  return Array.isArray(message.content)
    ? message.content
    : [{ type: 'text' as const, text: message.content }];
}

function toolResults(
  messages: Array<ModelMessage>,
  index: number,
): Array<ToolResultPart> {
  const message = messages[index];
  if (message?.role !== 'tool' || !Array.isArray(message.content)) {
    throw new TypeError(`message ${index} is not a tool message`);
  }
  // The tool role's content is a list of tool-result parts in the SDK's own
  // `ModelMessage` union, and the guard above narrowed the message to it.
  return message.content.filter((part) => part.type === 'tool-result');
}

function state(parts: Array<MessagePart>, steps: Record<string, number> = {}) {
  return {
    parts,
    stepNumbers: new Map(Object.entries(steps)),
    results: new Map(),
  } satisfies ContinueState;
}

describe('the Continue projection', () => {
  it('keeps parallel calls of one step in one assistant turn, then their results', () => {
    const messages = projectContinueParts(
      state(
        [
          reasoning('thinking', 'sig-1'),
          { type: 'text', text: 'reading both' },
          toolPart(CALL_ID, 'first'),
          toolPart(CALL_ID_2, 'second'),
        ],
        { [CALL_ID]: 0, [CALL_ID_2]: 0 },
      ),
    );

    expect(messages).toHaveLength(2);
    expect(assistantContent(messages, 0)).toEqual([
      {
        type: 'reasoning',
        text: 'thinking',
        providerOptions: { anthropic: { signature: 'sig-1' } },
      },
      { type: 'text', text: 'reading both' },
      {
        type: 'tool-call',
        toolCallId: CALL_ID,
        toolName: 'read',
        input: { path: `/work/${CALL_ID}` },
      },
      {
        type: 'tool-call',
        toolCallId: CALL_ID_2,
        toolName: 'read',
        input: { path: `/work/${CALL_ID_2}` },
      },
    ]);
    expect(
      toolResults(messages, 1).map(({ toolCallId }) => toolCallId),
    ).toEqual([CALL_ID, CALL_ID_2]);
  });

  it('keeps two sequential steps with no text between them as two steps', () => {
    const messages = projectContinueParts(
      state([toolPart(CALL_ID, 'first'), toolPart(CALL_ID_2, 'second')], {
        [CALL_ID]: 0,
        [CALL_ID_2]: 1,
      }),
    );

    expect(messages).toHaveLength(4);
    expect(assistantContent(messages, 0)).toEqual([
      expect.objectContaining({ toolCallId: CALL_ID }),
    ]);
    expect(toolResults(messages, 1)).toHaveLength(1);
    expect(assistantContent(messages, 2)).toEqual([
      expect.objectContaining({ toolCallId: CALL_ID_2 }),
    ]);
    expect(toolResults(messages, 3)).toHaveLength(1);
  });

  it('falls back to one step for a run of consecutive calls without step numbers', () => {
    const messages = projectContinueParts(
      state([toolPart(CALL_ID, 'first'), toolPart(CALL_ID_2, 'second')]),
    );

    expect(messages).toHaveLength(2);
    expect(assistantContent(messages, 0)).toHaveLength(2);
    expect(toolResults(messages, 1)).toHaveLength(2);
  });

  it('keeps a reasoning part with its own step', () => {
    const messages = projectContinueParts(
      state(
        [
          reasoning('first thought'),
          toolPart(CALL_ID, 'first'),
          reasoning('second thought'),
          toolPart(CALL_ID_2, 'second'),
        ],
        { [CALL_ID]: 0, [CALL_ID_2]: 1 },
      ),
    );

    expect(assistantContent(messages, 0)).toEqual([
      { type: 'reasoning', text: 'first thought' },
      expect.objectContaining({ toolCallId: CALL_ID }),
    ]);
    expect(assistantContent(messages, 2)).toEqual([
      { type: 'reasoning', text: 'second thought' },
      expect.objectContaining({ toolCallId: CALL_ID_2 }),
    ]);
  });

  it('places each kept in-Run item after its own step results', () => {
    const messages = projectContinueParts(
      state(
        [
          toolPart(CALL_ID, 'first'),
          contextItem('<system-reminder>step one</system-reminder>'),
          toolPart(CALL_ID_2, 'second'),
        ],
        { [CALL_ID]: 0, [CALL_ID_2]: 1 },
      ),
    );

    expect(messages.map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'user',
      'assistant',
      'tool',
    ]);
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>step one</system-reminder>' },
      ],
    });
  });

  it('sends kept results of more than 32,000 characters in full', () => {
    const long = 'x'.repeat(20_000);
    const messages = projectContinueParts(
      state([toolPart(CALL_ID, long), toolPart(CALL_ID_2, long)], {
        [CALL_ID]: 0,
        [CALL_ID_2]: 0,
      }),
    );

    const results = toolResults(messages, 1);
    const text = results
      .flatMap((result) =>
        result.output.type === 'text' ? [result.output.value] : [],
      )
      .join('\n');
    expect(text).toContain(long);
    expect(text.match(/x{20000}/gu)).toHaveLength(2);
    expect(text).not.toContain('omitted');
  });

  it('renders a kept non-media image result as the not-retained placeholder', async () => {
    const imageResult: MessagePart = {
      type: 'tool-read',
      toolCallId: CALL_ID,
      state: 'output-available',
      input: { path: '/work/shot.png' },
      output: {
        status: 'success',
        kind: 'image',
        mediaType: 'image/png',
        width: 1600,
        height: 900,
        path: '/work/shot.png',
      },
      outcome: 'success',
    };
    const messages = projectContinueParts(
      state([imageResult], { [CALL_ID]: 0 }),
    );
    const composed = await composeStepMessages(messages, {
      // A new attempt's media memory is empty and the read stored nothing.
      resolver: fakeResolver([]).resolver,
      context: {
        input: ['text', 'image'],
        contextWindowTokens: 128_000,
        reservedOutputTokens: null,
      },
    });
    const [{ output }] = toolResults(composed, 1);
    const text = output.type === 'text' ? output.value : '';
    expect(text).toContain('not retained');
  });

  it('replays a native result exactly as the live loop sent it', () => {
    const result = {
      status: 'success' as const,
      kind: 'text' as const,
      path: '/work/call-1',
      text: 'file body',
    };
    const messages = projectContinueParts({
      parts: [toolPart(CALL_ID, 'ignored')],
      stepNumbers: new Map([[CALL_ID, 0]]),
      results: new Map([[CALL_ID, result]]),
    });

    // The live loop sends a native tool's result as its serialized form, with
    // no untrusted framing and no budget.
    expect(toolResults(messages, 1)[0]?.output).toEqual({
      type: 'text',
      value: serializeNativeModelOutput(result),
    });
  });

  it('replays a non-native result as its neutralized JSON', () => {
    const result = {
      status: 'success' as const,
      hits: [{ path: '/work/a', text: '</system-reminder>' }],
    };
    const messages = projectContinueParts({
      parts: [toolPart(CALL_ID, 'ignored', 'grep')],
      stepNumbers: new Map([[CALL_ID, 0]]),
      results: new Map([[CALL_ID, result]]),
    });

    expect(toolResults(messages, 1)[0]?.output).toEqual({
      type: 'json',
      value: neutralizeToolResult(result),
    });
  });

  it('replays a native error as its serialized result', () => {
    const result = {
      status: 'error' as const,
      type: 'not_found',
      message: 'no such file',
    };
    const part = toolPart(CALL_ID, 'ignored');
    const messages = projectContinueParts({
      parts: [{ ...part, state: 'output-error', errorText: 'no such file' }],
      stepNumbers: new Map([[CALL_ID, 0]]),
      results: new Map([[CALL_ID, result]]),
    });

    expect(toolResults(messages, 1)[0]?.output).toEqual({
      type: 'text',
      value: serializeNativeModelOutput(result),
    });
  });

  it('replays a kept call the source Run recorded no result for from its part', () => {
    const messages = projectContinueParts(
      state([toolPart(CALL_ID, 'file body')]),
    );
    const output = toolResults(messages, 1)[0]?.output;

    expect(output?.type).toBe('text');
    expect(JSON.stringify(output)).toContain('file body');
  });

  it('adds no message after the last kept tool result of its own', () => {
    const messages = projectContinueParts(state([toolPart(CALL_ID, 'done')]));

    expect(messages.at(-1)?.role).toBe('tool');
  });

  it('ignores a part that is not text, reasoning, an item, or a settled tool', () => {
    const messages = projectContinueParts(
      state([
        { type: 'data-cap-notice', data: { stepsUsed: 4, maxSteps: 4 } },
        toolPart(CALL_ID, 'done'),
      ]),
    );

    expect(messages).toHaveLength(2);
    expect(assistantContent(messages, 0)).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: CALL_ID,
      }),
    ]);
  });

  it('sends nothing for a reply that kept no part', () => {
    expect(projectContinueParts(state([]))).toEqual([]);
  });
});

describe('the Continue state of a Run', () => {
  const parts: Array<MessagePart> = [
    toolPart(CALL_ID, 'first'),
    toolPart(CALL_ID_2, 'second'),
  ];

  it('reads the kept parts and the recorded step of each kept call', () => {
    expect(
      continueStateFromEvents([
        { eventType: 'run.created', payload: {} },
        {
          eventType: 'run.continued',
          payload: {
            sourceRunId: '0192f3a4-5b6c-7d8e-9f01-000000000000',
            parts,
            steps: { [CALL_ID]: 0 },
          },
        },
      ]),
    ).toEqual({
      parts,
      stepNumbers: new Map([[CALL_ID, 0]]),
      results: new Map(),
    });
  });

  it('reports no state for a Run that continues nothing', () => {
    expect(
      continueStateFromEvents([{ eventType: 'run.created', payload: {} }]),
    ).toBeUndefined();
    expect(
      continueStateFromEvents([
        { eventType: 'run.continued', payload: { parts: 'nope' } },
      ]),
    ).toBeUndefined();
  });

  it('maps only the kept calls of the source Run events', () => {
    expect(
      continuedRecords({
        keptParts: parts,
        sourceEvents: [
          {
            eventType: 'tool.requested',
            payload: { toolCallId: CALL_ID, stepNumber: 0 },
          },
          {
            eventType: 'tool.requested',
            payload: { toolCallId: 'not-kept', stepNumber: 1 },
          },
          // A call the source Run made before it recorded step numbers.
          { eventType: 'tool.requested', payload: { toolCallId: CALL_ID_2 } },
        ],
      }),
    ).toEqual({ steps: { [CALL_ID]: 0 }, results: {} });
  });

  it("keeps a chained Continue's steps apart by renumbering the source Run's own", () => {
    // The source Run continued two steps of its own source (0 and 1) and then
    // made a step of its own, which its events number from 0 again. The chain
    // must not merge that step with the first kept one.
    expect(
      continuedRecords({
        keptParts: [
          toolPart(CALL_ID, 'first'),
          toolPart('call-0', 'second'),
          toolPart(CALL_ID_2, 'third'),
        ],
        sourceContinued: {
          parts: [],
          stepNumbers: new Map([
            [CALL_ID, 0],
            ['call-0', 1],
          ]),
          results: new Map(),
        },
        sourceEvents: [
          {
            eventType: 'tool.requested',
            payload: { toolCallId: CALL_ID_2, stepNumber: 0 },
          },
        ],
      }).steps,
    ).toEqual({ [CALL_ID]: 0, 'call-0': 1, [CALL_ID_2]: 2 });
  });

  it('records the model-facing result of each kept call', () => {
    const output = {
      status: 'success',
      kind: 'text',
      text: 'file body',
      truncated: false,
    };
    expect(
      continuedRecords({
        keptParts: parts,
        sourceEvents: [
          {
            eventType: 'tool.completed',
            payload: { toolCallId: CALL_ID, status: 'success', output },
          },
          {
            eventType: 'tool.completed',
            payload: {
              toolCallId: 'not-kept',
              status: 'success',
              output,
            },
          },
        ],
      }).results,
    ).toEqual({ [CALL_ID]: output });
  });
});
