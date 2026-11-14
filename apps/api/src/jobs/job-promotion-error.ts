import { type ManagedStopResult } from '@workspace/bash-executor';

/**
 * A promotion that failed after the command was stopped. It carries the stop
 * proof and the captured streams, so the caller can build the failed-move
 * result of D4 without a second read of the handle.
 */
export class JobPromotionError extends Error {
  constructor(
    readonly stopped: ManagedStopResult,
    options: { cause: unknown },
  ) {
    super('The command could not be moved to the background.', options);
    this.name = 'JobPromotionError';
  }
}
