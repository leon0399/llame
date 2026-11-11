import { type LlameConfig } from '../instance-config/llame-config';

/** A worker is dead after this many heartbeat intervals with no heartbeat. */
export const WORKER_DEAD_AFTER_INTERVALS = 4;

/**
 * The seconds without a heartbeat after which a worker is dead (background-jobs
 * D9): four intervals of `runs.heartbeatSeconds`. A job that runs on such a
 * worker settles as `lost` at its next touch.
 */
export function workerDeadAfterSeconds(
  config: Pick<LlameConfig, 'runs'>,
): number {
  return config.runs.heartbeatSeconds * WORKER_DEAD_AFTER_INTERVALS;
}
