import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { isRecord } from '@workspace/runtime-safety';

import { chatDeliveries } from '../db/schema';
import { MessagesRepository } from '../chats/chats-repository';
import { waitFor } from '../testing/support';
import { RUNS_QUEUE } from './run-queues';
import { answer, call } from '../testing/run-segments.test-fixture';
import { settleBashJob } from '../jobs/bash-job-store';
import { JobNoticeRunService } from './job-notice-run.service';
import { PersonalizationService } from '../personalization/personalization.service';
import { eventPayloadString } from './run-event-payload';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedLiveChatJob,
  seedRun,
  type WorkerHarness,
} from './worker-harness';
import { RunEventsRepository, RunsRepository } from './runs-repository';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'wait-tool-recovery.integration.test.ts requires the integration database',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('wait tool native-queue recovery', () => {
  let harness: WorkerHarness | undefined;
  const queueSchema = `${process.env.LLAME_TEST_SCHEMA_PREFIX ?? 'llame_t'}_wait_recovery_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const directories: Array<string> = [];

  afterAll(async () => {
    await harness?.close();
    await Promise.all(directories.map((path) => rm(path, { recursive: true })));
  });

  it.each(['read', 'bash'] as const)(
    'recovers a real %s prefix after a post-claim worker failure without reusing its seed',
    async (prefixTool) => {
      await harness?.close();
      const directory = await mkdtemp(join(tmpdir(), 'wait-recovery-'));
      directories.push(directory);
      const path = join(directory, 'prefix.txt');
      await writeFile(path, prefixTool === 'read' ? 'original read value' : '');

      const options = {
        queueSchema,
        allowedTools: ['read', 'bash', 'wait'],
        nativeExecutorId: 'wait-recovery-host',
      };

      harness = await bootWorkerHarness(options);
      const ownerId = await createUser(harness.db, `recovery-${randomUUID()}`);
      const modelId = `recovery-${randomUUID()}`;

      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId: ownerId,
        modelId,
      });

      const job = await harness.tenantDb.runAs(ownerId, (tx) =>
        seedLiveChatJob({ tx, userId: ownerId, modelId, run: seeded }),
      );

      const steps = [
        call(
          'recovery-prefix',
          prefixTool,
          prefixTool === 'read'
            ? { path }
            : { command: 'printf x >> prefix.txt', cwd: directory },
        ),
        call('recovery-wait', 'wait', {
          jobs: ['job://bash-1'],
          timeout: 3600,
        }),
        answer('retry completed'),
      ];

      harness.models.register(modelId, { kind: 'step-script', steps });

      const originalJobId = await dispatchRun({
        queue: harness.queue,
        ...seeded,
        userId: ownerId,
        modelId,
      });

      if (originalJobId === null)
        throw new Error('Initial queue enqueue failed');
      await waitFor(
        async () => {
          const run = await harness!.tenantDb.runAs(ownerId, (tx) =>
            new RunsRepository(tx).findById(seeded.runId, ownerId),
          );

          return run?.status === 'awaiting_jobs' ? run : undefined;
        },
        20_000,
        'actual SDK wait to suspend',
      );
      await waitFor(
        async () =>
          (await harness!.queue.jobState(RUNS_QUEUE, originalJobId)) ===
          'completed'
            ? true
            : undefined,
        20_000,
        'original worker queue acknowledgement',
      );
      await harness.close();
      harness = await bootWorkerHarness({ ...options, runsConcurrency: null });
      await settleBashJob(
        harness.tenantDb,
        job,
        {
          output: {
            stdout: 'finished job',
            stderr: '',
            truncated: false,
            truncatedStreams: { stdout: false, stderr: false },
          },
          settlement: { state: 'succeeded', result: { exitCode: 0 } },
          offsets: { stdout: 0, stderr: 0 },
        },
        {
          maxBytes: 65_536,
          hostFiles: false,
          noticeRuns: harness.moduleRef.get(JobNoticeRunService),
        },
      );
      await harness.close();
      let injected = false;
      harness = await bootWorkerHarness({
        ...options,
        beforeInit: (models) => {
          models.register(modelId, {
            kind: 'step-script',
            steps: [answer('first wake must not reach provider')],
          });

          const failure = vi
            .spyOn(PersonalizationService.prototype, 'resolvePromptUser')
            .mockImplementationOnce(() => {
              failure.mockRestore();
              injected = true;
              models.register(modelId, { kind: 'step-script', steps });
              throw new Error('post-claim worker failure before dispatch');
            });
        },
      });

      const terminal = await waitFor(
        async () => {
          const run = await harness!.tenantDb.runAs(ownerId, (tx) =>
            new RunsRepository(tx).findById(seeded.runId, ownerId),
          );

          return run?.status === 'completed' || run?.status === 'failed'
            ? run
            : undefined;
        },
        40_000,
        'native queue retry after committed wait result',
      );

      expect(injected).toBe(true);

      const events = await harness.tenantDb.runAs(ownerId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.runId, ownerId),
      );

      expect(
        events.filter((event) => event.eventType === 'run.started'),
      ).toHaveLength(prefixTool === 'read' ? 3 : 2);
      expect(
        events.filter(
          (event) =>
            event.eventType === 'tool.started' &&
            eventPayloadString(event.payload, 'toolCallId') ===
              'recovery-prefix',
        ),
      ).toHaveLength(prefixTool === 'read' ? 2 : 1);

      if (prefixTool === 'bash') {
        expect(terminal).toMatchObject({
          status: 'failed',
          error: { code: 'outcome_unknown' },
        });
        expect(await readFile(path, 'utf8')).toBe('x');
        expect(harness.models.prompts).toHaveLength(0);
      } else {
        expect(terminal.status).toBe('completed');

        const [notice] = await harness.tenantDb.runAs(ownerId, (tx) =>
          tx
            .select({ id: chatDeliveries.id, state: chatDeliveries.state })
            .from(chatDeliveries)
            .where(eq(chatDeliveries.senderRef, job.id)),
        );

        expect(notice).toMatchObject({ state: 'delivered' });

        const waitResults = events.filter(
          (event) =>
            event.eventType === 'tool.completed' &&
            eventPayloadString(event.payload, 'toolCallId') === 'recovery-wait',
        );

        expect(waitResults[0]?.payload).toMatchObject({
          consumedJobNoticeIds: [notice?.id],
        });
        expect(waitResults.at(-1)?.payload).toMatchObject({
          consumedJobNoticeIds: [],
        });

        const messages = await harness.tenantDb.runAs(ownerId, (tx) =>
          new MessagesRepository(tx).findByChatId(seeded.chatId, ownerId),
        );

        const reply = messages.find((message) => message.role === 'assistant');
        expect(
          reply?.parts.filter(
            (part) =>
              isRecord(part) &&
              part['type'] === 'tool-read' &&
              part['toolCallId'] === 'recovery-prefix',
          ),
        ).toHaveLength(1);
      }
    },
  );
});
