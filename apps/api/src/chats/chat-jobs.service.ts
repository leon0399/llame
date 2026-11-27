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
import { retryRunTransaction } from '../runs/run-transaction';
import { notifyRunControl } from '../runs/run-control';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { ChatsRepository } from './chats-repository';

/** The most of one output a response carries: its last 64 KiB. */
export const JOB_OUTPUT_RESPONSE_BYTES = 64 * 1024;

export type ChatJobOutputPart = {
  readonly name: string;
  readonly content: string;
  readonly cut: boolean;
  /** Bytes of the stream as stored, before the response bound. */
  readonly size: number;
};

/** A settled job's output: its stored streams, or none was stored. */
export type ChatJobOutput =
  | {
      readonly status: 'stored';
      readonly outputs: ReadonlyArray<ChatJobOutputPart>;
    }
  | { readonly status: 'unavailable' };

/** The last bound of an output, starting on a whole line when it is cut. */
function outputTail(content: Buffer): Omit<ChatJobOutputPart, 'name'> {
  const size = content.length;

  if (size <= JOB_OUTPUT_RESPONSE_BYTES) {
    return { content: content.toString('utf8'), cut: false, size };
  }

  const tail = content.subarray(size - JOB_OUTPUT_RESPONSE_BYTES);
  const lineStart = tail.indexOf(0x0a);

  return {
    content: tail.subarray(lineStart + 1).toString('utf8'),
    cut: true,
    size,
  };
}

/**
 * The owner's view of the jobs of a Chat. Every read and write runs in the
 * owner's tenant scope, so a Chat or a job of another owner is not found.
 */
@Injectable()
export class ChatJobsService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
  ) {}

  /** The jobs of the Chat, the live jobs first, each group oldest first. */
  list(chatId: string, userId: string): Promise<Array<ChatJob>> {
    return retryRunTransaction(() =>
      this.tenantDb.runAs(userId, async (tx) => {
        const jobs = await this.touch(tx, chatId, userId);
        const rows = await jobs.listByChat(chatId, userId);

        return [
          ...rows.filter((job) => job.state === 'running'),
          ...rows.filter((job) => job.state !== 'running'),
        ];
      }),
    );
  }

  /**
   * The stored outputs of a settled job, as its artifact holds them. A running
   * job is a conflict: its output lives on the Machine until it settles.
   */
  async output(
    chatId: string,
    jobId: string,
    userId: string,
  ): Promise<ChatJobOutput> {
    const answer = await this.tenantDb.runAs(userId, async (tx) => {
      const job = await (
        await this.touch(tx, chatId, userId)
      ).findById(chatId, userId, jobId);

      if (job === undefined || job.state === 'running') return job;

      if (job.artifactId === null) return { status: 'unavailable' as const };

      const artifacts = new ArtifactsRepository(tx);
      const outputs: Array<ChatJobOutputPart> = [];

      for (const name of job.outputs) {
        const part = await artifacts.readPart(chatId, job.kind, job.seq, name);

        if (part !== undefined)
          outputs.push({ name, ...outputTail(part.content) });
      }

      return { status: 'stored' as const, outputs };
    });

    if (answer === undefined)
      throw new NotFoundException(`Job ${jobId} not found`);

    if ('state' in answer) {
      throw new ConflictException('The job is still running');
    }

    return answer;
  }

  /**
   * Record a stop request from the owner on a running job. A repeat for a job
   * that the owner stopped answers with that job; a job in any other settled
   * state is a conflict, and a job of another Chat or owner is not found.
   */
  async stop(chatId: string, jobId: string, userId: string): Promise<ChatJob> {
    // The refusals are answered after the transaction commits: a thrown error
    // would roll back the `lost` settlement that the touch just recorded.
    const answer = await retryRunTransaction(() =>
      this.tenantDb.runAs(userId, async (tx) => {
        const jobs = await this.touch(tx, chatId, userId);

        const requested = await jobs.requestStop(
          chatId,
          userId,
          jobId,
          'owner',
        );

        if (requested) {
          await notifyRunControl(tx, { kind: 'job-stop', jobId });

          return { job: requested, stopped: true };
        }

        return {
          job: await jobs.findById(chatId, userId, jobId),
          stopped: false,
        };
      }),
    );

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

  /** Running jobs for each owned Chat, independent of worker liveness. */
  runningCounts(userId: string): Promise<Map<string, number>> {
    return this.tenantDb.runAs(userId, (tx) =>
      new ChatJobsRepository(tx).countRunning(userId),
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

    return new ChatJobsRepository(tx);
  }
}
