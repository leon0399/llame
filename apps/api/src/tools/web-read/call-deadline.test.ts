import { getEventListeners } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startCallDeadline } from './call-deadline';

describe('web preparation deadline', () => {
  afterEach(() => vi.useRealTimers());

  it('refuses preparation after the call budget is already spent', async () => {
    vi.useFakeTimers();
    const deadline = startCallDeadline({ userAgent: 'llame/test' });
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(
        await deadline.untilDeadline(() => Promise.resolve(15)),
      ).toMatchObject({
        type: 'call_timeout',
      });
    } finally {
      deadline.dispose();
    }
  });

  it.each(['success', 'failure'])(
    'releases its abort listener after preparation %s',
    async (outcome) => {
      const deadline = startCallDeadline({ userAgent: 'llame/test' });
      let signal!: AbortSignal;
      const failure = new Error('PDF preparation failed');
      try {
        const pending = deadline.untilDeadline((operationSignal) => {
          signal = operationSignal;
          return outcome === 'success'
            ? Promise.resolve(15)
            : Promise.reject(failure);
        });
        if (outcome === 'success') await pending;
        else await expect(pending).rejects.toBe(failure);
        expect(getEventListeners(signal, 'abort')).toEqual([]);
      } finally {
        deadline.dispose();
      }
    },
  );
});
