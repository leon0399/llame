import { type ChatJob } from '../../db/schema';
import { toChatJobResponse } from './chat-jobs.dto';

function job(overrides: Partial<ChatJob> = {}): ChatJob {
  return {
    id: 'j1',
    chatId: 'c1',
    ownerUserId: 'u1',
    executor: 'bash',
    seq: 4,
    state: 'running',
    stoppedBy: null,
    runId: 'r1',
    toolCallId: 't1',
    workerInstanceId: 'w1',
    pid: null,
    startedAt: new Date('2026-11-11T10:00:00.000Z'),
    settledAt: null,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: null,
    outputs: ['stdout', 'stderr'],
    artifactId: null,
    artifactReadable: true,
    settings: { modelId: 'm', permissionMode: 'default' },
    ...overrides,
  };
}

describe('toChatJobResponse', () => {
  it('names only the outputs whose stored truncation flags are true', () => {
    const response = toChatJobResponse(
      job({
        outputs: ['stdout', 'stderr', 'report'],
        result: { truncated: { stdout: true, stderr: false, report: true } },
      }),
    );

    expect(response.truncated).toEqual(['stdout', 'report']);
  });

  it.each([null, {}, { truncated: { stdout: false } }])(
    'reports no truncated outputs for an uncut result %j',
    (result) => {
      expect(toChatJobResponse(job({ result })).truncated).toEqual([]);
    },
  );

  it('maps a live job with empty exit detail', () => {
    expect(toChatJobResponse(job())).toMatchObject({
      locator: 'job://bash-4',
      exitCode: null,
      signal: null,
      outcomeUnknown: false,
      artifact: null,
    });
  });

  it('maps the exit detail, the unknown outcome, and the artifact locator', () => {
    expect(
      toChatJobResponse(
        job({
          state: 'lost',
          artifactId: 'a1',
          result: { exitCode: 2, signal: 'SIGKILL', outcomeUnknown: true },
        }),
      ),
    ).toMatchObject({
      exitCode: 2,
      signal: 'SIGKILL',
      outcomeUnknown: true,
      artifact: 'artifact://bash-4',
    });
  });

  it('does not mark a result that lacks the flag as unknown', () => {
    expect(
      toChatJobResponse(job({ result: { exitCode: 0 } })).outcomeUnknown,
    ).toBe(false);
  });
});
