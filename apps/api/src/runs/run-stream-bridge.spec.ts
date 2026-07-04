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
});
