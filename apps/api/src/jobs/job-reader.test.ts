import { renderReadText } from '@workspace/native-file-tools';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type ChatJob } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { type ToolContext, type ToolResult } from '../tools/types';
import { ChatJobsRepository } from './chat-jobs.repository';
import { readJob } from './job-reader';

const CHAT = '00000000-0000-4000-8000-000000000001';
const USER = 'owner-1';
const START = new Date('2026-11-11T10:00:00.000Z');

function contextOf(workerDeadAfterSeconds?: number): ToolContext {
  const db = drizzle.mock({ schema });
  const runAs: TenantRunner['runAs'] = (_user, fn) => fn(db);

  return {
    configuredCredentials: [],
    userId: USER,
    chatId: CHAT,
    tenantDb: { runAs },
    ...(workerDeadAfterSeconds !== undefined && { workerDeadAfterSeconds }),
  };
}

function job(overrides: Partial<ChatJob> = {}): ChatJob {
  return {
    id: 'j1',
    chatId: CHAT,
    ownerUserId: USER,
    executor: 'bash',
    seq: 4,
    state: 'running',
    stoppedBy: null,
    runId: 'r1',
    toolCallId: 't1',
    workerInstanceId: 'w1',
    pid: null,
    startedAt: START,
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

function script() {
  return {
    settle: vi
      .spyOn(ChatJobsRepository.prototype, 'settleOnDeadWorkers')
      .mockResolvedValue([]),
    find: vi.spyOn(ChatJobsRepository.prototype, 'findByLocator'),
    list: vi.spyOn(ChatJobsRepository.prototype, 'listByChat'),
    output: vi.spyOn(ChatJobsRepository.prototype, 'readOutput'),
    part: vi.spyOn(ArtifactsRepository.prototype, 'readPart'),
  };
}

function text(result: ToolResult): string {
  if (result.status !== 'success') {
    throw new Error(`Expected a read success, got ${JSON.stringify(result)}`);
  }

  return renderReadText(result);
}

const read = (path: string, context = contextOf()) =>
  readJob(context, 'read', path);

describe('readJob', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['edit', 'write'] as const)(
    'refuses %s with invalid_path',
    async (operation) => {
      const s = script();

      await expect(
        readJob(contextOf(), operation, 'job://bash-4'),
      ).resolves.toMatchObject({ status: 'error', type: 'invalid_path' });
      expect(s.settle).not.toHaveBeenCalled();
    },
  );

  it.each(['job://bash', 'job://bash-0', 'job://bash-4/a/b', 'job:bash-4'])(
    'refuses the malformed locator %s before any query',
    async (path) => {
      const s = script();

      await expect(read(path)).resolves.toMatchObject({
        status: 'error',
        type: 'invalid_path',
      });
      expect(s.settle).not.toHaveBeenCalled();
      expect(s.find).not.toHaveBeenCalled();
    },
  );

  it('settles dead-worker jobs first, with the window of the context', async () => {
    const s = script();

    s.find.mockResolvedValue(job());
    await read('job://bash-4', contextOf(77));

    expect(s.settle).toHaveBeenCalledWith(CHAT, USER, 77);
    expect(s.settle.mock.invocationCallOrder[0]).toBeLessThan(
      s.find.mock.invocationCallOrder[0],
    );
  });

  it('uses four default heartbeat intervals when the context gives none', async () => {
    const s = script();

    s.find.mockResolvedValue(job());
    await read('job://bash-4');

    expect(s.settle).toHaveBeenCalledWith(CHAT, USER, 60);
  });

  it('stops before any query when the Run is aborted', async () => {
    const s = script();
    const controller = new AbortController();

    controller.abort(new Error('aborted'));

    await expect(
      read('job://bash-4', { ...contextOf(), abortSignal: controller.signal }),
    ).rejects.toThrow('aborted');
    expect(s.settle).not.toHaveBeenCalled();
  });

  describe('the list', () => {
    it('lists the jobs with the locator, the state, and the start time', async () => {
      const s = script();

      s.list.mockResolvedValue([
        job({ seq: 2, state: 'succeeded' }),
        job({ seq: 4 }),
      ]);

      expect(text(await read('JOB://'))).toBe(
        [
          'job://',
          'job://bash-2 (succeeded, 2026-11-11T10:00:00.000Z)',
          'job://bash-4 (running, 2026-11-11T10:00:00.000Z)',
        ].join('\n'),
      );
      expect(s.find).not.toHaveBeenCalled();
    });

    it('renders an empty list as job://: empty', async () => {
      script().list.mockResolvedValue([]);

      expect(text(await read('job://'))).toBe('job://: empty');
    });

    it('accepts one range and refuses a comma range', async () => {
      script().list.mockResolvedValue([job({ seq: 1 }), job({ seq: 2 })]);

      expect(text(await read('job://:2-2'))).toContain('job://bash-2');
      await expect(read('job://:1,2')).resolves.toMatchObject({
        status: 'error',
        type: 'invalid_selector',
      });
    });
  });

  describe('the record', () => {
    it('answers not_found for a job that the Chat lacks', async () => {
      script().find.mockResolvedValue(undefined);

      await expect(read('job://bash-9')).resolves.toMatchObject({
        status: 'error',
        type: 'not_found',
      });
    });

    it('looks the job up by executor and number inside the Chat of the owner', async () => {
      const s = script();

      s.find.mockResolvedValue(job());
      await read('job://bash-4');

      expect(s.find).toHaveBeenCalledWith(CHAT, USER, 'bash', 4);
    });

    it('renders a live job with elapsed time from now, and no content', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(START.getTime() + 2500));
      script().find.mockResolvedValue(job());

      const result = text(await read('job://bash-4'));

      vi.useRealTimers();
      expect(result).toBe(
        [
          'job://bash-4',
          'executor: bash',
          'state: running',
          'started_at: 2026-11-11T10:00:00.000Z',
          'elapsed: 2.5 s',
          'outputs: stdout, stderr',
        ].join('\n'),
      );
    });

    it('shows a recorded stop request only while the job runs', async () => {
      const s = script();

      s.find.mockResolvedValue(job({ stopRequestedBy: 'owner' }));
      expect(text(await read('job://bash-4'))).toContain(
        'stop_requested_by: owner',
      );

      s.find.mockResolvedValue(
        job({
          state: 'cancelled',
          stoppedBy: 'owner',
          stopRequestedBy: 'owner',
          settledAt: new Date(START.getTime() + 3000),
        }),
      );

      const settled = text(await read('job://bash-4'));

      expect(settled).not.toContain('stop_requested_by');
      expect(settled).toContain('stopped_by: owner');
      expect(settled).toContain('settled_at: 2026-11-11T10:00:03.000Z');
      expect(settled).toContain('elapsed: 3.0 s');
    });

    it('renders the exit detail, the cut outputs, and the artifact locator', async () => {
      script().find.mockResolvedValue(
        job({
          state: 'failed',
          artifactId: 'a1',
          settledAt: START,
          result: {
            exitCode: 2,
            signal: 'SIGTERM',
            truncated: { stdout: true, stderr: false },
          },
        }),
      );

      const record = text(await read('job://bash-4'));

      expect(record).toContain('\nexit_code: 2\n');
      expect(record).toContain('\nsignal: SIGTERM\n');
      expect(record).toContain('\ntruncated: stdout\n');
      expect(record).toContain('\nartifact: artifact://bash-4');
    });

    it('renders exit code 0 and omits absent detail', async () => {
      script().find.mockResolvedValue(
        job({
          state: 'succeeded',
          settledAt: START,
          result: { exitCode: 0, signal: null, truncated: { stdout: false } },
        }),
      );

      const record = text(await read('job://bash-4'));

      expect(record).toContain('exit_code: 0');
      expect(record).not.toContain('signal:');
      expect(record).not.toContain('truncated:');
      expect(record).not.toContain('outcome:');
      expect(record).not.toContain('artifact:');
    });

    it('states that the outcome of a lost job is unknown', async () => {
      script().find.mockResolvedValue(
        job({ state: 'lost', result: { outcomeUnknown: true } }),
      );

      expect(text(await read('job://bash-4'))).toContain(
        'outcome: unknown (the worker of this job stopped)',
      );
    });

    it('refuses a comma range on the record', async () => {
      script().find.mockResolvedValue(job());

      await expect(read('job://bash-4:1,2')).resolves.toMatchObject({
        status: 'error',
        type: 'invalid_selector',
      });
    });
  });

  describe('an output', () => {
    it('answers not_found for an output that the job lacks, without a read', async () => {
      const s = script();

      s.find.mockResolvedValue(job());

      await expect(read('job://bash-4/log')).resolves.toMatchObject({
        status: 'error',
        type: 'not_found',
      });
      expect(s.output).not.toHaveBeenCalled();
    });

    it('returns the stored increments of a running job with the read header', async () => {
      const s = script();

      s.find.mockResolvedValue(job());
      s.output.mockResolvedValue(Buffer.from('a\nb\nc\nd\ne\nf\n'));

      const result = text(await read('job://bash-4/stdout:-2'));

      expect(s.output).toHaveBeenCalledWith(USER, 'j1', 'stdout');
      expect(result.split('\n')[0]).toMatch(
        /^job:\/\/bash-4\/stdout:\d+-6 of 6 lines/u,
      );
      expect(result).toContain('6: f');
      expect(result).not.toContain('1: a');
    });

    it('reads a quiet output as empty', async () => {
      const s = script();

      s.find.mockResolvedValue(job());
      s.output.mockResolvedValue(Buffer.alloc(0));

      expect(text(await read('job://bash-4/stderr')).split('\n')[0]).toBe(
        'job://bash-4/stderr: empty',
      );
    });

    it('reads the artifact part when the job stored one', async () => {
      const s = script();

      s.find.mockResolvedValue(job({ artifactId: 'a1', state: 'failed' }));
      s.part.mockResolvedValue({
        contentType: 'text/plain',
        content: Buffer.from('from artifact\n'),
        lineCount: 1,
        findings: null,
      });

      expect(text(await read('job://bash-4/stdout'))).toContain(
        'from artifact',
      );
      expect(s.part).toHaveBeenCalledWith(CHAT, 'bash', 4, 'stdout');
      expect(s.output).not.toHaveBeenCalled();
    });

    it('falls back to the increments when the artifact lacks the part', async () => {
      const s = script();

      s.find.mockResolvedValue(job({ artifactId: 'a1' }));
      s.part.mockResolvedValue(undefined);
      s.output.mockResolvedValue(Buffer.from('chunk\n'));

      expect(text(await read('job://bash-4/stdout'))).toContain('chunk');
    });

    it('does not open the artifact of a job that stored none', async () => {
      const s = script();

      s.find.mockResolvedValue(job());
      s.output.mockResolvedValue(Buffer.from('x\n'));
      await read('job://bash-4/stdout');

      expect(s.part).not.toHaveBeenCalled();
    });

    it('answers invalid_selector for a malformed selector', async () => {
      const s = script();

      s.find.mockResolvedValue(job());
      s.output.mockResolvedValue(Buffer.from('x\n'));

      await expect(read('job://bash-4/stdout:0-0')).resolves.toMatchObject({
        status: 'error',
      });
    });
  });
});
