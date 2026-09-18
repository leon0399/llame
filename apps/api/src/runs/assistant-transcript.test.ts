import {
  createAssistantPartCollector,
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

  it('stores opaque provider metadata on the part its adapter id names', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('first summary', 'rs_1:0');
    collector.reasoning('second summary', 'rs_1:1');
    // The Responses adapter ends an earlier summary of the same reasoning
    // item when the next one opens, so both ends can arrive after the later
    // part already collected text; the id decides the target part.
    collector.reasoning('', 'rs_1:0', { openai: { itemId: 'rs_1' } });
    collector.reasoning('', 'rs_1:1', {
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
    });

    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'first summary',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      },
      {
        type: 'reasoning',
        text: 'second summary',
        providerMetadata: {
          openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
        },
      },
    ]);
  });

  it('binds metadata without a part id to the open reasoning part', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('wire without ids');
    collector.reasoning('', undefined, { openai: { itemId: 'rs_1' } });

    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'wire without ids',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      },
    ]);
  });

  it('leaves a reasoning part without metadata exactly as it was', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('plain thinking', 'reasoning-0');
    collector.reasoning('', 'reasoning-0');
    // A metadata-only delivery with no part to bind it to adds no part.
    collector.reasoning('', 'rs_missing', { openai: { itemId: 'rs_missing' } });

    // `toStrictEqual` (not `toEqual`): an explicit `providerMetadata:
    // undefined` key would fail here, and the shape must be unchanged.
    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'plain thinking' },
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

  it('persists every reasoning part whole past the former persistence cap', () => {
    const collector = createAssistantPartCollector();
    // Both parts individually exceed the deleted 24,000-character cap.
    const first = 'x'.repeat(30_000);
    const second = 'y'.repeat(30_000);

    collector.reasoning(first, 'rs_1:0');
    collector.reasoning(second, 'rs_1:1');

    const parts = collector.parts();
    expect(parts).toEqual([
      { type: 'reasoning', text: first },
      { type: 'reasoning', text: second },
    ]);
    // No truncation marker: the persisted text is the text the provider
    // produced, byte for byte (D9/D11 — replay signs or encrypts it).
    expect(JSON.stringify(parts)).not.toContain('…');
  });
});

describe('toolActivityPart', () => {
  it('shapes successful tool results without adding error metadata', () => {
    const result: ToolResult = { status: 'success', value: 'ok' };

    expect(
      toolActivityPart({
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'q' },
        result,
      }),
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
      const part = toolActivityPart({
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'q' },
        result,
      });

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

  it('rebuilds reasoning part boundaries from the persisted adapter part ids', () => {
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: 'first ', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: 'summary', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: 'second', partId: 'rs_1:1' }),
      event('tool.requested', {
        toolCallId: 'c1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'c1',
        output: { status: 'success', value: 'found' },
      }),
      event('reasoning.delta', { text: 'after the tool', partId: 'rs_1:1' }),
      event('model.delta', { text: 'answer' }),
    ]);

    expect(result.collector.parts()).toEqual([
      { type: 'reasoning', text: 'first summary' },
      { type: 'reasoning', text: 'second' },
      expect.objectContaining({ type: 'tool-search', toolCallId: 'c1' }),
      { type: 'reasoning', text: 'after the tool' },
      { type: 'text', text: 'answer' },
    ]);
  });

  it('replays each reasoning part’s provider metadata onto its own part', () => {
    const earlierMetadata = { openai: { itemId: 'rs_1' } };
    const laterMetadata = {
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
    };
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: 'first summary', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: 'second summary', partId: 'rs_1:1' }),
      // The ends arrive after the later part already holds text; the id
      // routes each one to the part it belongs to.
      event('reasoning.delta', {
        partId: 'rs_1:0',
        providerMetadata: earlierMetadata,
      }),
      event('reasoning.delta', {
        partId: 'rs_1:1',
        providerMetadata: laterMetadata,
      }),
      // A malformed payload binds nothing and adds no part.
      event('reasoning.delta', {
        partId: 'rs_1:1',
        providerMetadata: 'not-a-record',
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'first summary',
        providerMetadata: earlierMetadata,
      },
      {
        type: 'reasoning',
        text: 'second summary',
        providerMetadata: laterMetadata,
      },
    ]);
  });

  it('merges legacy reasoning.delta events that carry no part id', () => {
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: 'one ' }),
      event('reasoning.delta', { text: 'thought' }),
      // Absent after a defined id is not a boundary either.
      event('reasoning.delta', { text: ' second', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: ' third' }),
    ]);

    expect(result.collector.parts()).toEqual([
      { type: 'reasoning', text: 'one thought second third' },
    ]);
  });

  it('replays a reasoning part longer than the former cap whole', () => {
    const long = 'z'.repeat(30_000);
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: long, partId: 'rs_1:0' }),
    ]);

    const parts = result.collector.parts();
    expect(parts).toEqual([{ type: 'reasoning', text: long }]);
    expect(JSON.stringify(parts)).not.toContain('…');
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

  it('carries safe permission metadata from request to stored part', () => {
    const permission = {
      policyId: 'policy-1',
      decision: 'reject' as const,
      reason: 'explicit_reject' as const,
      reference: { groupId: 'bash', list: 'reject' as const, clauseIndex: 0 },
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'git push' },
        permission,
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: {
          status: 'error',
          type: 'permission_denied',
          message: 'rejected',
        },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-bash',
        toolCallId: 'call-1',
        state: 'output-error',
        input: { command: 'git push' },
        errorText: 'rejected',
        outcome: 'permission_denied',
        permission,
      },
    ]);
  });

  it('ignores malformed permission metadata', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: {},
        permission: { policyId: 1, decision: 'maybe' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    expect([...result.openToolCalls.values()][0]?.permission).toBeUndefined();
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

describe('system-origin tool activity', () => {
  // Skill activation is llame's own read, not a call the model made. It is
  // recorded durably and excluded from the assistant transcript, so the model
  // never sees a fabricated call and the UI never replays one.
  const requested = (toolCallId: string) => ({
    toolCallId,
    toolName: 'read',
    input: { path: 'skill://pdf:raw' },
    origin: 'skill-activation',
  });

  it('produces no assistant part and no open call', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', requested('activation-1')),
      event('tool.completed', {
        toolCallId: 'activation-1',
        toolName: 'read',
        status: 'success',
        output: { status: 'success', content: 'instructions' },
        origin: 'skill-activation',
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    // Nothing left open either: a system-origin request must not become a
    // synthesized settlement on recovery.
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('leaves model-origin activity beside it untouched', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', requested('activation-1')),
      event('tool.completed', {
        toolCallId: 'activation-1',
        toolName: 'read',
        status: 'success',
        output: { status: 'success', content: 'instructions' },
        origin: 'skill-activation',
      }),
      event('tool.requested', {
        toolCallId: 'model-1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'model-1',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ toolCallId: 'model-1' }),
    ]);
  });

  it('treats activity without an origin as model-origin', () => {
    // Legacy events predate the discriminator and must keep replaying as the
    // model's own calls.
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'legacy-1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'legacy-1',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ toolCallId: 'legacy-1' }),
    ]);
  });

  it('ignores an unrecognized origin rather than trusting it', () => {
    // Only the shipped discriminator is system-origin; anything else is an
    // unknown value and stays model-origin rather than being silently treated
    // as llame's own activity.
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'other-1',
        toolName: 'search',
        input: { query: 'needle' },
        origin: 'some-other-caller',
      }),
      event('tool.completed', {
        toolCallId: 'other-1',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ toolCallId: 'other-1' }),
    ]);
  });
});
