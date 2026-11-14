import { randomUUID } from 'node:crypto';
import { ModelNotAvailableError } from '../models/models.service';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { settleBashJob } from '../jobs/bash-job-store';
import { waitFor } from '../testing/support';
import { JobNoticeRunService } from './job-notice-run.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RUNS_QUEUE } from './run-queues';
import { RunsController } from './runs.controller';
import { eventPayloadString } from './run-event-payload';
import { answer, call } from '../testing/run-segments.test-fixture';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedLiveChatJob,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'wait-tool-pickup.integration.test.ts requires the integration database',
  );
}

vi.setConfig({ testTimeout: 90_000 });

type PickupCase =
  | 'cancelled'
  | 'expired'
  | 'model-unavailable'
  | 'deadlettered';

describe('wait settlement before cold wake pickup', () => {
  let harness: WorkerHarness | undefined;
  const queueSchema = `${process.env.LLAME_TEST_SCHEMA_PREFIX ?? 'llame_t'}_wait_pickup_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

  afterAll(async () => {
    await harness?.close();
  });

  async function pendingNotice(ownerId: string, chatId: string, jobId: string) {
    return harness!.tenantDb.runAs(ownerId, async (tx) =>
      (
        await new ChatDeliveriesRepository(tx).listPending(chatId, ownerId)
      ).find(({ senderRef }) => senderRef === jobId),
    );
  }

  it.each([
    'cancelled',
    'expired',
    'model-unavailable',
    'deadlettered',
  ] as const)(
    'retains the settlement notice when a real wait wake is picked up as %s',
    async (pickupCase: PickupCase) => {
      await harness?.close();
      const modelId = `wait-pickup-${pickupCase}-${randomUUID()}`;
      harness = await bootWorkerHarness({
        queueSchema,
        runsConcurrency: 1,
        allowedTools: ['wait'],
        beforeInit: (models) =>
          models.register(modelId, {
            kind: 'step-script',
            steps: [
              [
                ...call('pickup-wait', 'wait', {
                  jobs: ['job://bash-1'],
                  timeout: 3600,
                }),
              ],
              answer('must not commit the wait result'),
            ],
          }),
      });

      const ownerId = await createUser(
        harness.db,
        `wait-pickup-${pickupCase}-${randomUUID()}`,
      );

      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId: ownerId,
        modelId,
        text: 'wait for the background job',
      });

      const job = await harness.tenantDb.runAs(ownerId, (tx) =>
        seedLiveChatJob({
          tx,
          userId: ownerId,
          modelId,
          run: seeded,
        }),
      );

      const initialJobId = await dispatchRun({
        queue: harness.queue,
        ...seeded,
        userId: ownerId,
        modelId,
      });

      if (!initialJobId) throw new Error('Initial Run dispatch was not queued');

      await waitFor(
        async () => {
          const run = await harness!.tenantDb.runAs(ownerId, (tx) =>
            new RunsRepository(tx).findById(seeded.runId, ownerId),
          );

          if (run?.finishedAt !== null && run?.finishedAt !== undefined)
            throw new Error(
              JSON.stringify({ status: run.status, error: run.error }),
            );

          return run?.status === 'awaiting_jobs' ? run : undefined;
        },
        20_000,
        'the real SDK wait call to suspend its Run',
      );
      await waitFor(
        async () =>
          (await harness!.queue.jobState(RUNS_QUEUE, initialJobId)) ===
          'completed'
            ? true
            : undefined,
        20_000,
        'the initial worker to acknowledge the suspended Run',
      );

      const suspended = await harness.tenantDb.runAs(ownerId, (tx) =>
        new RunsRepository(tx).findById(seeded.runId, ownerId),
      );

      if (!suspended?.currentJobId) throw new Error('Run has no deadline job');

      // Close the worker graph, then settle through the production settlement
      // transaction in an API-only graph. Its notice and wake are committed
      // before any consumer can pick up the wake.
      await harness.close();
      harness = await bootWorkerHarness({
        queueSchema,
        runsConcurrency: null,
        allowedTools: ['wait'],
        timeoutSeconds: pickupCase === 'expired' ? 1 : 3600,
      });
      await settleBashJob(
        harness.tenantDb,
        job,
        {
          output: {
            stdout: 'cold pickup settled output',
            stderr: '',
            truncated: false,
            truncatedStreams: { stdout: false, stderr: false },
          },
          settlement: { state: 'failed', result: { exitCode: 1 } },
          offsets: { stdout: 0, stderr: 0 },
        },
        {
          maxBytes: 65_536,
          hostFiles: false,
          noticeRuns: harness.moduleRef.get(JobNoticeRunService),
        },
      );

      const woken = await harness.tenantDb.runAs(ownerId, (tx) =>
        new RunsRepository(tx).findById(seeded.runId, ownerId),
      );

      if (!woken?.currentJobId) throw new Error('Settlement has no wake job');
      expect(woken.status).toBe('queued');
      expect(await harness.queue.jobState(RUNS_QUEUE, woken.currentJobId)).toBe(
        'queued',
      );
      expect(await pendingNotice(ownerId, seeded.chatId, job.id)).toBeDefined();

      if (pickupCase === 'cancelled') {
        await harness.moduleRef
          .get(RunsController, { strict: false })
          .updateRun(ownerId, seeded.runId, { status: 'cancelled' });
      } else if (pickupCase === 'expired') {
        await waitFor(
          async () => {
            const started = await harness!.tenantDb.runAs(ownerId, (tx) =>
              new RunEventsRepository(tx).findFirstByType(
                seeded.runId,
                ownerId,
                'run.started',
              ),
            );

            return started && Date.now() - started.createdAt.getTime() >= 1500
              ? true
              : undefined;
          },
          5000,
          'the original claim budget to elapse before wake pickup',
        );
      }

      await harness.close();
      harness = await bootWorkerHarness({
        queueSchema,
        runsConcurrency: 1,
        allowedTools: ['wait'],
        timeoutSeconds: pickupCase === 'expired' ? 1 : 3600,
        beforeInit: (models) => {
          if (pickupCase === 'model-unavailable') {
            vi.spyOn(models, 'createClient').mockImplementation(() => {
              throw new ModelNotAvailableError(modelId);
            });
          } else if (pickupCase === 'deadlettered') {
            models.register(modelId, {
              kind: 'infra-throw',
              message:
                'simulated infrastructure failure before model execution',
            });
          } else if (pickupCase === 'expired') {
            models.register(modelId, {
              kind: 'complete',
              text: 'must not execute after expiry',
            });
          }
        },
      });

      const terminalStatus =
        pickupCase === 'cancelled'
          ? 'cancelled'
          : pickupCase === 'model-unavailable'
            ? 'failed'
            : 'expired';

      await waitFor(
        async () => {
          const run = await harness!.tenantDb.runAs(ownerId, (tx) =>
            new RunsRepository(tx).findById(seeded.runId, ownerId),
          );

          return run?.status === terminalStatus ? run : undefined;
        },
        60_000,
        `cold pickup to terminate the Run as ${terminalStatus}`,
      );

      const events = await harness.tenantDb.runAs(ownerId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.runId, ownerId),
      );

      expect(
        events.filter(
          (event) =>
            event.eventType === 'tool.completed' &&
            eventPayloadString(event.payload, 'toolCallId') === 'pickup-wait' &&
            eventPayloadString(event.payload, 'status') === 'success',
        ),
      ).toHaveLength(0);

      if (pickupCase === 'deadlettered') {
        expect(
          await harness.queue.jobState(RUNS_QUEUE, woken.currentJobId),
        ).toBe('failed');
        expect(
          events.find((event) => event.eventType === 'run.expired')?.payload,
        ).toMatchObject({
          message:
            'Run retries exhausted: the worker repeatedly failed to complete it.',
        });
      }

      expect(await pendingNotice(ownerId, seeded.chatId, job.id)).toBeDefined();
      expect(harness.models.prompts).toHaveLength(0);
    },
  );
});
