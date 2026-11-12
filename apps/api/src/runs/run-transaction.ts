import { RunEnqueueCollisionError } from './run-enqueue-collision-error';
import { pgErrorCode } from '../db/pg-error';

const MAX_ATTEMPTS = 5;

/** Retry a complete owner-scoped transaction after a deadlock, serialization
 * failure, or a collision on a freshly generated queue id. */
export async function retryRunTransaction<T>(
  work: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryableRunTransactionError(error)) {
        throw error;
      }
    }
  }
}

function isRetryableRunTransactionError(error: unknown): boolean {
  if (error instanceof RunEnqueueCollisionError) return true;
  const code = pgErrorCode(error);

  return code === '40P01' || code === '40001';
}
