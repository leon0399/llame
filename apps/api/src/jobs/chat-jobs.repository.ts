/**
 * Owner-scoped access to `chat_jobs`. Daemon settlement is fenced by the
 * running state so a daemon fact can never overwrite a settled job.
 */
import { and, asc, count, eq, sql, type SQL } from 'drizzle-orm';

import {
  chatJobs,
  runEvents,
  type ChatDeliverySettings,
  type ChatJob,
  type ChatJobResult,
  type ChatJobStopper,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export type NewChatJob = {
  readonly id?: string;
  readonly chatId: string;
  readonly ownerUserId: string;
  readonly kind: string;
  readonly seq: number;
  readonly runId: string;
  readonly toolCallId: string;
  readonly machineName: string;
  readonly daemonInstanceId: string;
  readonly daemonJobId: string;
  readonly startedAt?: Date;
  readonly deadlineAt?: Date;
  readonly outputs: ReadonlyArray<string>;
  readonly artifactReadable: boolean;
  readonly settings: ChatDeliverySettings;
  readonly delivery?: 'foreground' | 'background';
};

export type JobSettlement =
  | {
      readonly state: 'succeeded' | 'failed' | 'timed_out' | 'lost';
      readonly result?: ChatJobResult;
      readonly artifactId?: string;
    }
  | {
      readonly state: 'cancelled';
      readonly stoppedBy: ChatJobStopper;
      readonly result?: ChatJobResult;
      readonly artifactId?: string;
    };

export class ChatJobsRepository {
  constructor(private readonly db: Db) {}

  async insert(job: NewChatJob): Promise<ChatJob> {
    const [row] = await this.db
      .insert(chatJobs)
      .values({ ...job, outputs: [...job.outputs] })
      .returning();

    return row;
  }

  async findById(
    chatId: string,
    ownerUserId: string,
    jobId: string,
  ): Promise<ChatJob | undefined> {
    const [row] = await this.db
      .select()
      .from(chatJobs)
      .where(
        and(
          jobInChat(chatId, ownerUserId, jobId),
          eq(chatJobs.delivery, 'background'),
        ),
      );

    return row;
  }

  async findByLocator(
    chatId: string,
    ownerUserId: string,
    kind: string,
    seq: number,
  ): Promise<ChatJob | undefined> {
    const [row] = await this.db
      .select()
      .from(chatJobs)
      .where(
        and(
          inChat(chatId, ownerUserId),
          eq(chatJobs.kind, kind),
          eq(chatJobs.seq, seq),
          eq(chatJobs.delivery, 'background'),
        ),
      );

    return row;
  }

  async findByDaemonJob(
    ownerUserId: string,
    daemonInstanceId: string,
    daemonJobId: string,
  ): Promise<ChatJob | undefined> {
    const [row] = await this.db
      .select()
      .from(chatJobs)
      .where(
        and(
          eq(chatJobs.ownerUserId, ownerUserId),
          eq(chatJobs.daemonInstanceId, daemonInstanceId),
          eq(chatJobs.daemonJobId, daemonJobId),
        ),
      );

    return row;
  }
  async findByOwnerDaemonJob(
    ownerUserId: string,
    daemonJobId: string,
  ): Promise<ChatJob | undefined> {
    const [row] = await this.db
      .select()
      .from(chatJobs)
      .where(
        and(
          eq(chatJobs.ownerUserId, ownerUserId),
          eq(chatJobs.daemonJobId, daemonJobId),
        ),
      );

    return row;
  }

  async promoteToBackground(
    chatId: string,
    ownerUserId: string,
    jobId: string,
  ): Promise<ChatJob | undefined> {
    const [row] = await this.db
      .update(chatJobs)
      .set({ delivery: 'background' })
      .where(
        and(
          jobInChat(chatId, ownerUserId, jobId),
          eq(chatJobs.state, 'running'),
          eq(chatJobs.delivery, 'foreground'),
        ),
      )
      .returning();

    return row;
  }

  listBindingsByChat(
    chatId: string,
    ownerUserId: string,
  ): Promise<Array<ChatJob>> {
    return this.db
      .select()
      .from(chatJobs)
      .where(inChat(chatId, ownerUserId))
      .orderBy(asc(chatJobs.startedAt), asc(chatJobs.seq));
  }
  listByChat(chatId: string, ownerUserId: string): Promise<Array<ChatJob>> {
    return this.db
      .select()
      .from(chatJobs)
      .where(
        and(inChat(chatId, ownerUserId), eq(chatJobs.delivery, 'background')),
      )
      .orderBy(asc(chatJobs.startedAt), asc(chatJobs.seq));
  }

  async hasCreatingAttempt(
    chatId: string,
    ownerUserId: string,
    jobId: string,
  ): Promise<boolean> {
    const [job] = await this.db
      .select({
        runId: chatJobs.runId,
        toolCallId: chatJobs.toolCallId,
      })
      .from(chatJobs)
      .where(jobInChat(chatId, ownerUserId, jobId));

    if (job === undefined) return false;

    const [result] = await this.db
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, job.runId),
          eq(runEvents.eventType, 'native.result'),
          sql`${runEvents.payload}->>'toolCallId' = ${job.toolCallId}`,
        ),
      )
      .limit(1);

    return result === undefined;
  }

  async settle(
    chatId: string,
    ownerUserId: string,
    jobId: string,
    settlement: JobSettlement,
  ): Promise<ChatJob | undefined> {
    const [row] = await this.db
      .update(chatJobs)
      .set({
        state: settlement.state,
        stoppedBy:
          settlement.state === 'cancelled' ? settlement.stoppedBy : null,
        result: settlement.result ?? null,
        artifactId: settlement.artifactId ?? null,
        settledAt: sql`now()`,
      })
      .where(
        and(
          jobInChat(chatId, ownerUserId, jobId),
          eq(chatJobs.state, 'running'),
        ),
      )
      .returning();

    return row;
  }

  async deleteRunning(
    chatId: string,
    ownerUserId: string,
    jobId: string,
  ): Promise<void> {
    await this.db
      .delete(chatJobs)
      .where(
        and(
          jobInChat(chatId, ownerUserId, jobId),
          eq(chatJobs.state, 'running'),
        ),
      );
  }

  async requestStop(
    chatId: string,
    ownerUserId: string,
    jobId: string,
    by: ChatJobStopper,
  ): Promise<ChatJob | undefined> {
    const [row] = await this.db
      .update(chatJobs)
      .set({
        stopRequestedAt: sql`coalesce(${chatJobs.stopRequestedAt}, now())`,
        stopRequestedBy: sql`coalesce(${chatJobs.stopRequestedBy}, ${by})`,
      })
      .where(
        and(
          jobInChat(chatId, ownerUserId, jobId),
          eq(chatJobs.state, 'running'),
        ),
      )
      .returning();

    return row;
  }

  async runningIdsInChat(
    chatId: string,
    ownerUserId: string,
  ): Promise<Array<string>> {
    const rows = await this.db
      .select({ id: chatJobs.id })
      .from(chatJobs)
      .where(
        and(
          inChat(chatId, ownerUserId),
          eq(chatJobs.state, 'running'),
          eq(chatJobs.delivery, 'background'),
        ),
      );

    return rows.map((row) => row.id);
  }
  async countRunning(ownerUserId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ chatId: chatJobs.chatId, running: count(chatJobs.id) })
      .from(chatJobs)
      .where(
        and(
          eq(chatJobs.ownerUserId, ownerUserId),
          eq(chatJobs.state, 'running'),
          eq(chatJobs.delivery, 'background'),
        ),
      )
      .groupBy(chatJobs.chatId);

    return new Map(rows.map((row) => [row.chatId, row.running]));
  }
}

function inChat(chatId: string, ownerUserId: string): SQL | undefined {
  return and(
    eq(chatJobs.chatId, chatId),
    eq(chatJobs.ownerUserId, ownerUserId),
  );
}

function jobInChat(
  chatId: string,
  ownerUserId: string,
  jobId: string,
): SQL | undefined {
  return and(eq(chatJobs.id, jobId), inChat(chatId, ownerUserId));
}
