/**
 * Equal-jitter reconnect delay: an exponential ceiling (1 s, doubling, capped
 * at 30 s) narrowed to its top half, so a retry never sleeps very briefly.
 *
 * Full jitter (`random() * ceiling`) does less work when many clients contend
 * on one row; reconnect attempts here come from a handful of tabs against one
 * endpoint, so the floor that keeps a flapping server from being hammered is
 * worth more than the marginal work reduction.
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export const RECONNECT_CEILING_MS = 30_000;

export function equalJitterDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(RECONNECT_CEILING_MS, 1000 * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}
