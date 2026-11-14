import { getEventListeners } from 'node:events';

import { withAbort } from './abort-promise';

describe('withAbort', () => {
  it('rejects when the signal is already aborted and removes its listener', async () => {
    const controller = new AbortController();
    controller.abort();

    const { promise: work } = Promise.withResolvers<never>();
    const pending = withAbort(work, controller.signal);

    await expect(pending).rejects.toMatchObject({
      name: 'Error',
      message: 'Tool call aborted',
    });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('lets settled work win over a later abort and cleans up the abort listener', async () => {
    const controller = new AbortController();

    const { promise: work, resolve: resolveWork } =
      Promise.withResolvers<string>();

    const pending = withAbort(work, controller.signal);

    resolveWork('completed');
    await expect(pending).resolves.toBe('completed');
    controller.abort();

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('keeps waiting after abort when the caller says the operation is settling', async () => {
    const controller = new AbortController();

    const { promise: work, resolve: resolveWork } =
      Promise.withResolvers<string>();

    const pending = withAbort(work, controller.signal, 0, () => true);

    controller.abort();
    resolveWork('settled during promotion');

    await expect(pending).resolves.toBe('settled during promotion');
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('uses a message-yield deadline rather than the full abort grace', async () => {
    vi.useFakeTimers();

    try {
      const controller = new AbortController();

      await vi.advanceTimersByTimeAsync(500);
      const deadlineAt = performance.now() + 100;
      const { promise: work } = Promise.withResolvers<never>();
      const pending = withAbort(work, controller.signal, 750);
      let rejected = false;
      void pending.catch(() => {
        rejected = true;
      });

      controller.abort({ cause: 'message', deadlineAt });
      await vi.advanceTimersByTimeAsync(99);
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      expect(rejected).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(rejected).toBe(true);

      await expect(pending).rejects.toMatchObject({
        message: 'Tool call aborted',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
