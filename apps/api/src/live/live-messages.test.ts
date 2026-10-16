import {
  parseChangeNotification,
  phaseOfEvent,
  RunProgressTracker,
  type ChangeNotification,
} from './live-messages';

const owner = 'user-a';
const chat = '11111111-1111-4111-8111-111111111111';
const run = '22222222-2222-4222-8222-222222222222';

const runEvent = (type: string, seq = 1): ChangeNotification => ({
  k: 'run_event',
  op: 'insert',
  owner,
  chat,
  run,
  seq,
  type,
});

const runStatus = (status: string): ChangeNotification => ({
  k: 'run',
  op: 'update',
  owner,
  chat,
  run,
  status,
});

describe('parseChangeNotification', () => {
  it('parses each payload kind the trigger emits', () => {
    expect(
      parseChangeNotification(
        JSON.stringify({ k: 'chat', op: 'update', owner, chat }),
      ),
    ).toEqual({ k: 'chat', op: 'update', owner, chat });
    expect(
      parseChangeNotification(
        JSON.stringify({ k: 'project', op: 'delete', owner, project: chat }),
      ),
    ).toEqual({ k: 'project', op: 'delete', owner, project: chat });
    expect(
      parseChangeNotification(
        JSON.stringify({ k: 'pin', op: 'insert', owner, item: chat }),
      ),
    ).toEqual({ k: 'pin', op: 'insert', owner, item: chat });
    expect(
      parseChangeNotification(
        JSON.stringify({
          k: 'run',
          op: 'insert',
          owner,
          chat,
          run,
          status: 'queued',
        }),
      ),
    ).toEqual({ ...runStatus('queued'), op: 'insert' });
    expect(
      parseChangeNotification(
        JSON.stringify({
          k: 'run_event',
          op: 'insert',
          owner,
          chat,
          run,
          seq: 7,
          type: 'model.delta',
        }),
      ),
    ).toEqual(runEvent('model.delta', 7));
  });

  it.each([
    ['not json', '{'],
    ['not an object', '"chat"'],
    ['unknown kind', JSON.stringify({ k: 'user', op: 'insert', owner })],
    ['unknown op', JSON.stringify({ k: 'chat', op: 'truncate', owner, chat })],
    ['no owner', JSON.stringify({ k: 'chat', op: 'insert', chat })],
    [
      'empty owner',
      JSON.stringify({ k: 'chat', op: 'insert', owner: '', chat }),
    ],
    ['no record id', JSON.stringify({ k: 'chat', op: 'insert', owner })],
    [
      'non-numeric seq',
      JSON.stringify({
        k: 'run_event',
        op: 'insert',
        owner,
        chat,
        run,
        seq: '1',
        type: 'x',
      }),
    ],
    [
      'run without status',
      JSON.stringify({ k: 'run', op: 'insert', owner, chat, run }),
    ],
  ])('drops a payload with %s', (_label, raw) => {
    expect(parseChangeNotification(raw)).toBeUndefined();
  });
});

describe('phaseOfEvent', () => {
  it.each([
    ['model.requested', 'thinking'],
    ['reasoning.delta', 'thinking'],
    ['tool.completed', 'thinking'],
    ['model.delta', 'writing'],
    ['tool.requested', 'tool'],
    ['tool.started', 'tool'],
    ['model.completed', undefined],
    ['native.attempt', undefined],
  ])('maps %s to %s', (eventType, phase) => {
    expect(phaseOfEvent(eventType)).toBe(phase);
  });
});

describe('RunProgressTracker', () => {
  it('maps record changes to invalidation messages', () => {
    const tracker = new RunProgressTracker();
    expect(tracker.apply({ k: 'chat', op: 'insert', owner, chat })).toEqual({
      type: 'chat.changed',
      chatId: chat,
      change: 'created',
    });
    expect(
      tracker.apply({ k: 'project', op: 'delete', owner, project: chat }),
    ).toEqual({
      type: 'project.changed',
      projectId: chat,
      change: 'deleted',
    });
    expect(
      tracker.apply({ k: 'pin', op: 'update', owner, item: chat }),
    ).toEqual({
      type: 'pin.changed',
      itemId: chat,
    });
  });

  it('folds a Run lifecycle into one message per status, phase or step change', () => {
    const tracker = new RunProgressTracker();
    const progress = (n: ChangeNotification) => {
      const message = tracker.apply(n);
      return message?.type === 'run.progress'
        ? [message.status, message.phase, message.step]
        : message;
    };

    expect(progress({ ...runStatus('queued'), op: 'insert' })).toEqual([
      'queued',
      'queued',
      0,
    ]);
    expect(progress(runStatus('running_model'))).toEqual([
      'running_model',
      'queued',
      0,
    ]);
    expect(progress(runEvent('model.requested'))).toEqual([
      'running_model',
      'thinking',
      1,
    ]);
    expect(progress(runEvent('reasoning.delta'))).toBeUndefined();
    expect(progress(runEvent('model.delta'))).toEqual([
      'running_model',
      'writing',
      1,
    ]);
    expect(progress(runEvent('model.delta'))).toBeUndefined();
    expect(progress(runEvent('model.delta'))).toBeUndefined();
    expect(progress(runEvent('tool.requested'))).toEqual([
      'running_model',
      'tool',
      1,
    ]);
    expect(progress(runEvent('tool.started'))).toBeUndefined();
    expect(progress(runEvent('native.result'))).toBeUndefined();
    expect(progress(runEvent('tool.completed'))).toEqual([
      'running_model',
      'thinking',
      1,
    ]);
    expect(progress(runEvent('model.requested'))).toEqual([
      'running_model',
      'thinking',
      2,
    ]);
    expect(progress(runEvent('run.completed'))).toEqual([
      'completed',
      'finished',
      2,
    ]);
  });

  it('never resurrects a Run after its terminal message', () => {
    const tracker = new RunProgressTracker();
    tracker.apply(runEvent('model.delta'));
    expect(tracker.apply(runStatus('failed'))).toMatchObject({
      status: 'failed',
      phase: 'finished',
    });
    expect(tracker.apply(runEvent('run.failed'))).toBeUndefined();
    expect(tracker.apply(runEvent('model.delta'))).toBeUndefined();
    expect(tracker.apply(runStatus('failed'))).toBeUndefined();
  });

  it('treats a Run first seen through a progress event as executing', () => {
    const tracker = new RunProgressTracker();
    expect(tracker.apply(runEvent('tool.started'))).toEqual({
      type: 'run.progress',
      runId: run,
      chatId: chat,
      status: 'running_model',
      phase: 'tool',
      step: 0,
    });
  });
});
