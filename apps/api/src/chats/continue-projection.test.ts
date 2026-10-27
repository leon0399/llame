/**
 * The Continue projection (turn-actions D5/D6): the kept parts of a source
 * reply as the messages a Continue Run sends. A step is one model response —
 * its reasoning, its text, and all its calls — followed by one message with the
 * results; a kept in-Run item follows its step's results, and no budget applies.
 */

import type { AssistantContent, ModelMessage, ToolResultPart } from 'ai';

import { serializeNativeModelOutput } from '@workspace/native-file-tools';

import { asDouble } from '../testing/support';
import { isContextItemPart } from './context-item';
import { composeStepMessages } from '../models/step-composer';
import { neutralizeToolResult } from './tool-observation-neutralizer';
import { fakeResolver } from '../media/media-fixtures';
import type { MessagePart } from './context-builder';
import {
  continueStateFromEvents,
  continuedRecords,
  ownSnapshotParts,
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

  it('emits a step that holds only text as one assistant message', () => {
    const messages = projectContinueParts(
      state([{ type: 'text', text: 'an answer with no call' }]),
    );

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'an answer with no call' }],
      },
    ]);
  });

  it('emits a step that holds only reasoning, and one that holds only an item', () => {
    expect(
      projectContinueParts(
        state([{ type: 'reasoning', text: 'thinking only' }]),
      ),
    ).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'thinking only' }],
      },
    ]);
    expect(
      projectContinueParts(
        state([contextItem('<system-reminder>x</system-reminder>')]),
      ),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '<system-reminder>x</system-reminder>' },
        ],
      },
    ]);
  });

  it('joins the text parts of one step with a newline', () => {
    const messages = projectContinueParts(
      state([
        { type: 'text', text: 'first paragraph' },
        { type: 'text', text: 'second paragraph' },
        toolPart(CALL_ID, 'done'),
      ]),
    );

    expect(assistantContent(messages, 0)).toEqual([
      { type: 'text', text: 'first paragraph\nsecond paragraph' },
      expect.objectContaining({ type: 'tool-call', toolCallId: CALL_ID }),
    ]);
  });

  it('keeps a legacy step open across a call whose step the source Run did not number', () => {
    const messages = projectContinueParts(
      state([toolPart(CALL_ID, 'first'), toolPart(CALL_ID_2, 'second')], {
        [CALL_ID]: 0,
      }),
    );

    // The second call carries no step number, so it belongs to the open step.
    expect(messages).toHaveLength(2);
    expect(toolResults(messages, 1)).toHaveLength(2);
  });

  it('starts a step when a numbered call follows an unnumbered group', () => {
    const messages = projectContinueParts(
      state([toolPart('call-0', 'first'), toolPart(CALL_ID, 'second')], {
        [CALL_ID]: 0,
      }),
    );

    // The unnumbered call states no step, so the numbered one opens its own.
    expect(messages.map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
  });

  it('keeps a numbered call after an unnumbered one that followed a numbered step', () => {
    const messages = projectContinueParts(
      state(
        [
          toolPart(CALL_ID, 'first'),
          toolPart('call-middle', 'middle'),
          toolPart(CALL_ID_2, 'third'),
        ],
        { [CALL_ID]: 0, [CALL_ID_2]: 0 },
      ),
    );

    // The unnumbered middle call neither closes the step nor erases the step
    // number the open one recorded, so the third call joins the same step.
    expect(messages).toHaveLength(2);
    expect(toolResults(messages, 1)).toHaveLength(3);
  });

  it('starts a new step when a legacy call follows an item', () => {
    const messages = projectContinueParts(
      state([
        toolPart(CALL_ID, 'first'),
        contextItem('<system-reminder>step one</system-reminder>'),
        toolPart(CALL_ID_2, 'second'),
      ]),
    );

    expect(messages.map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'user',
      'assistant',
      'tool',
    ]);
  });

  it('keeps an item with no text out of the request', () => {
    const messages = projectContinueParts(
      state([toolPart(CALL_ID, 'done'), contextItem('')]),
    );

    // An item with no model-facing text would be an empty user message.
    expect(messages.map(({ role }) => role)).toEqual(['assistant', 'tool']);
  });

  it('reads no call id from a part that is not an object', () => {
    // The kept parts are the reply's stored jsonb, which a malformed writer can
    // leave holding anything.
    const keptParts = asDouble<ReadonlyArray<MessagePart>>([
      null,
      { type: 'reasoning', text: 'thinking' },
    ]);
    const records = continuedRecords({ keptParts, sourceEvents: [] });

    expect(records).toEqual({ steps: {}, results: {} });
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

  it('re-reads a recorded error result with its refused locator', () => {
    const state = continueStateFromEvents([
      {
        eventType: 'run.continued',
        payload: {
          parts,
          steps: {},
          results: {
            [CALL_ID]: {
              status: 'error',
              type: 'permission_denied',
              message: 'the target was refused',
              rejectedUrl: 'https://elsewhere.example/x',
              permission: { ignored: true },
            },
            // Unreadable entries contribute nothing.
            [CALL_ID_2]: { status: 'error', message: 7 },
          },
        },
      },
    ]);

    expect(state?.results.get(CALL_ID)).toEqual({
      status: 'error',
      type: 'permission_denied',
      message: 'the target was refused',
      rejectedUrl: 'https://elsewhere.example/x',
    });
    expect(state?.results.has(CALL_ID_2)).toBe(false);
  });

  it('ignores a result or a step recorded on another event type', () => {
    const records = continuedRecords({
      keptParts: parts,
      sourceEvents: [
        {
          eventType: 'model.delta',
          payload: { toolCallId: CALL_ID, stepNumber: 3 },
        },
        {
          eventType: 'run.failed',
          payload: { toolCallId: CALL_ID, output: { status: 'success' } },
        },
      ],
    });

    expect(records).toEqual({ steps: {}, results: {} });
  });

  it('drops a chained step of a call the boundary kept nothing of', () => {
    expect(
      continuedRecords({
        keptParts: parts,
        sourceContinued: {
          parts: [],
          stepNumbers: new Map([
            [CALL_ID, 0],
            ['not-kept', 1],
          ]),
          results: new Map(),
        },
        sourceEvents: [],
      }).steps,
    ).toEqual({ [CALL_ID]: 0 });
  });

  it('offsets two of the source Run own steps after its chain', () => {
    expect(
      continuedRecords({
        keptParts: [
          toolPart(CALL_ID, 'chained'),
          toolPart('call-own-1', 'own first'),
          toolPart('call-own-2', 'own second'),
        ],
        sourceContinued: {
          parts: [],
          stepNumbers: new Map([[CALL_ID, 2]]),
          results: new Map(),
        },
        sourceEvents: [
          {
            eventType: 'tool.requested',
            payload: { toolCallId: 'call-own-1', stepNumber: 0 },
          },
          {
            eventType: 'tool.requested',
            payload: { toolCallId: 'call-own-2', stepNumber: 1 },
          },
        ],
      }).steps,
    ).toEqual({ [CALL_ID]: 2, 'call-own-1': 3, 'call-own-2': 4 });
  });

  it('carries the results a chained Continue inherited from its own source', () => {
    const inherited = {
      status: 'success' as const,
      kind: 'text' as const,
      path: '/work/a',
      text: 'inherited body',
    };
    const own = { status: 'success' as const, text: 'own body' };

    const records = continuedRecords({
      keptParts: [toolPart(CALL_ID, 'stored'), toolPart(CALL_ID_2, 'stored')],
      sourceContinued: {
        parts: [],
        stepNumbers: new Map([[CALL_ID, 0]]),
        // The inherited call's result lives only here: the source Run never
        // completed it itself.
        results: new Map([[CALL_ID, inherited]]),
      },
      sourceEvents: [
        {
          eventType: 'tool.completed',
          payload: { toolCallId: CALL_ID_2, status: 'success', output: own },
        },
      ],
    });

    expect(records.results).toEqual({
      [CALL_ID]: inherited,
      [CALL_ID_2]: own,
    });
  });

  it('drops an inherited result the boundary kept nothing of', () => {
    expect(
      continuedRecords({
        keptParts: [toolPart(CALL_ID, 'stored')],
        sourceContinued: {
          parts: [],
          stepNumbers: new Map([[CALL_ID, 0]]),
          results: new Map([
            [CALL_ID, { status: 'success' as const, text: 'kept' }],
            ['not-kept', { status: 'success' as const, text: 'dropped' }],
          ]),
        },
        sourceEvents: [],
      }).results,
    ).toEqual({ [CALL_ID]: { status: 'success', text: 'kept' } });
  });

  it('lets the source Run own completion win over an inherited result', () => {
    expect(
      continuedRecords({
        keptParts: [toolPart(CALL_ID, 'stored')],
        sourceContinued: {
          parts: [],
          stepNumbers: new Map(),
          results: new Map([
            [CALL_ID, { status: 'success' as const, text: 'stale' }],
          ]),
        },
        sourceEvents: [
          {
            eventType: 'tool.completed',
            payload: {
              toolCallId: CALL_ID,
              status: 'success',
              output: { status: 'success', text: 'fresh' },
            },
          },
        ],
      }).results,
    ).toEqual({ [CALL_ID]: { status: 'success', text: 'fresh' } });
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

describe('the snapshot parts a Continue rebuild owns', () => {
  it("keeps every non-item part and only this Run's items", () => {
    const ownRunId = '0192f3a4-5b6c-7d8e-9f01-00000000000a';
    const foreignItem = contextItem('foreign');
    const own = contextItem('own');
    if (!isContextItemPart(own)) throw new TypeError('expected an item');
    const ownItem = { ...own, data: { ...own.data, runId: ownRunId } };

    expect(
      ownSnapshotParts(
        [toolPart(CALL_ID, 'done'), foreignItem, ownItem],
        ownRunId,
      ),
    ).toEqual([toolPart(CALL_ID, 'done'), ownItem]);
  });
});
