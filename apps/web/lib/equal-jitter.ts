/**
 * Equal-jitter reconnect delay: a doubling exponential ceiling (1 s, 2 s, …)
 * narrowed to its top half, so a retry never sleeps very briefly. The ceiling
 * is the caller's: a socket's reconnect budget and a chat stream's repair
 * budget are separate policies that happen to agree today.
 *
 * Full jitter (`random() * ceiling`) does less work when many clients contend
 * on one row; reconnect attempts here come from a handful of tabs against one
 * endpoint, so the floor that keeps a flapping server from being hammered is
 * worth more than the marginal work reduction.
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export function equalJitterDelayMs(
  attempt: number,
  ceilingMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(ceilingMs, 1000 * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}
