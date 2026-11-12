import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import {
  LIVE_CHAT_ID,
  LIVE_OWNER,
  liveChatRecord,
} from '../testing/live-records';
import { ChangeHubService } from './change-hub.service';
import { liveMessageSchema, type LiveMessage } from './generated/live-protocol';
import { type LiveRecordLoader } from './live-record-loader';

const hubs = new Set<ChangeHubService>();
const period = 50;
const grouped = (count: number) => new Map([[LIVE_CHAT_ID, count]]);

function fixture() {
  const state = { count: 1 };

  const runningJobs = vi
    .fn<LiveRecordLoader['runningJobs']>()
    .mockResolvedValue(grouped(1));

  const loader: LiveRecordLoader = {
    runningJobs,
    chat: vi.fn(() =>
      Promise.resolve(liveChatRecord({ runningJobs: state.count })),
    ),
    deliveries: vi.fn(() => Promise.resolve([])),
    machine: vi.fn(() => Promise.resolve(undefined)),
    project: vi.fn(() => Promise.resolve(undefined)),
    pins: vi.fn(() => Promise.resolve([])),
    run: vi.fn(() => Promise.resolve(undefined)),
  };

  const listener = {
    onListen: () => {},
    listen: vi.fn((_notify: (raw: string) => void, onListen: () => void) => {
      listener.onListen = onListen;
      onListen();

      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
  };

  const hub = new ChangeHubService(listener, loader, {
    config: {
      ...BUILT_IN_DEFAULTS,
      runs: { ...BUILT_IN_DEFAULTS.runs, heartbeatSeconds: period / 1000 },
    },
  });

  hubs.add(hub);
  const frames: Array<LiveMessage> = [];

  const subscribe = () =>
    hub.subscribe(LIVE_OWNER, (frame) => {
      const parsed: unknown = JSON.parse(frame);
      frames.push(liveMessageSchema.parse(parsed));
    });

  return { hub, listener, loader, runningJobs, state, frames, subscribe };
}

const counts = (frames: ReadonlyArray<LiveMessage>) =>
  frames.flatMap((frame) =>
    frame.type === 'chat.upserted' ? [frame.chat.runningJobs] : [],
  );

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());

afterEach(async () => {
  for (const hub of hubs) await hub.onModuleDestroy();
  hubs.clear();
  vi.useRealTimers();
});

describe('owner job projection refresh', () => {
  it('continues through lease expiry and revival, then stops after stored running rows disappear', async () => {
    const { state, runningJobs, frames, subscribe } = fixture();
    subscribe();
    await flush();
    expect(counts(frames)).toEqual([1]);

    state.count = 0;
    runningJobs.mockResolvedValue(grouped(0));
    await vi.advanceTimersByTimeAsync(period - 1);
    expect(counts(frames)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(counts(frames)).toEqual([1, 0]);

    state.count = 1;
    runningJobs.mockResolvedValue(grouped(1));
    await vi.advanceTimersByTimeAsync(period);
    expect(counts(frames)).toEqual([1, 0, 1]);

    runningJobs.mockResolvedValue(new Map());
    await vi.advanceTimersByTimeAsync(period);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pushes an initial zero when stored running jobs already have dead workers', async () => {
    const { state, runningJobs, frames, subscribe } = fixture();
    state.count = 0;
    runningJobs.mockResolvedValue(grouped(0));
    subscribe();
    await flush();
    expect(counts(frames)).toEqual([0]);
  });

  it('retains the heartbeat deadline when the grouped read takes part of the interval', async () => {
    const { state, runningJobs, frames, subscribe } = fixture();
    const first = Promise.withResolvers<Map<string, number>>();
    runningJobs.mockReturnValueOnce(first.promise);
    subscribe();
    await vi.advanceTimersByTimeAsync(30);
    first.resolve(grouped(1));
    await flush();
    expect(counts(frames)).toEqual([1]);

    state.count = 0;
    runningJobs.mockResolvedValue(grouped(0));
    await vi.advanceTimersByTimeAsync(period - 30 - 1);
    expect(counts(frames)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(counts(frames)).toEqual([1, 0]);
  });

  it('reseeds an additional device and reconnected devices from an unknown baseline', async () => {
    const { hub, listener, frames, subscribe } = fixture();
    await hub.onModuleInit();
    subscribe();
    await flush();
    const second: Array<LiveMessage> = [];
    hub.subscribe(LIVE_OWNER, (frame) => {
      const parsed: unknown = JSON.parse(frame);
      second.push(liveMessageSchema.parse(parsed));
    });
    await flush();
    expect(counts(second)).toEqual([1]);
    expect(counts(frames)).toEqual([1, 1]);

    listener.onListen();
    await flush();
    expect(second.map((frame) => frame.type)).toEqual([
      'chat.upserted',
      'resync',
      'chat.upserted',
    ]);
    expect(counts(second)).toEqual([1, 1]);
  });

  it('compares an expiring count with the full NOTIFY upsert, not the previous grouped sample', async () => {
    const { hub, state, frames, subscribe } = fixture();
    subscribe();
    await flush();
    expect(counts(frames)).toEqual([1]);

    state.count = 2;
    hub.dispatch(
      JSON.stringify({ k: 'chat_jobs', owner: LIVE_OWNER, chat: LIVE_CHAT_ID }),
    );
    await flush();
    expect(counts(frames)).toEqual([1, 2]);

    state.count = 1;
    await vi.advanceTimersByTimeAsync(period);
    expect(counts(frames)).toEqual([1, 2, 1]);
  });

  it('waits for an old read before resubscribing and sends only the replacement projection', async () => {
    const { runningJobs, frames, subscribe } = fixture();
    const old = Promise.withResolvers<Map<string, number>>();
    const replacement = Promise.withResolvers<Map<string, number>>();
    runningJobs
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(replacement.promise);
    const unsubscribe = subscribe();
    unsubscribe();
    subscribe();
    expect(runningJobs).toHaveBeenCalledTimes(1);

    old.resolve(grouped(0));
    await flush();
    expect(runningJobs).toHaveBeenCalledTimes(2);
    expect(frames).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    replacement.resolve(grouped(1));
    await flush();
    expect(counts(frames)).toEqual([1]);
  });

  it('coalesces additional subscriptions into one nonoverlapping replacement read', async () => {
    const { runningJobs, state, frames, subscribe } = fixture();
    const old = Promise.withResolvers<Map<string, number>>();
    const replacement = Promise.withResolvers<Map<string, number>>();
    runningJobs
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(replacement.promise);
    subscribe();
    subscribe();
    expect(runningJobs).toHaveBeenCalledTimes(1);

    old.resolve(grouped(1));
    await flush();
    expect(runningJobs).toHaveBeenCalledTimes(2);
    expect(frames).toEqual([]);

    state.count = 0;
    replacement.resolve(grouped(0));
    await flush();
    expect(counts(frames)).toEqual([0, 0]);
  });

  it('sends nothing and arms no timer when the last subscriber leaves during a read', async () => {
    const { runningJobs, frames, subscribe } = fixture();
    const pending = Promise.withResolvers<Map<string, number>>();
    runningJobs.mockReturnValueOnce(pending.promise);
    const unsubscribe = subscribe();
    unsubscribe();
    pending.resolve(grouped(1));
    await flush();
    expect(frames).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resets on reconnect without emitting a stale failure or overlapping reads', async () => {
    const { hub, listener, runningJobs, state, frames, subscribe } = fixture();
    const old = Promise.withResolvers<Map<string, number>>();
    const replacement = Promise.withResolvers<Map<string, number>>();
    runningJobs
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(replacement.promise);
    await hub.onModuleInit();
    subscribe();
    listener.onListen();
    expect(frames.map((frame) => frame.type)).toEqual(['resync']);
    expect(runningJobs).toHaveBeenCalledTimes(1);

    old.reject(new Error('stale database failure'));
    await flush();
    expect(frames.map((frame) => frame.type)).toEqual(['resync']);
    expect(runningJobs).toHaveBeenCalledTimes(2);

    state.count = 0;
    replacement.resolve(grouped(0));
    await flush();
    expect(frames.map((frame) => frame.type)).toEqual([
      'resync',
      'chat.upserted',
    ]);
    expect(counts(frames)).toEqual([0]);
  });

  it('resyncs on a current read failure and retries at the next period', async () => {
    const { runningJobs, frames, subscribe } = fixture();
    runningJobs.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_FAILURE'));
    subscribe();
    await flush();
    expect(frames).toEqual([{ type: 'resync' }]);
    expect(JSON.stringify(frames)).not.toContain('PRIVATE_DATABASE_FAILURE');

    await vi.advanceTimersByTimeAsync(period);
    expect(counts(frames)).toEqual([1]);
  });

  it('cannot enqueue or restart a refresh after shutdown releases an outstanding read', async () => {
    const { hub, runningJobs, frames, subscribe } = fixture();
    const pending = Promise.withResolvers<Map<string, number>>();
    runningJobs.mockReturnValueOnce(pending.promise);
    subscribe();
    await hub.onModuleDestroy();
    pending.resolve(grouped(1));
    await vi.advanceTimersByTimeAsync(period * 2);
    expect(frames).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
