import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunAbortRegistry } from './run-abort-registry';
import { RunControlListenerService } from './run-control-listener.service';
import { RunsRepository } from './runs-repository';

type FoundRun = Awaited<ReturnType<RunsRepository['findById']>>;

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const cancel = JSON.stringify({ runId: RUN_ID, kind: 'cancel' });

/** Boots the listener over a registry holding one Run and a stubbed owner-scope read. */
async function boot(
  visibleRun:
    | { cancelRequestedAt: Date | null; status?: 'cancelled' }
    | undefined,
  { registered = true }: { registered?: boolean } = {},
) {
  const aborts = new RunAbortRegistry();
  const controller = registered
    ? aborts.register(RUN_ID, USER_ID)
    : new AbortController();
  const findById = vi
    .spyOn(RunsRepository.prototype, 'findById')
    .mockResolvedValue(
      // SAFETY: the listener reads only `cancelRequestedAt` and `status`.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      visibleRun as never,
    );
  const runAs = vi.fn((_userId: string, fn: (tx: never) => Promise<FoundRun>) =>
    // SAFETY: the stubbed repository never touches the transaction.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    fn(undefined as never),
  );
  const listener = {
    onNotify: (_raw: string) => {},
    onListen: () => {},
    listen: vi.fn((notify: (raw: string) => void, listening: () => void) => {
      listener.onNotify = notify;
      listener.onListen = listening;
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  const service = new RunControlListenerService(
    listener,
    { concurrencyFor: () => 1 },
    // SAFETY: only `runAs` is used by the listener.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    { runAs } as never,
    aborts,
  );
  await service.onApplicationBootstrap();
  const { onNotify, onListen } = listener;
  async function settled(): Promise<void> {
    await vi.waitFor(() => expect(findById).toHaveBeenCalled());
    await flush();
  }
  async function flush(): Promise<void> {
    for (const result of runAs.mock.results) await result.value;
    await Promise.resolve();
  }
  return { controller, onNotify, onListen, settled, flush, runAs };
}

describe('RunControlListenerService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('aborts a Run that the owner can no longer read (Chat deleted in another process)', async () => {
    const { controller, onNotify, settled } = await boot(undefined);

    onNotify(cancel);
    await settled();

    expect(controller.signal.aborted).toBe(true);
  });

  it('does not abort on a notification without a recorded cancellation', async () => {
    const { controller, onNotify, settled } = await boot({
      cancelRequestedAt: null,
    });

    onNotify(cancel);
    await settled();

    expect(controller.signal.aborted).toBe(false);
  });

  it('re-reads every registered Run on reconnect and aborts a deleted one', async () => {
    const { controller, onListen, settled } = await boot(undefined);

    onListen();
    await settled();

    expect(controller.signal.aborted).toBe(true);
  });

  it('aborts a Run whose owner recorded a cancellation', async () => {
    const { controller, onNotify, settled } = await boot({
      cancelRequestedAt: new Date(),
    });

    onNotify(cancel);
    await settled();

    expect(controller.signal.aborted).toBe(true);
  });

  it('aborts a superseded Run that settled cancelled without a request', async () => {
    const { controller, onNotify, settled } = await boot({
      cancelRequestedAt: null,
      status: 'cancelled',
    });

    onNotify(cancel);
    await settled();

    expect(controller.signal.aborted).toBe(true);
  });

  it('does not read the database for a Run this process does not execute', async () => {
    const { controller, onNotify, flush, runAs } = await boot(undefined, {
      registered: false,
    });

    onNotify(cancel);
    await flush();

    expect(runAs).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
  });

  it('ignores a malformed notification', async () => {
    const { controller, onNotify, flush, runAs } = await boot(undefined);

    onNotify('not json');
    onNotify(JSON.stringify({ kind: 'cancel' }));
    await flush();

    expect(runAs).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
  });

  it('ignores an interrupt notification in this layer', async () => {
    const { controller, onNotify, flush, runAs } = await boot(undefined);

    onNotify(JSON.stringify({ runId: RUN_ID, kind: 'interrupt' }));
    await flush();

    expect(runAs).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
  });
});
