import { RunEnqueueCollisionError } from './run-enqueue-collision-error';
import { retryRunTransaction } from './run-transaction';

describe('retryRunTransaction', () => {
  it.each(['40P01', '40001'])(
    'retries SQLSTATE %s until the transaction succeeds',
    async (code) => {
      const result = { runId: 'run-1' };

      const work = vi
        .fn<() => Promise<typeof result>>()
        .mockRejectedValueOnce({ code })
        .mockResolvedValue(result);

      await expect(retryRunTransaction(work)).resolves.toBe(result);
      expect(work).toHaveBeenCalledTimes(2);
    },
  );

  it('retries a SQLSTATE wrapped as the driver error cause', async () => {
    const result = 'committed';

    const work = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ cause: { code: '40001' } })
      .mockResolvedValue(result);

    await expect(retryRunTransaction(work)).resolves.toBe(result);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('retries a fresh enqueue collision and returns the successful attempt result', async () => {
    const result = 'committed';

    const work = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new RunEnqueueCollisionError('run-1', 'job-1'))
      .mockResolvedValue(result);

    await expect(retryRunTransaction(work)).resolves.toBe(result);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('stops after five attempts and rejects with the final transaction error', async () => {
    const finalError = { code: '40P01' };
    const work = vi.fn<() => Promise<never>>();
    work.mockRejectedValueOnce({ code: '40001' });
    work.mockRejectedValueOnce({ code: '40P01' });
    work.mockRejectedValueOnce({ cause: { code: '40001' } });
    work.mockRejectedValueOnce({ code: '40P01' });
    work.mockRejectedValueOnce(finalError);

    await expect(retryRunTransaction(work)).rejects.toBe(finalError);
    expect(work).toHaveBeenCalledTimes(5);
  });

  it('retries an enqueue collision only up to the same attempt limit', async () => {
    const finalError = new RunEnqueueCollisionError('run-1', 'job-5');
    const work = vi.fn<() => Promise<never>>().mockRejectedValue(finalError);

    await expect(retryRunTransaction(work)).rejects.toBe(finalError);
    expect(work).toHaveBeenCalledTimes(5);
  });

  it.each([
    ['an ordinary error', new Error('connection lost')],
    ['an unrelated SQLSTATE', { code: '23505' }],
    [
      'a SQLSTATE nested beyond the supported driver wrapper',
      {
        cause: { cause: { code: '40P01' } },
      },
    ],
  ])(
    'does not retry %s and preserves the original error',
    async (_label, error) => {
      const work = vi.fn<() => Promise<never>>().mockRejectedValue(error);

      await expect(retryRunTransaction(work)).rejects.toBe(error);
      expect(work).toHaveBeenCalledTimes(1);
    },
  );
});
