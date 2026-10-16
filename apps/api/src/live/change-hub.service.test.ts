import { ChangeHubService, toWireMessage } from './change-hub.service';
import type { LiveMessage } from './live-messages';
import type { LiveRecordLoader } from './live-record-loader';
import {
  LIVE_CHAT_ID,
  LIVE_OWNER,
  LIVE_RUN_ID,
  liveChatRecord,
  livePinRecords,
  liveRunRecord,
} from '../testing/live-records';

const config = {
  get: () => undefined,
  getOrThrow: () => {
    throw new Error('no database in unit tests');
  },
};

function makeLoader(overrides: Partial<LiveRecordLoader> = {}) {
  return {
    chat: vi.fn(() => Promise.resolve(liveChatRecord())),
    project: vi.fn(() => Promise.resolve(undefined)),
    pins: vi.fn(() => Promise.resolve(livePinRecords())),
    run: vi.fn(() => Promise.resolve(liveRunRecord())),
    ...overrides,
  } satisfies LiveRecordLoader;
}

function notify(payload: Record<string, string | number>): string {
  return JSON.stringify({ owner: LIVE_OWNER, ...payload });
}

const chatUpdate = notify({ k: 'chat', op: 'update', chat: LIVE_CHAT_ID });

function connect(hub: ChangeHubService, owner = LIVE_OWNER) {
  const received: Array<LiveMessage> = [];
  const unsubscribe = hub.subscribe(owner, (message) => received.push(message));
  return { received, unsubscribe };
}

describe('ChangeHubService', () => {
  it('reads a changed record as its owner and sends it in wire form', async () => {
    const loader = makeLoader();
    const hub = new ChangeHubService(config, loader);
    const { received } = connect(hub);

    hub.dispatch(chatUpdate);

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(loader.chat).toHaveBeenCalledWith(LIVE_OWNER, LIVE_CHAT_ID);
    expect(received[0]).toEqual({
      type: 'chat.upserted',
      chat: {
        id: LIVE_CHAT_ID,
        ownerUserId: LIVE_OWNER,
        title: 'Live chat',
        visibility: 'private',
        createdAt: '2026-10-16T12:00:00.000Z',
        updatedAt: '2026-10-16T12:00:00.000Z',
        archivedAt: null,
        projectId: null,
        workspaceRoot: null,
        lastMessage: 'hello',
      },
    });
  });

  it('reads nothing for an owner without connections', async () => {
    const loader = makeLoader();
    const hub = new ChangeHubService(config, loader);
    connect(hub, 'someone-else');

    hub.dispatch(chatUpdate);
    hub.dispatch(notify({ k: 'pin', op: 'insert', item: LIVE_CHAT_ID }));
    await Promise.resolve();

    expect(loader.chat).not.toHaveBeenCalled();
    expect(loader.pins).not.toHaveBeenCalled();
  });

  it('merges notifications for a record whose read has not started', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loader = makeLoader({
      run: vi.fn(() => gate.then(() => liveRunRecord())),
    });
    const hub = new ChangeHubService(config, loader);
    const { received } = connect(hub);
    const runChange = notify({
      k: 'run',
      op: 'update',
      chat: LIVE_CHAT_ID,
      run: LIVE_RUN_ID,
      status: 'running_model',
    });

    hub.dispatch(runChange); // starts reading
    hub.dispatch(chatUpdate); // queued
    hub.dispatch(chatUpdate); // merged into the queued read
    hub.dispatch(runChange); // queued again: the first read already started
    release();

    await vi.waitFor(() => expect(received).toHaveLength(3));
    expect(received.map((m) => m.type)).toEqual([
      'run.updated',
      'chat.upserted',
      'run.updated',
    ]);
    expect(loader.chat).toHaveBeenCalledTimes(1);
    expect(loader.run).toHaveBeenCalledTimes(2);
  });

  it('keeps a deletion after the reads queued before it', async () => {
    const hub = new ChangeHubService(config, makeLoader());
    const { received } = connect(hub);

    hub.dispatch(chatUpdate);
    hub.dispatch(notify({ k: 'chat', op: 'delete', chat: LIVE_CHAT_ID }));

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map((m) => m.type)).toEqual([
      'chat.upserted',
      'chat.deleted',
    ]);
  });

  it('sends nothing for a record deleted before its read', async () => {
    const hub = new ChangeHubService(
      config,
      makeLoader({ chat: vi.fn(() => Promise.resolve(undefined)) }),
    );
    const { received } = connect(hub);

    hub.dispatch(chatUpdate);
    hub.dispatch(notify({ k: 'pin', op: 'delete', item: LIVE_CHAT_ID }));

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.type).toBe('pins.replaced');
  });

  it('asks the owner to resync when a read fails, and keeps going', async () => {
    const hub = new ChangeHubService(
      config,
      makeLoader({
        chat: vi.fn(() => Promise.reject(new Error('database unavailable'))),
      }),
    );
    const { received } = connect(hub);

    hub.dispatch(chatUpdate);
    hub.dispatch(notify({ k: 'pin', op: 'insert', item: LIVE_CHAT_ID }));

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map((m) => m.type)).toEqual(['resync', 'pins.replaced']);
  });

  it('sends run progress without a read, even before any record', () => {
    const loader = makeLoader();
    const hub = new ChangeHubService(config, loader);
    const { received } = connect(hub);

    hub.dispatch(
      notify({
        k: 'run_event',
        op: 'insert',
        chat: LIVE_CHAT_ID,
        run: LIVE_RUN_ID,
        seq: 1,
        type: 'model.delta',
      }),
    );

    expect(received).toEqual([
      {
        type: 'run.progress',
        runId: LIVE_RUN_ID,
        chatId: LIVE_CHAT_ID,
        phase: 'writing',
        step: 0,
      },
    ]);
    expect(loader.run).not.toHaveBeenCalled();
  });

  it('drops a malformed notification and stops delivering after unsubscribe', async () => {
    const loader = makeLoader();
    const hub = new ChangeHubService(config, loader);
    const { received, unsubscribe } = connect(hub);

    hub.dispatch('{not json');
    hub.dispatch(
      JSON.stringify({ k: 'chat', op: 'update', chat: LIVE_CHAT_ID }),
    );
    unsubscribe();
    hub.dispatch(chatUpdate);
    await Promise.resolve();

    expect(received).toEqual([]);
    expect(loader.chat).not.toHaveBeenCalled();
  });

  it('isolates a subscriber that throws from the others', async () => {
    const hub = new ChangeHubService(config, makeLoader());
    hub.subscribe(LIVE_OWNER, () => {
      throw new Error('socket gone');
    });
    const { received } = connect(hub);

    hub.dispatch(chatUpdate);

    await vi.waitFor(() => expect(received).toHaveLength(1));
  });
});

describe('toWireMessage', () => {
  it('serializes dates and accepts a record the document describes', () => {
    expect(
      toWireMessage({ type: 'run.updated', run: liveRunRecord() }),
    ).toMatchObject({
      type: 'run.updated',
      run: { createdAt: '2026-10-16T12:00:00.000Z', finishedAt: null },
    });
  });

  it('rejects a record that violates the document', () => {
    expect(
      toWireMessage({
        type: 'chat.upserted',
        chat: liveChatRecord({ id: 'not-a-uuid' }),
      }),
    ).toBeUndefined();
  });
});
