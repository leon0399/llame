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
  const signals = createSettlementSignals(waitMs, moveSignal, abortSignal);

  try {
    const disconnected = ended.then(() => 'disconnect' as const);

    const watch = watchForSettledJob({
      client,
      callOptions,
      jobId,
      waitMs,
      signal: controller.signal,
    }).catch(() => disconnected);

    const outcome = await Promise.race([
      watch,
      signals.timer,
      signals.move,
      signals.cancel,
      disconnected,
    ]);

    return asSettlementWait(outcome);
  } finally {
    controller.abort();
  }
}

type SettlementSignals = {
  timer: Promise<'time'>;
  move: Promise<'message'> | Promise<never>;
  cancel: Promise<'cancelled'> | Promise<never>;
};

function createSettlementSignals(
  waitMs: number,
  moveSignal: AbortSignal | undefined,
  abortSignal: AbortSignal | undefined,
): SettlementSignals {
  const timer = new Promise<'time'>((resolve) =>
    setTimeout(() => resolve('time'), waitMs),
  );

  const move = abortOnSignal(moveSignal, 'message');
  const cancel = abortOnSignal(abortSignal, 'cancelled');

  return { timer, move, cancel };
}

function abortOnSignal<T extends 'message' | 'cancelled'>(
  signal: AbortSignal | undefined,
  outcome: T,
): Promise<T> | Promise<never> {
  if (signal === undefined) return new Promise<never>(() => undefined);

  if (signal.aborted) return Promise.resolve(outcome);

  return new Promise<T>((resolve) =>
    signal.addEventListener('abort', () => resolve(outcome), { once: true }),
  );
}

async function watchForSettledJob(input: {
  client: JobsClient;
  callOptions: JobsCallOptions;
  jobId: string;
  waitMs: number;
  signal: AbortSignal;
}): Promise<Job> {
  const { client, callOptions, jobId, waitMs, signal } = input;

  for await (const response of client.watchJobs(
    {},
    callOptions({ signal, budgetMs: waitMs }),
  )) {
    if (
      response.event.case === 'job' &&
      response.event.value.id === jobId &&
      response.event.value.state !== JobState.RUNNING
    )
      return response.event.value;
  }

  throw new Error('Jobs.WatchJobs ended');
}

function asSettlementWait(
  outcome: Job | 'time' | 'message' | 'cancelled' | 'disconnect',
): SettlementWait {
  if (outcome === 'time') return { kind: 'moved', cause: 'time' };

  if (outcome === 'message') return { kind: 'moved', cause: 'message' };

  if (outcome === 'cancelled') return { kind: 'cancelled' };

  if (outcome === 'disconnect') return { kind: 'disconnected' };

  return { kind: 'settled', job: outcome };
}
