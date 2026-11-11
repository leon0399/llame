import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { type ChatJob } from '../db/schema';
import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { workerDeadAfterSeconds } from '../jobs/worker-liveness';
import { ChatsRepository } from './chats-repository';
import { notifyRunControl } from '../runs/run-control';

/**
 * The owner's view of the jobs of a Chat (background-jobs). Every read and
 * write runs in the owner's tenant scope, so a Chat or a job of another owner
 * is not found. Each request is a touch: a running job of a dead worker settles
 * as `lost` before the request answers.
 */
@Injectable()
export class ChatJobsService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
  ) {}

  /** The jobs of the Chat, the live jobs first, each group oldest first. */
  list(chatId: string, userId: string): Promise<Array<ChatJob>> {
    return this.tenantDb.runAs(userId, async (tx) => {
      const jobs = await this.touch(tx, chatId, userId);
      const rows = await jobs.listByChat(chatId, userId);

      return [
        ...rows.filter((job) => job.state === 'running'),
        ...rows.filter((job) => job.state !== 'running'),
      ];
    });
  }

  /**
   * Record a stop request from the owner on a running job. A repeat for a job
   * that the owner stopped answers with that job; a job in any other settled
   * state is a conflict, and a job of another Chat or owner is not found.
   */
  async stop(chatId: string, jobId: string, userId: string): Promise<ChatJob> {
    // The refusals are answered after the transaction commits: a thrown error
    // would roll back the `lost` settlement that the touch just recorded.
    const answer = await this.tenantDb.runAs(userId, async (tx) => {
      const jobs = await this.touch(tx, chatId, userId);
      const requested = await jobs.requestStop(chatId, userId, jobId, 'owner');

      if (requested) {
        await notifyRunControl(tx, { kind: 'job-stop', jobId });

        return { job: requested, stopped: true };
      }

      return {
        job: await jobs.findById(chatId, userId, jobId),
        stopped: false,
      };
    });

    const { job } = answer;

    if (!job) throw new NotFoundException(`Job ${jobId} not found`);

    if (
      answer.stopped ||
      (job.state === 'cancelled' && job.stoppedBy === 'owner')
    ) {
      return job;
    }

    throw new ConflictException(`The job is already ${job.state}`);
  }

  /**
   * The running jobs of each owned Chat on a worker that is not dead, for the
   * chat list. It joins the job to its worker and settles nothing.
   */
  runningCounts(userId: string): Promise<Map<string, number>> {
    return this.tenantDb.runAs(userId, (tx) =>
      new ChatJobsRepository(tx).countRunning(
        userId,
        workerDeadAfterSeconds(this.instanceConfig.config),
      ),
    );
  }

  private async touch(
    tx: Db,
    chatId: string,
    userId: string,
  ): Promise<ChatJobsRepository> {
    if (!(await new ChatsRepository(tx).findById(chatId, userId))) {
      throw new NotFoundException(`Chat ${chatId} not found`);
    }

    const jobs = new ChatJobsRepository(tx);

    await jobs.settleOnDeadWorkers(
      chatId,
      userId,
      workerDeadAfterSeconds(this.instanceConfig.config),
    );

    return jobs;
  }
}
