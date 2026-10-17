/**
 * The runs-domain queue contract (#48/#50/durable-run-workers): the job
 * payload type, its queue definition (name + payload + guard as ONE value —
 * enqueueing the wrong shape is a compile error), and the run timing config
 * that parameterizes the queue's native worker-liveness window (D7) and the
 * in-process wall-clock abort budget. Everything queue-facing that dispatch
 * and the worker share lives here.
 */

import { type LlameConfig } from '../instance-config/llame-config';
import { runsChannel, type RunJob } from '../queue/generated/queue-protocol';
import { defineQueue, type QueueDefinition } from '../queue/queue';

/** Queue payload for one run execution (SPEC §9.5); `apps/api/asyncapi.queues.yaml` defines it. */
export type { RunJob };

export const RUNS_QUEUE = defineQueue<RunJob>({
  name: runsChannel.address,
  // TypeScript can't vouch for bytes that sat in Postgres across a deploy —
  // the generated guard fails malformed payloads at the consume boundary
  // (retry → dead letter) instead of deep inside the executor.
  parse: (data) => runsChannel.payload.parse(data),
});

/**
 * RUNS_QUEUE with its native worker-liveness window applied from config
 * (design D7): pg-boss auto-refreshes this queue's heartbeat while a job's
 * handler is pending, and fails+retries a job whose beat lapses beyond it —
 * the substrate's own worker-death detection, replacing the deleted
 * app-level setInterval heartbeat + stale-heartbeat CAS. QueueDefinition.options
 * is otherwise static (declared once at import time), but heartbeatSeconds is
 * a runtime config value, so this builds the definition fresh at each
 * ensureQueue() call site — both the dispatcher and the worker apply the same
 * value by calling this instead of referencing RUNS_QUEUE directly.
 */
export function runsQueueDefinition(
  config: LlameConfig,
): QueueDefinition<RunJob> {
  return {
    ...RUNS_QUEUE,
    options: {
      ...RUNS_QUEUE.options,
      heartbeatSeconds: heartbeatSeconds(config),
      // The job duration this queue DECLARES — deliberately longer than the
      // worker's execution ceiling, so the worker ends a live run long before
      // pg-boss could fail and re-execute it because of its age.
      expireInSeconds: RUNS_JOB_EXPIRE_SECONDS,
    },
  };
}

/**
 * The longest a single run's job may stay active, in seconds: the largest
 * value pg-boss accepts (it rejects 24 h or more), and the backstop that sits
 * ABOVE `RUN_EXECUTION_CEILING_SECONDS` so the worker's own ceiling always
 * ends the run first.
 */
export const RUNS_JOB_EXPIRE_SECONDS = 86_399;

/**
 * The runs execution ceiling, in seconds (23 h 55 m): the executing worker
 * ends any run still executing this long after its current attempt started,
 * with a message naming the ceiling rather than a budget. It is a substrate
 * constraint, not configuration — `runs.timeoutSeconds` is rejected at or
 * above it, and the loader imports THIS constant so the bound and the check
 * can never drift apart.
 */
export const RUN_EXECUTION_CEILING_SECONDS = 86_100;

/**
 * The operator's opt-in in-process wall-clock budget (design D7 mechanism 1):
 * while its worker is alive, a run exceeding this is aborted in-process and
 * recorded as a terminal run.expired, distinct from a user-requested
 * run.cancelled. `null` (the built-in default) means no budget at all.
 * Precedence (file > env > built-in default) and env-fallback tolerance are
 * resolved once at boot by InstanceConfigService (openspec/changes/
 * instance-config) — this is a plain passthrough.
 */
export function runTimeoutSeconds(config: LlameConfig): number | null {
  return config.runs.timeoutSeconds;
}

/**
 * The job-queue's native worker-liveness window (design D7 mechanism 2): how
 * long a run's job may go without a liveness signal before pg-boss's monitor
 * fails+retries it (>= 10s, pg-boss's own floor). This is NOT an application
 * heartbeat interval — pg-boss auto-refreshes automatically at
 * heartbeatSeconds/2 while the handler runs; there is no application
 * heartbeat code to schedule.
 */
export function heartbeatSeconds(config: LlameConfig): number {
  return config.runs.heartbeatSeconds;
}
