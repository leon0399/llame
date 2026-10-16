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

const runEvent = (type: string, runId = run): ChangeNotification => ({
  k: 'run_event',
  owner,
  chat,
  run: runId,
  type,
});

const runStatus = (status: RunStatus): ChangeNotification => ({
  k: 'run',
  owner,
  run,
  status,
});

describe('parseChangeNotification', () => {
  const parse = (payload: Record<string, string | boolean>) =>
    parseChangeNotification(JSON.stringify(payload));

  it('parses each payload kind the trigger emits', () => {
    expect(parse({ k: 'chat', owner, chat, deleted: false })).toEqual({
      k: 'chat',
      owner,
      chat,
      deleted: false,
    });
    expect(
      parse({ k: 'project', owner, project: chat, deleted: true }),
    ).toEqual({ k: 'project', owner, project: chat, deleted: true });
    expect(parse({ k: 'pin', owner })).toEqual({ k: 'pin', owner });
    expect(parse({ k: 'run', owner, run, status: 'queued' })).toEqual(
      runStatus('queued'),
    );
    expect(
      parse({ k: 'run_event', owner, chat, run, type: 'model.delta' }),
    ).toEqual(runEvent('model.delta'));
  });

  it.each([
    ['not json', '{'],
    ['not an object', '"chat"'],
    ['unknown kind', JSON.stringify({ k: 'user', owner })],
    ['no owner', JSON.stringify({ k: 'chat', chat, deleted: false })],
    [
      'empty owner',
      JSON.stringify({ k: 'chat', owner: '', chat, deleted: false }),
    ],
    ['no record id', JSON.stringify({ k: 'chat', owner, deleted: false })],
    ['no deleted flag', JSON.stringify({ k: 'chat', owner, chat })],
    [
      'a non-boolean deleted flag',
      JSON.stringify({ k: 'project', owner, project: chat, deleted: 'yes' }),
    ],
    ['run without status', JSON.stringify({ k: 'run', owner, run })],
    [
      'run with unknown status',
      JSON.stringify({ k: 'run', owner, run, status: 'x' }),
    ],
    [
      'run event without type',
      JSON.stringify({ k: 'run_event', owner, chat, run }),
    ],
    [
      'run event without chat',
      JSON.stringify({ k: 'run_event', owner, run, type: 'x' }),
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

  it('sends nothing for an event that sets neither phase nor step', () => {
    expect(
      new RunProgressTracker().apply(runEvent('native.result')),
    ).toBeUndefined();
  });

  it('remembers a bounded number of finished Runs', () => {
    const tracker = new RunProgressTracker();
    const finish = (id: string) => tracker.apply(runEvent('run.completed', id));
    const straggler = (id: string) =>
      tracker.apply(runEvent('tool.started', id));

    finish('run-0');
    finish('run-1');
    expect(straggler('run-0')).toBeUndefined();

    for (let i = 2; i <= 1024; i += 1) finish(`run-${i}`);
    // Past the cap the oldest memory is dropped: at worst one stale message.
    expect(straggler('run-0')).toMatchObject({ runId: 'run-0', phase: 'tool' });
    expect(straggler('run-1024')).toBeUndefined();
  });

  it('ignores record notifications and non-terminal statuses', () => {
    const tracker = new RunProgressTracker();
    expect(
      tracker.apply({ k: 'chat', owner, chat, deleted: false }),
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
    expect(await load({ k: 'chat', owner, chat, deleted: false })).toEqual({
      type: 'chat.upserted',
      chat: chatRecord,
    });
    expect(
      await load({ k: 'project', owner, project: chat, deleted: false }),
    ).toEqual({ type: 'project.upserted', project: projectRecord });
    expect(await load(runStatus('running_model'))).toEqual({
      type: 'run.updated',
      run: runRecord,
    });
  });

  it('replaces the whole pin list on any pin change', async () => {
    expect(await load({ k: 'pin', owner })).toEqual({
      type: 'pins.replaced',
      items: pinRecords,
    });
  });

  it('sends nothing when the record is gone by the time it is read', async () => {
    expect(
      await load({ k: 'chat', owner, chat: run, deleted: false }),
    ).toBeUndefined();
    expect(
      await load({ k: 'project', owner, project: run, deleted: false }),
    ).toBeUndefined();
    expect(
      await load({ k: 'run', owner, run: chat, status: 'queued' }),
    ).toBeUndefined();
  });

  it('announces deletions without a read', async () => {
    expect(await load({ k: 'chat', owner, chat, deleted: true })).toEqual({
      type: 'chat.deleted',
      chatId: chat,
    });
    expect(
      await load({ k: 'project', owner, project: chat, deleted: true }),
    ).toEqual({ type: 'project.deleted', projectId: chat });
    expect(recordJobFor({ k: 'chat', owner, chat, deleted: true })?.key).toBe(
      undefined,
    );
  });

  it('keys reads by record so they can be merged', () => {
    expect(recordJobFor({ k: 'chat', owner, chat, deleted: false })?.key).toBe(
      `chat:${chat}`,
    );
    expect(
      recordJobFor({ k: 'project', owner, project: chat, deleted: false })?.key,
    ).toBe(`project:${chat}`);
    expect(recordJobFor({ k: 'pin', owner })?.key).toBe('pins');
    expect(recordJobFor(runStatus('queued'))?.key).toBe(`run:${run}`);
    expect(recordJobFor(runEvent('model.delta'))).toBeUndefined();
  });
});
