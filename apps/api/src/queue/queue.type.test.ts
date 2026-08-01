/**
 * Type-level regression tests for the typed queue surface (#47).
 *
 * Each @ts-expect-error asserts a misuse DOES NOT COMPILE. If the typing ever
 * weakens (e.g. the payload phantom is dropped and definitions become
 * structurally interchangeable), the directive stops firing and `tsgo
 * --noEmit` fails — the type guarantee is itself under test. No runtime
 * behavior is exercised here.
 */

import { defineQueue, type Queue } from './queue';
import { RUNS_QUEUE } from '../runs/run-queues';

declare const queue: Queue;

const runJob = {
  runId: 'r',
  chatId: 'c',
  userId: 'u',
  modelId: 'system:openai:gpt-5.4-mini',
  userMessage: { id: 'm', seq: 1, parts: [] },
};

// A second, differently-shaped queue definition — purely a type-level foil
// for the cross-queue-type assertions below. (RUN_TIMEOUTS_QUEUE, the queue
// this used to be checked against, was deleted with the liveness collapse
// onto the job-queue's native heartbeat — durable-run-workers D7.)
const OTHER_QUEUE = defineQueue<{ runId: string; userId: string }>({
  name: 'other-queue-shape-check',
});

async function typeAssertions(): Promise<void> {
  // Correct usages compile.
  await queue.enqueue(RUNS_QUEUE, runJob);
  await queue.enqueue(OTHER_QUEUE, { runId: 'r', userId: 'u' });
  await queue.consume(RUNS_QUEUE, (data) => {
    // Payload type flows into the handler from the definition alone.
    void data.userMessage;
    return Promise.resolve();
  });

  // @ts-expect-error a differently-shaped payload cannot go onto RUNS_QUEUE
  await queue.enqueue(RUNS_QUEUE, { runId: 'r', userId: 'u' });

  // A run-shaped literal cannot go onto OTHER_QUEUE (excess-property check;
  // NOTE a superset passed via a VARIABLE is allowed by TypeScript's
  // structural subtyping — that is inherent to TS, not a queue-typing gap).
  // prettier-ignore
  // @ts-expect-error excess properties for OTHER_QUEUE's payload
  await queue.enqueue(OTHER_QUEUE, { runId: 'r', userId: 'u', chatId: 'c' });

  // @ts-expect-error a handler for the wrong payload cannot consume the queue
  await queue.consume(OTHER_QUEUE, (_data: { chatId: string }) =>
    Promise.resolve(),
  );

  // @ts-expect-error schedule() payloads are checked against the definition
  await queue.schedule(OTHER_QUEUE, '* * * * *', { bogus: true });

  // defineQueue keeps the declared payload type without needing annotations.
  const inferred = defineQueue<{ n: number }>({ name: 'inference-check' });
  // @ts-expect-error the inferred definition rejects foreign payloads
  await queue.enqueue(inferred, { s: 'nope' });
}

// Definitions are invariant in their payload type: same-structure tricks
// cannot launder one queue's definition into another's.
// @ts-expect-error a RUNS_QUEUE definition is not assignable to OTHER_QUEUE's
const _laundered: typeof OTHER_QUEUE = RUNS_QUEUE;

void typeAssertions;

describe('typed queue surface', () => {
  it('is enforced at compile time (see @ts-expect-error assertions above)', () => {
    expect(typeof defineQueue).toBe('function');
  });
});
