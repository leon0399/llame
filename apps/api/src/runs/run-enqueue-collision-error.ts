export class RunEnqueueCollisionError extends Error {
  constructor(
    readonly runId: string,
    readonly jobId: string,
  ) {
    super(`Could not enqueue run ${runId}: job id ${jobId} already exists`);
    this.name = 'RunEnqueueCollisionError';
  }
}
