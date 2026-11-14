import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { RunRowFenceRepository } from './run-row-fence.repository';
import {
  answer,
  call,
  useSegmentsFixture as createSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import type { ScriptedStep } from './scripted-model-step';
import { dispatchRun } from './worker-harness';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'run-delivery-retry.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}

const fx = createSegmentsFixture('run-delivery-retry', {
  allowedTools: ['read'],
});

const { seed, storeItems, terminal, events } = fx;

async function enqueueOnce(
  seeded: SeededRun,
  steps: ReadonlyArray<ScriptedStep>,
  beforeStep: (index: number) => Promise<void>,
) {
  fx.harness.models.register(seeded.modelId, {
    kind: 'step-script',
    steps,
    beforeStep,
  });
  await dispatchRun({
    queue: fx.harness.queue,
    ...seeded,
    userId: fx.userId,
    enqueueOptions: { retryLimit: 0 },
  });
}

describe('run delivery transaction retry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retries a rolled-back step-boundary delivery and commits it once', async () => {
    const lockForDelivery = vi.spyOn(
      RunRowFenceRepository.prototype,
      'lockForDelivery',
    );

    let boundaryAttemptId: string | undefined;

    const lockPendingSteering = vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'lockPendingSteering',
    );

    lockPendingSteering.mockImplementationOnce(() => {
      boundaryAttemptId = lockForDelivery.mock.calls.at(-1)?.[2];

      return Promise.reject(
        Object.assign(new Error('serialization failure'), {
          code: '40001',
        }),
      );
    });
    const seeded = await seed();
    await enqueueOnce(
      seeded,
      [
        call('read-at-boundary', 'read', { path: fx.directory }),
        answer('after'),
      ],
      async (index) => {
        if (index === 0) {
          await storeItems(seeded.chatId, ['at the boundary'], 'interrupt');
        }
      },
    );

    expect((await terminal(seeded.runId)).status).toBe('completed');
    expect(boundaryAttemptId).toBeDefined();
    expect(
      lockForDelivery.mock.calls.filter(
        ([, , attemptId]) => attemptId === boundaryAttemptId,
      ),
    ).toHaveLength(2);
    expect(
      (await events(seeded.runId)).filter(
        (event) => event.eventType === 'run.delivered',
      ),
    ).toHaveLength(1);
  });

  it('does not replay a step-boundary delivery on a non-retryable failure', async () => {
    const lockForDelivery = vi.spyOn(
      RunRowFenceRepository.prototype,
      'lockForDelivery',
    );

    let boundaryAttemptId: string | undefined;

    const lockPendingSteering = vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'lockPendingSteering',
    );

    lockPendingSteering.mockImplementationOnce(() => {
      boundaryAttemptId = lockForDelivery.mock.calls.at(-1)?.[2];

      return Promise.reject(
        Object.assign(new Error('connection lost'), { code: '08006' }),
      );
    });

    const seeded = await seed();
    await enqueueOnce(
      seeded,
      [
        call('read-at-boundary', 'read', { path: fx.directory }),
        answer('after'),
      ],
      async (index) => {
        if (index === 0) {
          await storeItems(seeded.chatId, ['at the boundary'], 'interrupt');
        }
      },
    );

    await terminal(seeded.runId);
    expect(boundaryAttemptId).toBeDefined();
    expect(
      lockForDelivery.mock.calls.filter(
        ([, , attemptId]) => attemptId === boundaryAttemptId,
      ),
    ).toHaveLength(1);
  });

  it('bounds retries for a persistently aborted step-boundary delivery', async () => {
    const lockForDelivery = vi.spyOn(
      RunRowFenceRepository.prototype,
      'lockForDelivery',
    );

    let boundaryAttemptId: string | undefined;

    const lockPendingSteering = vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'lockPendingSteering',
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      lockPendingSteering.mockImplementationOnce(() => {
        boundaryAttemptId ??= lockForDelivery.mock.calls.at(-1)?.[2];

        return Promise.reject(
          Object.assign(new Error('deadlock detected'), { code: '40P01' }),
        );
      });
    }

    const seeded = await seed();
    await enqueueOnce(
      seeded,
      [
        call('read-at-boundary', 'read', { path: fx.directory }),
        answer('after'),
      ],
      async (index) => {
        if (index === 0) {
          await storeItems(seeded.chatId, ['at the boundary'], 'interrupt');
        }
      },
    );

    await terminal(seeded.runId);
    expect(boundaryAttemptId).toBeDefined();
    expect(
      lockForDelivery.mock.calls.filter(
        ([, , attemptId]) => attemptId === boundaryAttemptId,
      ),
    ).toHaveLength(3);
  });
});
