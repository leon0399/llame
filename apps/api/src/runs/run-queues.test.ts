import { RUNS_QUEUE } from './run-queues';

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
