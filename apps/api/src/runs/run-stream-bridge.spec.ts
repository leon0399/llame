/**
 * Run-event → UI-chunk translator unit tests (#50) — pure state machine.
 */

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

  it('treats legacy cancelled run.failed events as clean finishes', () => {
    const t = createRunEventTranslator('run-5');

    expect(
      t.translate({
        eventType: 'run.failed',
        payload: { status: 'cancelled', message: 'aborted' },
      }),
    ).toEqual([{ type: 'start', messageId: 'run-5' }, { type: 'finish' }]);
    expect(t.finished()).toBe(true);
  });

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

  it('surfaces model.completed telemetry as a non-terminal message-metadata chunk, closing text early so run.completed does not double-close it', () => {
    const t = createRunEventTranslator('run-6');
    const telemetry = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0.0001,
      latencyMs: 900,
      model: 'gpt-4o-mini',
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
      model: 'gpt-4o-mini',
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
});
