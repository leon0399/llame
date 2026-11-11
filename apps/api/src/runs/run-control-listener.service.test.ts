import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { INTERRUPT_ABORT_REASON, RunAbortRegistry } from './run-abort-registry';
import { RunControlListenerService } from './run-control-listener.service';
import { RunsRepository } from './runs-repository';

type FoundRun = Awaited<ReturnType<RunsRepository['findById']>>;

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const cancel = JSON.stringify({ runId: RUN_ID, kind: 'cancel' });

const interrupt = JSON.stringify({ runId: RUN_ID, kind: 'interrupt' });
const CHAT_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';

type BootOptions = {
  registered?: boolean;
  /** The attempt of a segment in flight, when one is. */
  segmentAttemptId?: string;
  /** The attempt the Run names as active; defaults to the segment's. */
  activeAttemptId?: string;
  pendingInterrupt?: boolean;
  /** Concurrency the process consumes runs with; `null` consumes none. */
  concurrency?: number | null;
  /** Rejects the owner-scope read with this reason. */
  readFailure?: unknown;
};

/**
 * Boots the listener over a registry holding one Run, optionally with a
 * segment in flight, and stubbed owner-scope reads: the Run, and whether the
 * Chat holds a pending `interrupt` item.
 */
async function boot(
  visibleRun:
    | { cancelRequestedAt: Date | null; status?: 'cancelled' }
    | undefined,
  options: BootOptions = {},
) {
  const {
    registered = true,
    segmentAttemptId,
    concurrency = 1,
    readFailure,
  } = options;

  const aborts = new RunAbortRegistry();

  const controller = registered
    ? aborts.register(RUN_ID, USER_ID)
    : new AbortController();

  const segment =
    segmentAttemptId === undefined
      ? undefined
      : aborts.beginSegment(RUN_ID, segmentAttemptId);

  const findById = vi
    .spyOn(RunsRepository.prototype, 'findById')
    .mockResolvedValue(
      // SAFETY: the listener reads only these fields of the Run.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      (visibleRun === undefined
        ? undefined
        : {
            chatId: CHAT_ID,
            activeAttemptId: options.activeAttemptId ?? segmentAttemptId,
            ...visibleRun,
          }) as never,
    );

  const pending = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'hasPendingInterrupt')
    .mockResolvedValue(options.pendingInterrupt ?? false);

  const runAs = vi.fn(
    (_userId: string, fn: (tx: never) => Promise<boolean | FoundRun>) =>
      readFailure === undefined
        ? // SAFETY: the stubbed repositories never touch the transaction.
          // eslint-disable-next-line typescript/no-unsafe-type-assertion
          fn(undefined as never)
        : // eslint-disable-next-line typescript/prefer-promise-reject-errors
          Promise.reject(readFailure),
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
    { concurrencyFor: () => concurrency },
    // SAFETY: only `runAs` is used by the listener.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    { runAs } as never,
    aborts,
  );

  Object.assign(service, {
    jobs: {
      recheckJob: () => Promise.resolve(),
      recheckJobs: () => Promise.resolve(),
    },
  });

  await service.onApplicationBootstrap();
  const { onNotify, onListen } = listener;

  async function settled(): Promise<void> {
    await vi.waitFor(() => expect(findById).toHaveBeenCalled());
    await flush();
  }

  async function flush(): Promise<void> {
    for (const result of runAs.mock.results) {
      await Promise.resolve(result.value).catch(() => {});
    }

    await Promise.resolve();
  }

  return {
    controller,
    segment,
    onNotify,
    onListen,
    settled,
    flush,
    runAs,
    pending,
    listener,
    service,
  };
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

  it('does not listen in a process that does not consume runs', async () => {
    const { listener } = await boot(undefined, { concurrency: null });

    expect(listener.listen).not.toHaveBeenCalled();
  });

  it('closes the listener connection on shutdown', async () => {
    const { listener, service } = await boot(undefined);

    await service.onModuleDestroy();

    expect(listener.close).toHaveBeenCalledTimes(1);
  });

  it('logs a dropped malformed notification', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const { onNotify } = await boot(undefined);

    onNotify('not json');

    expect(warn).toHaveBeenCalledWith(
      'Dropped malformed run-control notification',
    );
  });

  it('keeps the Run and logs the reason when the owner-scope read fails', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const { controller, onNotify, flush, runAs } = await boot(undefined, {
      readFailure: new Error('db down'),
    });

    onNotify(cancel);
    await vi.waitFor(() => expect(runAs).toHaveBeenCalled());
    await flush();

    expect(warn).toHaveBeenCalledWith(
      `Run-control check failed for run ${RUN_ID}: db down`,
    );
    expect(controller.signal.aborted).toBe(false);
  });

  it('logs an unknown reason when the read fails with a non-Error', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const { onNotify, flush, runAs } = await boot(undefined, {
      readFailure: 'boom',
    });

    onNotify(cancel);
    await vi.waitFor(() => expect(runAs).toHaveBeenCalled());
    await flush();

    expect(warn).toHaveBeenCalledWith(
      `Run-control check failed for run ${RUN_ID}: unknown`,
    );
  });
});

describe('RunControlListenerService interrupts', () => {
  const visible = { cancelRequestedAt: null };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('An interrupt reaches a segment in flight for the attempt the item was admitted for', async () => {
    const { segment, onNotify, settled } = await boot(visible, {
      segmentAttemptId: ATTEMPT_ID,
      pendingInterrupt: true,
    });

    onNotify(interrupt);
    await settled();

    expect(segment?.signal.aborted).toBe(true);
    expect(segment?.signal.reason).toBe(INTERRUPT_ABORT_REASON);
  });

  it('does not stop a segment of an attempt the Run has already left', async () => {
    const { segment, onNotify, pending, settled } = await boot(visible, {
      segmentAttemptId: ATTEMPT_ID,
      // The Run moved to the delivered message's attempt.
      activeAttemptId: '55555555-5555-4555-8555-555555555555',
      pendingInterrupt: true,
    });

    onNotify(interrupt);
    await settled();

    expect(pending).not.toHaveBeenCalled();
    expect(segment?.signal.aborted).toBe(false);
  });

  it('waits for the step end when no model request or tool call is in flight', async () => {
    const { onNotify, flush, runAs } = await boot(visible, {
      pendingInterrupt: true,
    });

    onNotify(interrupt);
    await flush();

    // No segment, so nothing is read and nothing stops: the item waits as a
    // steer does.
    expect(runAs).not.toHaveBeenCalled();
  });

  it('does not stop a segment when the item is no longer pending', async () => {
    const { segment, onNotify, pending, settled } = await boot(visible, {
      segmentAttemptId: ATTEMPT_ID,
      pendingInterrupt: false,
    });

    onNotify(interrupt);
    await settled();

    expect(pending).toHaveBeenCalled();
    expect(segment?.signal.aborted).toBe(false);
  });

  it('keeps the segment and logs the reason when the pending-interrupt read fails', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const { segment, onNotify, flush, runAs } = await boot(visible, {
      segmentAttemptId: ATTEMPT_ID,
      readFailure: new Error('db down'),
    });

    onNotify(interrupt);
    await vi.waitFor(() => expect(runAs).toHaveBeenCalled());
    await flush();

    expect(warn).toHaveBeenCalledWith(
      `Run-control interrupt check failed for run ${RUN_ID}: db down`,
    );
    expect(segment?.signal.aborted).toBe(false);
  });
});
