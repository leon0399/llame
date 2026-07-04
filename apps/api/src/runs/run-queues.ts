import { ConfigService } from '@nestjs/config';

import { defineQueue } from '../queue/queue';
import { type RunUserMessage } from './run-execution.service';

/**
 * The runs-domain queue contract (#48/#50): job payload types, their queue
 * definitions (name + payload + guard as ONE value — enqueueing the wrong
 * shape is a compile error), and the deadman timing config that parameterizes
 * the timeout jobs. Everything queue-facing that dispatch and the worker
 * share lives here.
 */

/** Queue payload for one run execution (SPEC §9.5). */
export type RunJob = {
  runId: string;
  chatId: string;
  userId: string;
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
    const userMessage = record.userMessage;
    if (typeof userMessage !== 'object' || userMessage === null) {
      throw new TypeError("Malformed 'runs' job: missing userMessage");
    }
    return {
      runId: expectString(record, 'runId', 'runs'),
      chatId: expectString(record, 'chatId', 'runs'),
      userId: expectString(record, 'userId', 'runs'),
      userMessage: userMessage as RunUserMessage,
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

/** Deadman delay: how long a run may exist before its first liveness check. */
export function runTimeoutSeconds(config: ConfigService): number {
  const raw = Number(config.get<string>('RUN_TIMEOUT_SECONDS'));
  return Number.isFinite(raw) && raw > 0 ? raw : 300;
}

/** A run whose last sign of life is older than this is expirable. */
export function heartbeatStaleSeconds(config: ConfigService): number {
  const raw = Number(config.get<string>('RUN_HEARTBEAT_STALE_SECONDS'));
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}
