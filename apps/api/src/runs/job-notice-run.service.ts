import { and, eq, isNull } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { toRunUserMessage } from '../chats/chat-message-parts';
import { createRunForMessage, runSelectionFields } from '../chats/run-creation';
import { type ChatDelivery, type ChatJob, runs, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { type ChatModelSelection } from '../models/model-selection';
import {
  ModelsService,
  type ModelSelectionValidator,
} from '../models/models.service';
import {
  type ItemRunResolution,
  tryResolveItemRunSettings,
} from './queue-promotion';
import { type RunJob } from './run-queues';
import { RunDispatchService } from './run-dispatch.service';
import { RunsRepository } from './runs-repository';
import { RunWaitService } from './run-wait.service';
import { type RunUserMessage } from './run-execution.service';

type ChatOwner = Pick<ChatJob, 'chatId' | 'ownerUserId'>;

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

  async startAfterRunCompletion(tx: Db, owner: ChatOwner): Promise<void> {
    const chat = await new ChatsRepository(tx).lock(
      owner.chatId,
      owner.ownerUserId,
    );

    if (chat === undefined || chat.archivedAt !== null) return;

    const deliveries = new ChatDeliveriesRepository(tx);

    // Only a notice that could start a Run on settlement starts one here; a
    // cancelled or lost job's notice waits for the owner's next turn.
    const pending = await deliveries.listPendingViews(
      owner.chatId,
      owner.ownerUserId,
    );

    if (!pending.some(({ job }) => job !== null && startsNoticeRun(job))) {
      return;
    }

    await this.startNoticeRunForIdleChat(tx, {
      owner,
      deliveries,
      runs: new RunsRepository(tx),
      stored: chat.modelSelection,
    });
  }

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

    await this.startNoticeRunForIdleChat(tx, {
      owner: job,
      deliveries,
      runs,
      stored: chat.modelSelection,
    });
  }

  /** Start the first pending notice only after the latest Run completed. */
  private async startNoticeRunForIdleChat(
    tx: Db,
    context: {
      owner: ChatOwner;
      deliveries: ChatDeliveriesRepository;
      runs: RunsRepository;
      stored: ChatModelSelection | null;
    },
  ): Promise<void> {
    const { owner, deliveries, runs, stored } = context;

    const latestRun = await runs.findLatestByChatId(
      owner.chatId,
      owner.ownerUserId,
    );

    if (latestRun?.status !== 'completed') return;

    const first = await deliveries.lockFirstPendingJobNotice(
      owner.chatId,
      owner.ownerUserId,
    );

    if (first === undefined) return;

    await this.startHostRun(tx, { owner, first, deliveries, stored });
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
    context: {
      owner: ChatOwner;
      first: ChatDelivery;
      deliveries: ChatDeliveriesRepository;
      stored: ChatModelSelection | null;
    },
  ): Promise<void> {
    const { owner, first, deliveries, stored } = context;

    const resolved = tryResolveItemRunSettings({
      models: this.models,
      enabledPermissionModes: this.instanceConfig.config.tools.permissionModes,
      settings: first.settings,
      stored,
    });

    if (resolved === undefined) return;

    const runJob = await this.createHostRun(tx, owner, resolved);

    await deliveries.deliverPendingJobNotices(owner.chatId, owner.ownerUserId, {
      messageId: runJob.userMessage.id,
      runId: runJob.runId,
    });

    await this.dispatch.enqueueInTransaction(tx, runJob);
  }

  private async createHostRun(
    tx: Db,
    owner: ChatOwner,
    resolved: ItemRunResolution,
  ): Promise<RunJob & { userMessage: RunUserMessage }> {
    const message = await new MessagesRepository(tx).create({
      id: randomUUID(),
      chatId: owner.chatId,
      role: 'user',
      senderUserId: null,
      parts: [],
    });

    const { run } = await createRunForMessage(
      tx,
      {
        userId: owner.ownerUserId,
        chatId: owner.chatId,
        ...runSelectionFields(resolved),
        targetRunId: randomUUID(),
      },
      message,
    );

    return {
      runId: run.id,
      chatId: owner.chatId,
      userId: owner.ownerUserId,
      modelId: resolved.modelId,
      userMessage: toRunUserMessage(message),
    };
  }
}

/** A settled job whose notice may start a host Run on an idle Chat
 *  (background-jobs: a cancelled or lost job starts no Run). */
const RUN_STARTING_JOB_STATES: ReadonlyArray<ChatJob['state']> = [
  'succeeded',
  'failed',
  'timed_out',
];

function startsNoticeRun(job: Pick<ChatJob, 'state'>): boolean {
  return RUN_STARTING_JOB_STATES.includes(job.state);
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
