import {
  heartbeatSeconds,
  RUN_EXECUTION_CEILING_SECONDS,
  runsQueueDefinition,
  runTimeoutSeconds,
  RUNS_JOB_EXPIRE_SECONDS,
  RUNS_QUEUE,
} from './run-queues';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';

const validJob = {
  runId: 'run-1',
  chatId: 'chat-1',
  userId: 'user-1',
  modelId: 'model-1',
  userMessage: { id: 'message-1', seq: 1, parts: [] },
};

describe('RUNS_QUEUE payload parsing', () => {
  it('accepts a positive safe Chat-local message sequence', () => {
    expect(RUNS_QUEUE.parse?.(validJob)).toEqual(validJob);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid message sequence before execution: %s',
    (seq) => {
      expect(() =>
        RUNS_QUEUE.parse?.({
          ...validJob,
          userMessage: { ...validJob.userMessage, seq },
        }),
      ).toThrow(
        "Malformed 'runs' job: userMessage.seq not a positive safe integer",
      );
    },
  );
});

describe('runs queue timing definition', () => {
  it('copies configured timeout and heartbeat values into the queue definition', () => {
    const config = {
      ...BUILT_IN_DEFAULTS,
      runs: {
        ...BUILT_IN_DEFAULTS.runs,
        timeoutSeconds: 90,
        heartbeatSeconds: 30,
      },
    };

    expect(runTimeoutSeconds(config)).toBe(90);
    expect(heartbeatSeconds(config)).toBe(30);
    expect(runsQueueDefinition(config)).toMatchObject({
      name: RUNS_QUEUE.name,
      options: {
        heartbeatSeconds: 30,
        expireInSeconds: RUNS_JOB_EXPIRE_SECONDS,
      },
    });
  });

  it('has no wall-clock budget by default', () => {
    expect(runTimeoutSeconds(BUILT_IN_DEFAULTS)).toBeNull();
    expect(runsQueueDefinition(BUILT_IN_DEFAULTS).options).toMatchObject({
      heartbeatSeconds: 15,
      expireInSeconds: RUNS_JOB_EXPIRE_SECONDS,
    });
  });

  it('falls short of the job duration the queue itself enforces', () => {
    // pg-boss rejects an expiry of 24 h or more, so 86,399 s is the largest
    // declarable duration. The worker's own ceiling must land BEFORE it, with
    // room to settle the run's terminal state — otherwise the queue fails and
    // re-executes a live long run instead of the worker ending it.
    expect(RUNS_JOB_EXPIRE_SECONDS).toBe(86_399);
    expect(RUN_EXECUTION_CEILING_SECONDS).toBe(86_100);
    expect(RUN_EXECUTION_CEILING_SECONDS).toBeLessThan(RUNS_JOB_EXPIRE_SECONDS);
  });
});
