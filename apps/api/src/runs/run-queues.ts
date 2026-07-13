import { type LlameConfig } from '../instance-config/llame-config';
import {
  defineQueue,
  expectRecord,
  expectString,
  type QueueDefinition,
} from '../queue/queue';
import { type RunUserMessage } from './run-execution.service';

/**
 * The runs-domain queue contract (#48/#50/durable-run-workers): the job
 * payload type, its queue definition (name + payload + guard as ONE value —
 * enqueueing the wrong shape is a compile error), and the run timing config
 * that parameterizes the queue's native worker-liveness window (D7) and the
 * in-process wall-clock abort budget. Everything queue-facing that dispatch
 * and the worker share lives here.
 */

/** Queue payload for one run execution (SPEC §9.5). */
export type RunJob = {
  runId: string;
  chatId: string;
  userId: string;
  modelId: string;
  userMessage: RunUserMessage;
};

export const RUNS_QUEUE = defineQueue<RunJob>({
  name: 'runs',
  // TypeScript can't vouch for bytes that sat in Postgres across a deploy —
  // the guard fails malformed payloads at the consume boundary (retry →
  // dead letter) instead of deep inside the executor.
  parse: (data) => {
    const record = expectRecord(data, 'runs');
    const message = expectRecord(record.userMessage, 'runs');
    if (typeof message.seq !== 'number' || !Number.isFinite(message.seq)) {
      throw new TypeError("Malformed 'runs' job: userMessage.seq not a number");
    }
    if (!Array.isArray(message.parts)) {
      throw new TypeError(
        "Malformed 'runs' job: userMessage.parts not an array",
      );
    }
    const userMessage: RunUserMessage = {
      id: expectString(message, 'id', 'runs'),
      seq: message.seq,
      parts: message.parts as RunUserMessage['parts'],
    };
    return {
      runId: expectString(record, 'runId', 'runs'),
      chatId: expectString(record, 'chatId', 'runs'),
      userId: expectString(record, 'userId', 'runs'),
      modelId: expectString(record, 'modelId', 'runs'),
      userMessage,
    };
  },
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
    },
  };
}

/**
 * In-process wall-clock budget (design D7 mechanism 1): while its worker is
 * alive, a run exceeding this is aborted in-process and recorded as a
 * terminal run.expired, distinct from a user-requested run.cancelled.
 * Precedence (file > env > built-in default) and env-fallback tolerance are
 * resolved once at boot by InstanceConfigService (openspec/changes/
 * instance-config) — this is a plain passthrough.
 */
export function runTimeoutSeconds(config: LlameConfig): number {
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

/**
 * The longest a real run could take — the in-process wall-clock budget plus
 * one heartbeat window — past which a single-flight blocker with no active
 * job (chat-loop.service.ts) is treated as stuck rather than merely slow.
 */
export function stuckRunThresholdMs(config: LlameConfig): number {
  return (runTimeoutSeconds(config) + heartbeatSeconds(config)) * 1000;
}
