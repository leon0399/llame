import { type LlameConfig } from '../instance-config/llame-config';
import { defineQueue } from '../queue/queue';
import { type RunUserMessage } from './run-execution.service';

/**
 * The runs-domain queue contract (#48/#50): job payload types, their queue
 * definitions (name + payload + guard as ONE value — enqueueing the wrong
 * shape is a compile error), and the run timing config (deadman timeout +
 * stale threshold + heartbeat interval) that parameterizes the timeout jobs
 * and the worker's liveness stamping. Everything queue-facing that dispatch
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

/** Deadman payload (#48): one delayed job per run checks it in later. */
export type RunTimeoutJob = {
  runId: string;
  userId: string;
};

function expectString(
  value: Record<string, unknown>,
  field: string,
  queue: string,
): string {
  const raw = value[field];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new TypeError(
      `Malformed '${queue}' job: expected non-empty string '${field}'`,
    );
  }
  return raw;
}

function expectRecord(data: unknown, queue: string): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) {
    throw new TypeError(`Malformed '${queue}' job: payload is not an object`);
  }
  return data as Record<string, unknown>;
}

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

export const RUN_TIMEOUTS_QUEUE = defineQueue<RunTimeoutJob>({
  name: 'runs.timeouts',
  parse: (data) => {
    const record = expectRecord(data, 'runs.timeouts');
    return {
      runId: expectString(record, 'runId', 'runs.timeouts'),
      userId: expectString(record, 'userId', 'runs.timeouts'),
    };
  },
});

/**
 * Deadman delay: how long a run may exist before its first liveness check.
 * Precedence (file > env > built-in default) and env-fallback tolerance are
 * resolved once at boot by InstanceConfigService (openspec/changes/
 * instance-config) — this is a plain passthrough.
 */
export function runTimeoutSeconds(config: LlameConfig): number {
  return config.runs.timeoutSeconds;
}

/** A run whose last sign of life is older than this is expirable. */
export function heartbeatStaleSeconds(config: LlameConfig): number {
  return config.runs.heartbeatStaleSeconds;
}

/** How often the executing worker stamps a liveness heartbeat. */
export function heartbeatSeconds(config: LlameConfig): number {
  return config.runs.heartbeatSeconds;
}
