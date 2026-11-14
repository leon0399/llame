import { drizzle } from 'drizzle-orm/postgres-js';

import { ChatsRepository } from '../chats/chats-repository';
import { type ChatJob } from '../db/schema';
import * as schema from '../db/schema';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type ModelSelectionValidator } from '../models/models.service';
import { asDouble } from '../testing/support';
import { JobNoticeRunService } from './job-notice-run.service';

const CHAT_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = 'owner-1';

function job(state: ChatJob['state']): ChatJob {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    chatId: CHAT_ID,
    ownerUserId: OWNER_ID,
    executor: 'bash',
    seq: 4,
    state,
    stoppedBy: state === 'cancelled' ? 'owner' : null,
    runId: '11111111-1111-4111-8111-111111111111',
    toolCallId: 'call-4',
    workerInstanceId: '44444444-4444-4444-8444-444444444444',
    pid: null,
    startedAt: new Date('2026-11-12T12:00:00.000Z'),
    settledAt:
      state === 'running' ? null : new Date('2026-11-12T12:00:03.000Z'),
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result:
      state === 'running'
        ? null
        : state === 'lost'
          ? { outcomeUnknown: true }
          : { exitCode: 0 },
    outputs: ['stdout'],
    artifactId: null,
    artifactReadable: true,
    settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
  };
}

function service(woken: boolean) {
  const enqueue = vi.fn(() => Promise.resolve());
  const wake = vi.fn().mockResolvedValue(woken);

  const run = new JobNoticeRunService(
    asDouble<ModelSelectionValidator>({}),
    asDouble<InstanceConfigReader>({}),
    { enqueueInTransaction: enqueue },
    { wakeForChatInTransaction: wake },
  );

  return { run, enqueue, wake };
}

afterEach(() => vi.restoreAllMocks());

describe('JobNoticeRunService.startOnSettlement', () => {
  it('does not start a duplicate notice Run when settlement wakes a waiting Run', async () => {
    const tx = drizzle.mock({ schema });
    const { run, enqueue, wake } = service(true);

    const lockChat = vi
      .spyOn(ChatsRepository.prototype, 'lock')
      .mockResolvedValue(undefined);

    await run.startOnSettlement(tx, job('succeeded'));

    expect(wake).toHaveBeenCalledWith(tx, {
      chatId: CHAT_ID,
      userId: OWNER_ID,
      jobId: '22222222-2222-4222-8222-222222222222',
      kind: 'settlement',
    });
    expect(lockChat).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('locks the Chat when a settled notice does not wake a waiting Run', async () => {
    const tx = drizzle.mock({ schema });
    const { run, enqueue, wake } = service(false);

    const lockChat = vi
      .spyOn(ChatsRepository.prototype, 'lock')
      .mockResolvedValue(undefined);

    await run.startOnSettlement(tx, job('succeeded'));

    expect(wake).toHaveBeenCalled();
    expect(lockChat).toHaveBeenCalledWith(CHAT_ID, OWNER_ID);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'lost'] as const)(
    'does not start a notice Run for a %s job',
    async (state) => {
      const tx = drizzle.mock({ schema });
      const { run, enqueue, wake } = service(false);

      const lockChat = vi
        .spyOn(ChatsRepository.prototype, 'lock')
        .mockResolvedValue(undefined);

      await run.startOnSettlement(tx, job(state));

      expect(wake).toHaveBeenCalled();
      expect(lockChat).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );
});
