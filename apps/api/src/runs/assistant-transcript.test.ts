import {
  assistantParts,
  createAssistantPartCollector,
  REASONING_PERSIST_MAX,
  reconstructDurableAssistant,
  toolActivityPart,
  type ToolActivityPart,
} from './assistant-transcript';
import type { RunEvent } from '../db/schema';
import type { ToolResult } from '../tools/types';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const timestamp = new Date('2026-09-02T12:00:00.000Z');

// eslint-disable-next-line anti-slop/no-unknown-parameters -- test fixture intentionally feeds malformed and valid persisted payload shapes through the replay boundary.
function event(eventType: string, payload: unknown): RunEvent {
  return {
    sequence: 1,
    runId: RUN_ID,
    eventType,
    payload,
    createdAt: timestamp,
  };
}

function successToolPart(toolCallId: string): ToolActivityPart {
  return {
    type: 'tool-search',
    toolCallId,
    state: 'output-available',
    input: { query: 'needle' },
    output: { status: 'success', value: 'found' },
    outcome: 'success',
  };
}

function errorToolPart(
  toolCallId: string,
  errorText = 'failed',
  outcome = 'error',
): ToolActivityPart {
  return {
    type: 'tool-search',
    toolCallId,
    state: 'output-error',
    input: { query: 'needle' },
    errorText,
    outcome,
  };
}

describe('AssistantPartCollector', () => {
  it('ignores empty fragments and merges adjacent text/reasoning fragments', () => {
    const collector = createAssistantPartCollector();

    collector.text('');
    collector.text('hello ');
    collector.text('world');
    collector.reasoning('');
    collector.reasoning('think ');
    collector.reasoning('more');

    expect(collector.parts()).toEqual([
      { type: 'text', text: 'hello world' },
      { type: 'reasoning', text: 'think more' },
    ]);
  });

  it('filters unresolved requests but preserves an unrequested settlement', () => {
    const collector = createAssistantPartCollector();

    collector.toolRequested('pending');
    collector.tool(successToolPart('unrequested'));

    expect(collector.parts()).toEqual([successToolPart('unrequested')]);
  });

  it('keeps the first settlement and removes the pending index after replacement', () => {
    const collector = createAssistantPartCollector();
    const first = errorToolPart('call-1', 'cancelled', 'cancelled');

    collector.toolRequested('call-1');
    collector.tool(first);
    collector.tool(successToolPart('call-1'));

    expect(collector.parts()).toEqual([first]);
  });

  it('caps collector reasoning only above the persistence limit', () => {
    const collector = createAssistantPartCollector();
    const exact = 'e'.repeat(REASONING_PERSIST_MAX);
    const over = 'o'.repeat(REASONING_PERSIST_MAX + 1);

    collector.reasoning(exact);
    expect(collector.parts()).toEqual([{ type: 'reasoning', text: exact }]);
    collector.reasoning(over);

    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: `${exact}${over}`.slice(0, REASONING_PERSIST_MAX) + '…',
      },
    ]);
  });
});

describe('toolActivityPart', () => {
  it('shapes successful tool results without adding error metadata', () => {
    const result: ToolResult = { status: 'success', value: 'ok' };

    expect(
      toolActivityPart('call-1', 'search', { query: 'q' }, result),
    ).toEqual({
      type: 'tool-search',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'q' },
      output: result,
      outcome: 'success',
    });
  });

  it.each([
    [
      'cancelled',
      { status: 'error', type: 'cancelled', message: 'stopped' },
      'cancelled',
    ],
    [
      'unknown type',
      { status: 'error', type: 'custom', message: 'failed' },
      'custom',
    ],
    ['empty type', { status: 'error', type: '', message: 'failed' }, 'error'],
  ] as const)(
    'shapes %s errors with the normalized outcome',
    (_name, result, outcome) => {
      const part = toolActivityPart('call-1', 'search', { query: 'q' }, result);

      expect(part).toMatchObject({
        type: 'tool-search',
        toolCallId: 'call-1',
        state: 'output-error',
        input: { query: 'q' },
        errorText: result.message,
        outcome,
      });
      if (result.type === 'cancelled') {
        expect(part.resultProviderMetadata).toEqual({
          llame: { cancelled: true },
        });
      } else {
        expect(part.resultProviderMetadata).toBeUndefined();
      }
    },
  );
});

describe('reconstructDurableAssistant', () => {
  it('replays text, reasoning, cap notices, and unknown events in event order', () => {
    const result = reconstructDurableAssistant([
      event('model.delta', { text: 'answer ' }),
      event('model.delta', { text: 'text' }),
      event('reasoning.delta', { text: 'think' }),
      event('run.step_cap_reached', { stepsUsed: 4, maxSteps: 4 }),
      event('ignored.event', { text: 'not persisted' }),
      event('model.delta', null),
      event('reasoning.delta', { text: 3 }),
    ]);

    expect(result.collector.parts()).toEqual([
      { type: 'text', text: 'answer text' },
      { type: 'reasoning', text: 'think' },
      { type: 'data-cap-notice', data: { stepsUsed: 4, maxSteps: 4 } },
    ]);
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('reserves requested tools, correlates completions, and keeps occurrence order', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'first',
        toolName: 'search',
        input: { query: 'first' },
      }),
      event('tool.requested', {
        toolCallId: 'second',
        toolName: 'lookup',
        input: { query: 'second' },
      }),
      event('tool.completed', {
        toolCallId: 'second',
        output: { status: 'success', value: 'two' },
      }),
      event('tool.completed', {
        toolCallId: 'first',
        output: { status: 'error', type: 'cancelled', message: 'stopped' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'first',
        state: 'output-error',
        input: { query: 'first' },
        errorText: 'stopped',
        outcome: 'cancelled',
        resultProviderMetadata: { llame: { cancelled: true } },
      },
      {
        type: 'tool-lookup',
        toolCallId: 'second',
        state: 'output-available',
        input: { query: 'second' },
        output: { status: 'success', value: 'two' },
        outcome: 'success',
      },
    ]);
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('ignores malformed, duplicate, and orphaned tool events while exposing open calls', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', { toolCallId: '', toolName: 'search' }),
      event('tool.requested', { toolCallId: 'call-1', toolName: '' }),
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'search',
        input: 1,
      }),
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'search',
        input: 2,
      }),
      event('tool.completed', {
        toolCallId: 'orphan',
        output: { status: 'success' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'partial' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    expect(result.openToolCalls).toEqual(
      new Map([['call-1', { toolName: 'search', toolInput: 1 }]]),
    );
  });

  it('ignores duplicate completion and malformed step-cap payloads', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', { toolCallId: 'call-1', toolName: 'search' }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', value: 'done' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'error', type: 'late', message: 'late' },
      }),
      event('run.step_cap_reached', { stepsUsed: '4', maxSteps: 4 }),
      event('run.step_cap_reached', { stepsUsed: 4, maxSteps: 4 }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'call-1',
        state: 'output-available',
        input: undefined,
        output: { status: 'success', value: 'done' },
        outcome: 'success',
      },
      { type: 'data-cap-notice', data: { stepsUsed: 4, maxSteps: 4 } },
    ]);
  });
});

describe('assistantParts', () => {
  it('preserves optional cap notice and omits only an empty answer', () => {
    const tool = successToolPart('call-1');

    expect(
      assistantParts({
        reasoningText: '',
        toolParts: [tool],
        text: '',
        capNotice: {
          type: 'data-cap-notice',
          data: { stepsUsed: 8, maxSteps: 8 },
        },
      }),
    ).toEqual([
      tool,
      { type: 'data-cap-notice', data: { stepsUsed: 8, maxSteps: 8 } },
    ]);
  });
});
