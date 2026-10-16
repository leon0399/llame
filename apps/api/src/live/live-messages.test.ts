import type { RunStatus } from '../db/schema/chats';
import {
  parseChangeNotification,
  phaseOfEvent,
  recordJobFor,
  RunProgressTracker,
  type ChangeNotification,
} from './live-messages';
import type { LiveRecordLoader } from './live-record-loader';
import {
  liveChatRecord,
  livePinRecords,
  liveProjectRecord,
  liveRunRecord,
} from '../testing/live-records';

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

const runStatus = (status: RunStatus): ChangeNotification => ({
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
  const progress = (tracker: RunProgressTracker, n: ChangeNotification) => {
    const message = tracker.apply(n);
    return message && [message.phase, message.step];
  };

  it('folds run events into one message per phase or step change', () => {
    const tracker = new RunProgressTracker();
    expect(progress(tracker, runStatus('queued'))).toBeUndefined();
    expect(progress(tracker, runEvent('model.requested'))).toEqual([
      'thinking',
      1,
    ]);
    expect(progress(tracker, runEvent('reasoning.delta'))).toBeUndefined();
    expect(progress(tracker, runEvent('model.delta'))).toEqual(['writing', 1]);
    expect(progress(tracker, runEvent('model.delta'))).toBeUndefined();
    expect(progress(tracker, runEvent('tool.requested'))).toEqual(['tool', 1]);
    expect(progress(tracker, runEvent('tool.started'))).toBeUndefined();
    expect(progress(tracker, runEvent('native.result'))).toBeUndefined();
    expect(progress(tracker, runEvent('tool.completed'))).toEqual([
      'thinking',
      1,
    ]);
    expect(progress(tracker, runEvent('model.requested'))).toEqual([
      'thinking',
      2,
    ]);
  });

  it('carries the run and chat ids', () => {
    expect(new RunProgressTracker().apply(runEvent('tool.started'))).toEqual({
      type: 'run.progress',
      runId: run,
      chatId: chat,
      phase: 'tool',
      step: 0,
    });
  });

  it.each([
    ['a terminal run event', runEvent('run.completed')],
    ['a terminal status', runStatus('failed')],
  ])('forgets a Run after %s and ignores its stragglers', (_label, end) => {
    const tracker = new RunProgressTracker();
    tracker.apply(runEvent('model.delta'));
    expect(tracker.apply(end)).toBeUndefined();
    expect(tracker.apply(runEvent('tool.started'))).toBeUndefined();
    expect(tracker.apply(runEvent('model.requested'))).toBeUndefined();
  });

  it('ignores record notifications and non-terminal statuses', () => {
    const tracker = new RunProgressTracker();
    expect(
      tracker.apply({ k: 'chat', op: 'update', owner, chat }),
    ).toBeUndefined();
    expect(tracker.apply(runStatus('running_model'))).toBeUndefined();
    expect(tracker.apply(runEvent('model.delta'))).toMatchObject({
      phase: 'writing',
    });
  });
});

describe('recordJobFor', () => {
  const chatRecord = liveChatRecord();
  const projectRecord = liveProjectRecord({ id: chat });
  const runRecord = liveRunRecord();
  const pinRecords = livePinRecords();
  const loader: LiveRecordLoader = {
    chat: vi.fn((o: string, id: string) =>
      Promise.resolve(o === owner && id === chat ? chatRecord : undefined),
    ),
    project: vi.fn((o: string, id: string) =>
      Promise.resolve(o === owner && id === chat ? projectRecord : undefined),
    ),
    pins: vi.fn((o: string) => Promise.resolve(o === owner ? pinRecords : [])),
    run: vi.fn((o: string, id: string) =>
      Promise.resolve(o === owner && id === run ? runRecord : undefined),
    ),
  };
  const load = (n: ChangeNotification) => {
    const job = recordJobFor(n);
    if (!job) throw new Error('expected a job');
    return job.load(loader);
  };

  it('reads an upserted chat, project, or run as its owner', async () => {
    expect(await load({ k: 'chat', op: 'update', owner, chat })).toEqual({
      type: 'chat.upserted',
      chat: chatRecord,
    });
    expect(
      await load({ k: 'project', op: 'insert', owner, project: chat }),
    ).toEqual({ type: 'project.upserted', project: projectRecord });
    expect(await load(runStatus('running_model'))).toEqual({
      type: 'run.updated',
      run: runRecord,
    });
  });

  it('replaces the whole pin list on any pin change', async () => {
    expect(await load({ k: 'pin', op: 'delete', owner, item: chat })).toEqual({
      type: 'pins.replaced',
      items: pinRecords,
    });
  });

  it('sends nothing when the record is gone by the time it is read', async () => {
    expect(
      await load({ k: 'chat', op: 'update', owner, chat: run }),
    ).toBeUndefined();
    expect(
      await load({ k: 'project', op: 'update', owner, project: run }),
    ).toBeUndefined();
    expect(
      await load({
        k: 'run',
        op: 'update',
        owner,
        chat,
        run: chat,
        status: 'queued',
      }),
    ).toBeUndefined();
  });

  it('announces deletions without a read', async () => {
    expect(await load({ k: 'chat', op: 'delete', owner, chat })).toEqual({
      type: 'chat.deleted',
      chatId: chat,
    });
    expect(
      await load({ k: 'project', op: 'delete', owner, project: chat }),
    ).toEqual({ type: 'project.deleted', projectId: chat });
    expect(recordJobFor({ k: 'chat', op: 'delete', owner, chat })?.key).toBe(
      undefined,
    );
  });

  it('keys reads by record so they can be merged', () => {
    expect(recordJobFor({ k: 'chat', op: 'update', owner, chat })?.key).toBe(
      `chat:${chat}`,
    );
    expect(
      recordJobFor({ k: 'project', op: 'update', owner, project: chat })?.key,
    ).toBe(`project:${chat}`);
    expect(
      recordJobFor({ k: 'pin', op: 'insert', owner, item: chat })?.key,
    ).toBe('pins');
    expect(recordJobFor(runStatus('queued'))?.key).toBe(`run:${run}`);
    expect(recordJobFor(runEvent('model.delta'))).toBeUndefined();
  });
});
