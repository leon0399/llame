import { createAttemptSlots } from './attempt-slots';

describe('attempt slots', () => {
  it('grants waiting attempts in arrival order', async () => {
    const slots = createAttemptSlots(1);
    const releaseHolder = await slots.acquire();
    const order: Array<string> = [];

    const waiters = ['a', 'b', 'c'].map(async (name) => {
      const release = await slots.acquire();
      order.push(name);
      release();
    });

    releaseHolder();
    await Promise.all(waiters);

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('skips a waiter that aborted and grants the next one', async () => {
    const slots = createAttemptSlots(1);
    const releaseHolder = await slots.acquire();
    const controller = new AbortController();
    const reason = new Error('owner cancelled');
    const aborted = slots.acquire(controller.signal);
    const next = slots.acquire();

    controller.abort(reason);
    await expect(aborted).rejects.toBe(reason);
    releaseHolder();

    await expect(next).resolves.toBeTypeOf('function');
  });

  it('ignores a second release of one slot', async () => {
    const slots = createAttemptSlots(1);
    const release = await slots.acquire();
    release();
    release();

    const first = await slots.acquire();
    let secondGranted = false;

    const second = slots.acquire().then((releaseSecond) => {
      secondGranted = true;

      return releaseSecond;
    });

    await Promise.resolve();
    expect(secondGranted).toBe(false);
    first();
    (await second)();
  });
});
