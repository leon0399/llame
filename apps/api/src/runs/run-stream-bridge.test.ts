import { toolTerminationMessage } from './tool-settlement';
/**
 * Run-event → UI-chunk translator unit tests (#50) — pure state machine.
 */

import { parseJsonEventStream } from '@ai-sdk/provider-utils';
import {
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';

import { createRunEventTranslator } from './run-stream-bridge';

describe('createRunEventTranslator', () => {
  it('emits prelude lazily, then deltas, then text-end + finish on completion', () => {
    const t = createRunEventTranslator('run-1');

    expect(t.translate({ eventType: 'run.created', payload: null })).toEqual(
      [],
    );
    expect(t.translate({ eventType: 'run.started', payload: null })).toEqual(
      [],
    );
    expect(t.translate({ eventType: 'model.requested', payload: {} })).toEqual(
      [],
    );

    expect(
      t.translate({ eventType: 'model.delta', payload: { text: 'Hel' } }),
    ).toEqual([
      { type: 'start', messageId: 'run-1' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Hel' },
    ]);
    expect(
      t.translate({ eventType: 'model.delta', payload: { text: 'lo' } }),
    ).toEqual([{ type: 'text-delta', id: 'text-1', delta: 'lo' }]);

    expect(t.finished()).toBe(false);
    expect(t.translate({ eventType: 'run.completed', payload: null })).toEqual([
      { type: 'text-end', id: 'text-1' },
      { type: 'finish' },
    ]);
    expect(t.finished()).toBe(true);
  });

  it('a run that fails before any delta emits start + error only', () => {
    const t = createRunEventTranslator('run-2');

    expect(
      t.translate({
        eventType: 'run.failed',
        payload: { message: 'model exploded' },
      }),
    ).toEqual([
      { type: 'start', messageId: 'run-2' },
      { type: 'error', errorText: 'model exploded' },
    ]);
    expect(t.finished()).toBe(true);
  });

  it('a cancelled run closes any open text part and finishes', () => {
    const t = createRunEventTranslator('run-3');

    t.translate({ eventType: 'model.delta', payload: { text: 'partial' } });
    expect(t.translate({ eventType: 'run.cancelled', payload: null })).toEqual([
      { type: 'text-end', id: 'text-1' },
      { type: 'finish' },
    ]);
  });

  it('settles an in-flight tool call when the run is cancelled', () => {
    const t = createRunEventTranslator('run-3b');

    t.translate({
      eventType: 'tool.requested',
      payload: {
        toolCallId: 'c1',
        toolName: 'search_conversations',
        input: { query: 'budget' },
      },
    });
    t.translate({
      eventType: 'tool.started',
      payload: { toolCallId: 'c1', toolName: 'search_conversations' },
    });

    // The tool part is open ("running"). Terminating without settling it
    // leaves the UI spinning forever, so the terminal event must close it
    // before finishing.
    expect(t.translate({ eventType: 'run.cancelled', payload: null })).toEqual([
      {
        type: 'tool-output-error',
        toolCallId: 'c1',
        errorText: toolTerminationMessage('cancelled'),
        providerMetadata: { llame: { cancelled: true } },
        dynamic: true,
      },
      { type: 'finish' },
    ]);
  });

  it('survives the AI SDK transport parser and reconstructs a cancelled tool part', async () => {
    const t = createRunEventTranslator('run-transport');
    const chunks = [
      ...t.translate({
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'transport-call',
          toolName: 'search_conversations',
          input: { query: 'budget' },
        },
      }),
      ...t.translate({ eventType: 'run.cancelled', payload: null }),
    ];
    const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
    const parsed = parseJsonEventStream({
      stream: new Blob(body).stream(),
      schema: uiMessageChunkSchema,
    }).pipeThrough(
      new TransformStream<
        | { success: true; value: UIMessageChunk }
        | { success: false; error: Error },
        UIMessageChunk
      >({
        transform(result, controller) {
          if (!result.success) {
            throw result.error;
          }
          controller.enqueue(result.value);
        },
      }),
    );

    let reconstructed: UIMessage | undefined;
    for await (const message of readUIMessageStream({ stream: parsed })) {
      reconstructed = message;
    }

    expect(reconstructed?.parts).toContainEqual(
      expect.objectContaining({
        type: 'dynamic-tool',
        toolCallId: 'transport-call',
        state: 'output-error',
        resultProviderMetadata: { llame: { cancelled: true } },
      }),
    );
  });

  it.each([
    ['run.expired', toolTerminationMessage('expired')],
    ['run.failed', toolTerminationMessage('failed')],
  ] as const)(
    'settles an in-flight tool call on %s',
    (eventType, errorText) => {
      const t = createRunEventTranslator(`run-3c-${eventType}`);

      t.translate({
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'c9',
          toolName: 'search_conversations',
          input: { query: 'q' },
        },
      });

      expect(
        t.translate({ eventType, payload: { message: 'boom' } }),
      ).toContainEqual({
        type: 'tool-output-error',
        toolCallId: 'c9',
        errorText,
        providerMetadata: { llame: { cancelled: true } },
        dynamic: true,
      });
    },
  );

  it('does not settle a tool call that already completed', () => {
    const t = createRunEventTranslator('run-3d');

    t.translate({
      eventType: 'tool.requested',
      payload: {
        toolCallId: 'c2',
        toolName: 'search_conversations',
        input: {},
      },
    });
    t.translate({
      eventType: 'tool.completed',
      payload: {
        toolCallId: 'c2',
        toolName: 'search_conversations',
        status: 'success',
        output: { status: 'success' },
      },
    });

    // Already settled — the terminal event must not emit a second outcome.
    expect(t.translate({ eventType: 'run.cancelled', payload: null })).toEqual([
      { type: 'finish' },
    ]);
  });

  it('ignores a late tool.completed after the run already finished', () => {
    const t = createRunEventTranslator('run-3e');

    t.translate({
      eventType: 'tool.requested',
      payload: {
        toolCallId: 'c1',
        toolName: 'search_conversations',
        input: {},
      },
    });
    // Termination settles the call, then the run finishes.
    t.translate({
      eventType: 'tool.completed',
      payload: {
        toolCallId: 'c1',
        toolName: 'search_conversations',
        status: 'error',
        output: { status: 'error', type: 'cancelled', message: 'cancelled' },
      },
    });
    t.translate({ eventType: 'run.cancelled', payload: null });
    expect(t.finished()).toBe(true);

    // A tool that ignored cancellation completes afterwards. Its event must
    // not emit a second outcome for a call the viewer already saw settled.
    expect(
      t.translate({
        eventType: 'tool.completed',
        payload: {
          toolCallId: 'c1',
          toolName: 'search_conversations',
          status: 'success',
          output: { status: 'success', results: [] },
        },
      }),
    ).toEqual([]);
  });

  // 1.7 / 1.8 — the live view and a reload must agree. The translator owns the
  // live half and the part collector owns history; this pins that a call
  // settled by termination is reported by the live stream for every terminal
  // path, so neither surface can silently diverge from the other.
  it.each([
    ['run.cancelled', toolTerminationMessage('cancelled')],
    ['run.expired', toolTerminationMessage('expired')],
    ['run.failed', toolTerminationMessage('failed')],
  ] as const)(
    'reports a settled outcome on the live stream for %s',
    (eventType, errorText) => {
      const t = createRunEventTranslator(`parity-${eventType}`);

      t.translate({
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'c1',
          toolName: 'search_conversations',
          input: { query: 'q' },
        },
      });
      t.translate({
        eventType: 'tool.started',
        payload: { toolCallId: 'c1', toolName: 'search_conversations' },
      });

      const chunks = t.translate({ eventType, payload: { message: 'x' } });
      const outcome = chunks.filter(
        (c) => 'toolCallId' in c && c.toolCallId === 'c1',
      );

      // Exactly one outcome, and it names the terminal path — not a generic
      // failure, which is what an audit would need to tell them apart.
      expect(outcome).toEqual([
        {
          type: 'tool-output-error',
          toolCallId: 'c1',
          errorText,
          providerMetadata: { llame: { cancelled: true } },
          dynamic: true,
        },
      ]);
    },
  );

  it('ignores empty or malformed delta payloads', () => {
    const t = createRunEventTranslator('run-4');

    expect(
      t.translate({ eventType: 'model.delta', payload: { text: '' } }),
    ).toEqual([]);
    expect(t.translate({ eventType: 'model.delta', payload: null })).toEqual(
      [],
    );
  });

  it('translates reasoning then answer as ordered parts (reasoning closes before text)', () => {
    const t = createRunEventTranslator('run-6');

    expect(
      t.translate({
        eventType: 'reasoning.delta',
        payload: { text: 'let me think ' },
      }),
    ).toEqual([
      { type: 'start', messageId: 'run-6' },
      { type: 'reasoning-start', id: 'reasoning-1' },
      { type: 'reasoning-delta', id: 'reasoning-1', delta: 'let me think ' },
    ]);

    // A text delta closes the open reasoning part, then opens the answer part.
    expect(
      t.translate({
        eventType: 'model.delta',
        payload: { text: 'The answer.' },
      }),
    ).toEqual([
      { type: 'reasoning-end', id: 'reasoning-1' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'The answer.' },
    ]);

    expect(t.translate({ eventType: 'run.completed', payload: null })).toEqual([
      { type: 'text-end', id: 'text-1' },
      { type: 'finish' },
    ]);
  });

  it('opens a new UI reasoning part when reasoning.delta carries a new partId', () => {
    const t = createRunEventTranslator('run-summary');

    expect(
      t.translate({
        eventType: 'reasoning.delta',
        payload: { text: '**Investigating**', partId: 'rs_1:0' },
      }),
    ).toEqual([
      { type: 'start', messageId: 'run-summary' },
      { type: 'reasoning-start', id: 'rs_1:0' },
      { type: 'reasoning-delta', id: 'rs_1:0', delta: '**Investigating**' },
    ]);

    expect(
      t.translate({
        eventType: 'reasoning.delta',
        payload: { text: '**Inspecting**', partId: 'rs_1:1' },
      }),
    ).toEqual([
      { type: 'reasoning-end', id: 'rs_1:0' },
      { type: 'reasoning-start', id: 'rs_1:1' },
      { type: 'reasoning-delta', id: 'rs_1:1', delta: '**Inspecting**' },
    ]);
  });

  it('re-opens a fresh reasoning part after text (think → answer → think)', () => {
    const t = createRunEventTranslator('run-7');
    t.translate({ eventType: 'reasoning.delta', payload: { text: 'a' } }); // reasoning-1
    t.translate({ eventType: 'model.delta', payload: { text: 'b' } }); // closes r-1, opens text-1
    // reasoning again → closes text-1, opens reasoning-2 (distinct id).
    expect(
      t.translate({ eventType: 'reasoning.delta', payload: { text: 'c' } }),
    ).toEqual([
      { type: 'text-end', id: 'text-1' },
      { type: 'reasoning-start', id: 'reasoning-2' },
      { type: 'reasoning-delta', id: 'reasoning-2', delta: 'c' },
    ]);
  });

  it('a reasoning-only run closes the reasoning part on terminal', () => {
    const t = createRunEventTranslator('run-8');
    t.translate({
      eventType: 'reasoning.delta',
      payload: { text: 'thinking' },
    });
    expect(t.translate({ eventType: 'run.completed', payload: null })).toEqual([
      { type: 'reasoning-end', id: 'reasoning-1' },
      { type: 'finish' },
    ]);
  });

  it('translates a tool call between text into ordered parts (text → tool → text)', () => {
    const t = createRunEventTranslator('run-9');

    // Pre-tool text → text-1.
    expect(
      t.translate({
        eventType: 'model.delta',
        payload: { text: 'Let me check ' },
      }),
    ).toEqual([
      { type: 'start', messageId: 'run-9' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Let me check ' },
    ]);

    // tool.requested closes the open text part, then opens the tool part.
    expect(
      t.translate({
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'c1',
          toolName: 'search_conversations',
          input: { query: 'budget' },
        },
      }),
    ).toEqual([
      { type: 'text-end', id: 'text-1' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'search_conversations',
        input: { query: 'budget' },
        dynamic: true,
      },
    ]);

    // tool.started has no UI representation of its own (the part is
    // already "running" from tool-input-available above).
    expect(
      t.translate({
        eventType: 'tool.started',
        payload: { toolCallId: 'c1', toolName: 'search_conversations' },
      }),
    ).toEqual([]);

    // tool.completed → output, correlated by toolCallId.
    expect(
      t.translate({
        eventType: 'tool.completed',
        payload: {
          toolCallId: 'c1',
          toolName: 'search_conversations',
          status: 'success',
          output: { status: 'success', results: [] },
        },
      }),
    ).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'c1',
        output: { status: 'success', results: [] },
        dynamic: true,
      },
    ]);

    // Post-tool text is a NEW part (text-2), not merged into text-1.
    expect(
      t.translate({
        eventType: 'model.delta',
        payload: { text: 'It is time.' },
      }),
    ).toEqual([
      { type: 'text-start', id: 'text-2' },
      { type: 'text-delta', id: 'text-2', delta: 'It is time.' },
    ]);

    expect(t.translate({ eventType: 'run.completed', payload: null })).toEqual([
      { type: 'text-end', id: 'text-2' },
      { type: 'finish' },
    ]);
  });

  it('surfaces model.completed telemetry as a non-terminal message-metadata chunk, closing text early so run.completed does not double-close it', () => {
    const t = createRunEventTranslator('run-6');
    const telemetry = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0.0001,
      latencyMs: 900,
      modelId: 'system:openai:gpt-4o-mini',
      status: 'completed',
    };

    t.translate({ eventType: 'model.delta', payload: { text: 'Hi' } });
    expect(
      t.translate({
        eventType: 'model.completed',
        payload: { usage: {}, finishReason: 'stop', telemetry },
      }),
    ).toEqual([
      { type: 'text-end', id: 'text-1' },
      { type: 'message-metadata', messageMetadata: { usage: telemetry } },
    ]);
    expect(t.finished()).toBe(false);

    // run.completed's own text-end is a no-op — model.completed already closed it.
    expect(t.translate({ eventType: 'run.completed', payload: null })).toEqual([
      { type: 'finish' },
    ]);
    expect(t.finished()).toBe(true);
  });

  it('emits message-metadata with no text-end when no text ever started', () => {
    const t = createRunEventTranslator('run-7');
    const telemetry = {
      totalTokens: 0,
      modelId: 'system:openai:gpt-4o-mini',
      status: 'completed',
    };

    expect(
      t.translate({
        eventType: 'model.completed',
        payload: { usage: {}, finishReason: 'stop', telemetry },
      }),
    ).toEqual([
      { type: 'start', messageId: 'run-7' },
      { type: 'message-metadata', messageMetadata: { usage: telemetry } },
    ]);
    expect(t.finished()).toBe(false);
  });

  it('ignores a model.completed without telemetry (legacy events)', () => {
    const t = createRunEventTranslator('run-8');

    expect(
      t.translate({
        eventType: 'model.completed',
        payload: { usage: {}, finishReason: 'stop' },
      }),
    ).toEqual([]);
    expect(t.finished()).toBe(false);
  });

  it('a tool call before any text emits start + tool part (no dangling text-end)', () => {
    const t = createRunEventTranslator('run-10');

    expect(
      t.translate({
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'c9',
          toolName: 'search_conversations',
          input: {},
        },
      }),
    ).toEqual([
      { type: 'start', messageId: 'run-10' },
      {
        type: 'tool-input-available',
        toolCallId: 'c9',
        toolName: 'search_conversations',
        input: {},
        dynamic: true,
      },
    ]);
  });

  it('drops tool events missing their correlation id', () => {
    const t = createRunEventTranslator('run-11');
    expect(
      t.translate({ eventType: 'tool.requested', payload: { toolName: 'x' } }),
    ).toEqual([]);
    expect(
      t.translate({
        eventType: 'tool.completed',
        payload: { status: 'success' },
      }),
    ).toEqual([]);
  });

  it('a structured tool error maps to tool-output-error, not tool-output-available (so the live view shows an error, not "done")', () => {
    const t = createRunEventTranslator('run-12');
    t.translate({
      eventType: 'tool.requested',
      payload: {
        toolCallId: 'c2',
        toolName: 'search_conversations',
        input: {},
      },
    });
    expect(
      t.translate({
        eventType: 'tool.completed',
        payload: {
          toolCallId: 'c2',
          toolName: 'search_conversations',
          status: 'error',
          output: { status: 'error', type: 'timeout', message: 'timed out' },
        },
      }),
    ).toContainEqual({
      type: 'tool-output-error',
      toolCallId: 'c2',
      errorText: 'timed out',
      dynamic: true,
    });
  });

  it('a step-cap event emits a data-cap-notice chunk, closing any open text part first', () => {
    const t = createRunEventTranslator('run-13');
    t.translate({ eventType: 'model.delta', payload: { text: 'partial' } });
    expect(
      t.translate({
        eventType: 'run.step_cap_reached',
        payload: { stepsUsed: 8, maxSteps: 8 },
      }),
    ).toEqual([
      { type: 'text-end', id: 'text-1' },
      { type: 'data-cap-notice', data: { stepsUsed: 8, maxSteps: 8 } },
    ]);
  });

  it('drops a step-cap event missing its numeric fields', () => {
    const t = createRunEventTranslator('run-14');
    expect(
      t.translate({ eventType: 'run.step_cap_reached', payload: {} }),
    ).toEqual([]);
  });
});
