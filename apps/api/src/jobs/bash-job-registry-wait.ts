import { type CallOptions, type Client } from '@connectrpc/connect';
import { JobState, JobService, type Job } from '@workspace/machine-protocol';
import type { MachineRequestOptions } from '../machines/machine-session';

type JobsClient = Client<typeof JobService>;
type JobsCallOptions = (options?: MachineRequestOptions) => CallOptions;
export type SettlementWait =
  | { kind: 'settled'; job: Job }
  | { kind: 'moved'; cause: 'time' | 'message' }
  | { kind: 'disconnected' }
  | { kind: 'cancelled' };

export async function waitForSettlement(deps: {
  client: JobsClient;
  callOptions: JobsCallOptions;
  ended: Promise<unknown>;
  jobId: string;
  waitMs: number;
  moveSignal: AbortSignal | undefined;
  abortSignal: AbortSignal | undefined;
}): Promise<SettlementWait> {
  const { client, callOptions, ended, jobId, waitMs, moveSignal, abortSignal } =
    deps;
  const controller = new AbortController();
  const watch = async () => {
    for await (const response of client.watchJobs(
      {},
      callOptions({ signal: controller.signal, budgetMs: waitMs }),
    )) {
      if (
        response.event.case === 'job' &&
        response.event.value.id === jobId &&
        response.event.value.state !== JobState.RUNNING
      )
        return response.event.value;
    }
    throw new Error('Jobs.WatchJobs ended');
  };
  const timer = new Promise<'time'>((resolve) =>
    setTimeout(() => resolve('time'), waitMs),
  );
  const move =
    moveSignal === undefined
      ? new Promise<never>(() => undefined)
      : new Promise<'message'>((resolve) =>
          moveSignal.addEventListener('abort', () => resolve('message'), {
            once: true,
          }),
        );
  const cancel =
    abortSignal === undefined
      ? new Promise<never>(() => undefined)
      : new Promise<'cancelled'>((resolve) =>
          abortSignal.addEventListener('abort', () => resolve('cancelled'), {
            once: true,
          }),
        );
  try {
    const outcome = await Promise.race([
      watch(),
      timer,
      move,
      cancel,
      ended.then(() => 'disconnect' as const),
    ]);
    if (outcome === 'time') return { kind: 'moved', cause: 'time' };
    if (outcome === 'message') return { kind: 'moved', cause: 'message' };
    if (outcome === 'cancelled') return { kind: 'cancelled' };
    if (outcome === 'disconnect') return { kind: 'disconnected' };
    return { kind: 'settled', job: outcome };
  } finally {
    controller.abort();
  }
}
