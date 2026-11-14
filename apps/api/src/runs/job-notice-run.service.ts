import { and, eq, isNull } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { toRunUserMessage } from '../chats/chat-message-parts';
import { createRunForMessage } from '../chats/run-creation';
import {
  type ChatDelivery,
  type ChatDeliverySettings,
  type ChatJob,
  runs,
  type Run,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import {
  ModelsService,
  resolveSendSettings,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type RunJob } from './run-queues';
import { RunDispatchService } from './run-dispatch.service';
import { RunsRepository } from './runs-repository';
import { RunWaitService } from './run-wait.service';

@Injectable()
export class JobNoticeRunService {
  constructor(
    @Inject(ModelsService)
    private readonly models: ModelSelectionValidator,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(RunDispatchService)
    private readonly dispatch: Pick<RunDispatchService, 'enqueueInTransaction'>,
    @Inject(RunWaitService)
    private readonly runWait: Pick<RunWaitService, 'wakeForChatInTransaction'>,
  ) {}

  async startOnSettlement(tx: Db, job: ChatJob): Promise<void> {
    const waitingRunWoken = await this.runWait.wakeForChatInTransaction(tx, {
      chatId: job.chatId,
      userId: job.ownerUserId,
      jobId: job.id,
      kind: 'settlement',
    });

    if (waitingRunWoken || !startsNoticeRun(job)) return;

    const chat = await new ChatsRepository(tx).lock(
      job.chatId,
      job.ownerUserId,
    );

    if (chat === undefined || chat.archivedAt !== null) return;

    const deliveries = new ChatDeliveriesRepository(tx);

    const runs = new RunsRepository(tx);

    const activeRun = await runs.findActiveByChatId(
      job.chatId,
      job.ownerUserId,
    );

    if (activeRun !== undefined) {
      await this.attachToQueuedHostRun(tx, job, activeRun, deliveries);

      return;
    }

    await this.startNoticeRunForIdleChat(tx, job, deliveries, runs);
  }

  /** Start the first pending notice only after the latest Run completed. */
  private async startNoticeRunForIdleChat(
    tx: Db,
    job: ChatJob,
    deliveries: ChatDeliveriesRepository,
    runs: RunsRepository,
  ): Promise<void> {
    const latestRun = await runs.findLatestByChatId(
      job.chatId,
      job.ownerUserId,
    );

    if (latestRun?.status !== 'completed') return;

    const first = await deliveries.lockFirstPendingJobNotice(
      job.chatId,
      job.ownerUserId,
    );

    if (first === undefined) return;

    await this.startHostRun(tx, job, first, deliveries);
  }

  private async attachToQueuedHostRun(
    tx: Db,
    job: ChatJob,
    activeRun: Run,
    deliveries: ChatDeliveriesRepository,
  ): Promise<void> {
    if (
      activeRun.status !== 'queued' ||
      activeRun.followUpAction !== null ||
      activeRun.cancelRequestedAt !== null
    )
      return;

    const queuedRun = await lockQueuedHostRun(
      tx,
      activeRun.id,
      job.ownerUserId,
    );

    if (queuedRun?.messageId == null) return;

    const trigger = await new MessagesRepository(tx).findById(
      job.chatId,
      job.ownerUserId,
      queuedRun.messageId,
    );

    if (
      trigger === undefined ||
      trigger.role !== 'user' ||
      trigger.senderUserId !== null
    )
      return;

    await deliveries.deliverPendingJobNotices(job.chatId, job.ownerUserId, {
      messageId: trigger.id,
      runId: queuedRun.id,
    });
  }

  private async startHostRun(
    tx: Db,
    job: ChatJob,
    first: ChatDelivery,
    deliveries: ChatDeliveriesRepository,
  ): Promise<void> {
    const resolved = validateNoticeSettings(
      this.models,
      this.instanceConfig,
      first.settings,
    );

    if (resolved === undefined) return;

    const runJob = await this.createHostRun(tx, job, {
      ...first.settings,
      effort: resolved.effort,
      permissionMode: resolved.permissionMode,
    });

    await deliveries.deliverPendingJobNotices(job.chatId, job.ownerUserId, {
      messageId: runJob.userMessage.id,
      runId: runJob.runId,
    });
    await this.dispatch.enqueueInTransaction(tx, runJob);
  }

  private async createHostRun(
    tx: Db,
    job: ChatJob,
    settings: ChatDeliverySettings,
  ): Promise<RunJob> {
    const message = await new MessagesRepository(tx).create({
      id: randomUUID(),
      chatId: job.chatId,
      role: 'user',
      senderUserId: null,
      parts: [],
    });

    const { run } = await createRunForMessage(
      tx,
      {
        userId: job.ownerUserId,
        chatId: job.chatId,
        modelId: settings.modelId,
        effort: settings.effort,
        permissionMode: settings.permissionMode,
        targetRunId: randomUUID(),
      },
      message,
    );

    return {
      runId: run.id,
      chatId: job.chatId,
      userId: job.ownerUserId,
      modelId: settings.modelId,
      userMessage: toRunUserMessage(message),
    };
  }
}

function startsNoticeRun(job: ChatJob): boolean {
  return (
    job.state === 'succeeded' ||
    job.state === 'failed' ||
    job.state === 'timed_out'
  );
}

function validateNoticeSettings(
  models: ModelSelectionValidator,
  instanceConfig: InstanceConfigReader,
  settings: ChatDeliverySettings,
) {
  try {
    return resolveSendSettings(
      models,
      instanceConfig.config.tools.permissionModes,
      settings,
    );
  } catch {
    return undefined;
  }
}

async function lockQueuedHostRun(
  tx: Db,
  runId: string,
  ownerUserId: string,
): Promise<Run | undefined> {
  const rows = await tx
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.userId, ownerUserId),
        eq(runs.status, 'queued'),
        isNull(runs.followUpAction),
        isNull(runs.cancelRequestedAt),
      ),
    )
    .for('update');

  return rows[0];
}
