import { describe, expect, it, vi } from 'vitest';

import { RunAbortRegistry } from './run-abort-registry';
import { RunControlListenerService } from './run-control-listener.service';
import { RunsRepository } from './runs-repository';

const listen = vi.hoisted(() =>
  vi.fn<
    (
      channel: string,
      onNotify: (raw: string) => void,
      onListen: () => void,
    ) => void
  >(),
);
vi.mock('postgres', () => ({
  default: () => ({ listen, end: vi.fn() }),
}));

type FoundRun = Awaited<ReturnType<RunsRepository['findById']>>;

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const cancel = JSON.stringify({ runId: RUN_ID, kind: 'cancel' });

/** Boots the listener over a registry holding one Run and a stubbed owner-scope read. */
async function boot(
  visibleRun: { cancelRequestedAt: Date | null } | undefined,
) {
  const aborts = new RunAbortRegistry();
  const controller = aborts.register(RUN_ID, USER_ID);
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
  const service = new RunControlListenerService(
    { get: () => undefined, getOrThrow: () => 'postgres://unused' },
    { concurrencyFor: () => 1 },
    // SAFETY: only `runAs` is used by the listener.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    { runAs } as never,
    aborts,
  );
  listen.mockReset();
  await service.onApplicationBootstrap();
  const [, onNotify, onListen] = listen.mock.calls[0] ?? [];
  if (!onNotify || !onListen) throw new Error('listener did not subscribe');
  async function settled(): Promise<void> {
    await vi.waitFor(() => expect(findById).toHaveBeenCalled());
    for (const result of runAs.mock.results) await result.value;
    await Promise.resolve();
  }
  return { controller, onNotify, onListen, settled };
}

describe('RunControlListenerService', () => {
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
});
