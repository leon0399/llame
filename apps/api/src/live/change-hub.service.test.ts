import { Logger } from '@nestjs/common';

import { ChangeHubService, toWireMessage } from './change-hub.service';
import { liveMessageSchema } from './generated/live-protocol';
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

/** A listener that records the hub's callbacks so tests can drive them. */
function makeListener() {
  const listener = {
    onNotify: (_raw: string) => {},
    onListen: () => {},
    listen: vi.fn((onNotify: (raw: string) => void, onListen: () => void) => {
      listener.onNotify = onNotify;
      listener.onListen = onListen;
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  return listener;
}

function makeLoader(overrides: Partial<LiveRecordLoader> = {}) {
  return {
    chat: vi.fn(() => Promise.resolve(liveChatRecord())),
    project: vi.fn(() => Promise.resolve(undefined)),
    pins: vi.fn(() => Promise.resolve(livePinRecords())),
    run: vi.fn(() => Promise.resolve(liveRunRecord())),
    ...overrides,
  } satisfies LiveRecordLoader;
}

function notify(payload: Record<string, string | boolean>): string {
  return JSON.stringify({ owner: LIVE_OWNER, ...payload });
}

const chatUpdate = notify({ k: 'chat', chat: LIVE_CHAT_ID, deleted: false });

function connect(hub: ChangeHubService, owner = LIVE_OWNER) {
  const received: Array<LiveMessage> = [];
  const frames: Array<string> = [];
  const unsubscribe = hub.subscribe(owner, (frame) => {
    frames.push(frame);
    const parsed: unknown = JSON.parse(frame);
    received.push(liveMessageSchema.parse(parsed));
  });
  return { received, frames, unsubscribe };
}

describe('ChangeHubService', () => {
  it('reads a changed record as its owner and sends it in wire form', async () => {
    const loader = makeLoader();
    const hub = new ChangeHubService(makeListener(), loader);
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
    const hub = new ChangeHubService(makeListener(), loader);
    connect(hub, 'someone-else');

    hub.dispatch(chatUpdate);
    hub.dispatch(notify({ k: 'pin' }));
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
    const hub = new ChangeHubService(makeListener(), loader);
    const { received } = connect(hub);
    const runChange = notify({
      k: 'run',
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
    const hub = new ChangeHubService(makeListener(), makeLoader());
    const { received } = connect(hub);

    hub.dispatch(chatUpdate);
    hub.dispatch(notify({ k: 'chat', chat: LIVE_CHAT_ID, deleted: true }));

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map((m) => m.type)).toEqual([
      'chat.upserted',
      'chat.deleted',
    ]);
  });

  it('sends nothing for a record deleted before its read', async () => {
    const hub = new ChangeHubService(
      makeListener(),
      makeLoader({ chat: vi.fn(() => Promise.resolve(undefined)) }),
    );
    const { received } = connect(hub);

    hub.dispatch(chatUpdate);
    hub.dispatch(notify({ k: 'pin' }));

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.type).toBe('pins.replaced');
  });

  it('asks the owner to resync when a read fails, and keeps going', async () => {
    const hub = new ChangeHubService(
      makeListener(),
      makeLoader({
        chat: vi.fn(() => Promise.reject(new Error('database unavailable'))),
      }),
    );
    const { received } = connect(hub);

    hub.dispatch(chatUpdate);
    hub.dispatch(notify({ k: 'pin' }));

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map((m) => m.type)).toEqual(['resync', 'pins.replaced']);
  });

  it('sends run progress without a read, even before any record', () => {
    const loader = makeLoader();
    const hub = new ChangeHubService(makeListener(), loader);
    const { received } = connect(hub);

    hub.dispatch(
      notify({
        k: 'run_event',
        chat: LIVE_CHAT_ID,
        run: LIVE_RUN_ID,
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
    const hub = new ChangeHubService(makeListener(), loader);
    const { received, unsubscribe } = connect(hub);

    hub.dispatch('{not json');
    hub.dispatch(
      JSON.stringify({ k: 'chat', chat: LIVE_CHAT_ID, deleted: false }),
    );
    unsubscribe();
    hub.dispatch(chatUpdate);
    await Promise.resolve();

    expect(received).toEqual([]);
    expect(loader.chat).not.toHaveBeenCalled();
  });

  it('serializes a message once and sends the same frame to every socket', async () => {
    const hub = new ChangeHubService(makeListener(), makeLoader());
    const first = connect(hub);
    const second = connect(hub);

    hub.dispatch(chatUpdate);

    await vi.waitFor(() => expect(second.frames).toHaveLength(1));
    expect(first.frames[0]).toBe(second.frames[0]);
  });

  it('isolates a subscriber that throws from the others', async () => {
    const hub = new ChangeHubService(makeListener(), makeLoader());
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

describe('ChangeHubService listener lifecycle', () => {
  it('listens on init, asks owners to resync after a reconnect, and closes on destroy', async () => {
    const listener = makeListener();
    const hub = new ChangeHubService(listener, makeLoader());
    await hub.onModuleInit();
    const { received } = connect(hub);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    listener.onListen(); // first connect
    expect(received).toEqual([]);
    listener.onListen(); // reconnect
    expect(received).toEqual([{ type: 'resync' }]);
    expect(warn).toHaveBeenCalledWith(
      'Live change listener reconnected; requesting resync',
    );

    listener.onNotify(chatUpdate);
    await vi.waitFor(() => expect(received).toHaveLength(2));

    await hub.onModuleDestroy();
    expect(listener.close).toHaveBeenCalledTimes(1);
    listener.onNotify(chatUpdate);
    await Promise.resolve();
    expect(received).toHaveLength(2);
    warn.mockRestore();
  });
});

describe('ChangeHubService diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs a malformed notification', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    new ChangeHubService(makeListener(), makeLoader()).dispatch('{');
    expect(warn).toHaveBeenCalledWith(
      'Dropped malformed live change notification',
    );
  });

  it('logs a failed read with its cause', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const hub = new ChangeHubService(
      makeListener(),
      makeLoader({
        chat: vi.fn(() => Promise.reject(new Error('database unavailable'))),
      }),
    );
    connect(hub);
    hub.dispatch(chatUpdate);
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        'Live record read failed; requesting resync: database unavailable',
      ),
    );
  });

  it('logs a failing subscriber with its cause', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const hub = new ChangeHubService(makeListener(), makeLoader());
    hub.subscribe(LIVE_OWNER, () => {
      throw new Error('socket gone');
    });
    hub.dispatch(chatUpdate);
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Live subscriber failed: socket gone'),
    );
  });

  it('drops a message that violates the document and requests a resync', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const hub = new ChangeHubService(
      makeListener(),
      makeLoader({
        chat: vi.fn(() =>
          Promise.resolve(liveChatRecord({ id: 'not-a-uuid' })),
        ),
      }),
    );
    const { received } = connect(hub);
    hub.dispatch(chatUpdate);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(error).toHaveBeenCalledWith(
      'Dropped a chat.upserted message that violates asyncapi.yaml',
    );
    expect(received).toEqual([{ type: 'resync' }]);
  });

  it('keeps delivering to the remaining socket after another unsubscribes', async () => {
    const hub = new ChangeHubService(makeListener(), makeLoader());
    const first = connect(hub);
    const second = connect(hub);
    first.unsubscribe();
    hub.dispatch(chatUpdate);
    await vi.waitFor(() => expect(second.received).toHaveLength(1));
    expect(first.received).toEqual([]);
  });
});
