/**
 * ChatJobsRepository — owner-scoped access to `chat_jobs` and its stored output
 * (background-jobs D1). Every query names the owner and, where it concerns one
 * Chat, the Chat, as defense-in-depth beside the forced RLS policy.
 */

import { and, asc, count, eq, gt, notExists, sql, type SQL } from 'drizzle-orm';

import {
  chatJobChunks,
  chatJobs,
  workerInstances,
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
  readonly executor: string;
  /** A number from `ArtifactsRepository.nextSeq` (background-jobs D2). */
  readonly seq: number;
  readonly runId: string;
  readonly toolCallId: string;
  readonly workerInstanceId: string;
  readonly pid?: number;
  readonly startedAt?: Date;
  readonly deadlineAt?: Date;
  readonly outputs: ReadonlyArray<string>;
  readonly artifactReadable: boolean;
  readonly settings: ChatDeliverySettings;
};

/** How a running job ends; a `cancelled` job always names its stopper. */
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

/** The record of a job whose worker died, which states that nothing is known. */
const LOST_RESULT: ChatJobResult = { outcomeUnknown: true };

export class ChatJobsRepository {
  constructor(private readonly db: Db) {}

  async insert(job: NewChatJob): Promise<ChatJob> {
    const [row] = await this.db
      .insert(chatJobs)
      .values({ ...job, outputs: [...job.outputs] })
      .returning();

    return row;
  }

  /** The job with this id in the Chat, in any state. */
  async findById(
    chatId: string,
    ownerUserId: string,
    jobId: string,
  ): Promise<ChatJob | undefined> {
    const [row] = await this.db
      .select()
      .from(chatJobs)
      .where(jobInChat(chatId, ownerUserId, jobId));

    return row;
  }

  /** The job that `job://<executor>-<seq>` names in the Chat. */
  async findByLocator(
    chatId: string,
    ownerUserId: string,
    executor: string,
    seq: number,
  ): Promise<ChatJob | undefined> {
    const [row] = await this.db
      .select()
      .from(chatJobs)
      .where(
        and(
          inChat(chatId, ownerUserId),
          eq(chatJobs.executor, executor),
          eq(chatJobs.seq, seq),
        ),
      );

    return row;
  }

  /** The Chat's jobs, the oldest first. */
  listByChat(chatId: string, ownerUserId: string): Promise<Array<ChatJob>> {
    return this.db
      .select()
      .from(chatJobs)
      .where(inChat(chatId, ownerUserId))
      .orderBy(asc(chatJobs.startedAt), asc(chatJobs.seq));
  }

  /**
   * Settle a running job. The update is conditional on `state = 'running'`, so
   * the first writer wins and a later one gets `undefined` and changes
   * nothing: a settled job never changes its state or its result.
   */
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

  /**
   * Record a request to stop a running job. The first request keeps its
   * stopper. A settled job is not touched; the caller reads it to answer.
   */
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

  requestStopInChat(
    chatId: string,
    ownerUserId: string,
  ): Promise<Array<ChatJob>> {
    return this.db
      .update(chatJobs)
      .set({
        stopRequestedAt: sql`coalesce(${chatJobs.stopRequestedAt}, now())`,
        stopRequestedBy: sql`coalesce(${chatJobs.stopRequestedBy}, 'owner')`,
      })
      .where(and(inChat(chatId, ownerUserId), eq(chatJobs.state, 'running')))
      .returning();
  }

  /**
   * Settle as `lost` every running job of the Chat whose worker is dead: its
   * row has no heartbeat within `deadAfterSeconds`, or no row at all
   * (background-jobs D9). One owner and one Chat only, so no process scans the
   * jobs of more than one owner. Stored output stays readable.
   */
  settleOnDeadWorkers(
    chatId: string,
    ownerUserId: string,
    deadAfterSeconds: number,
  ): Promise<Array<ChatJob>> {
    return this.db
      .update(chatJobs)
      .set({ state: 'lost', result: LOST_RESULT, settledAt: sql`now()` })
      .where(
        and(
          inChat(chatId, ownerUserId),
          eq(chatJobs.state, 'running'),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(workerInstances)
              .where(
                and(
                  eq(workerInstances.id, chatJobs.workerInstanceId),
                  workerAlive(deadAfterSeconds),
                ),
              ),
          ),
        ),
      )
      .returning();
  }

  /**
   * The running jobs of each Chat on a worker that is not dead, for the chat
   * list. It joins the job to its worker and settles nothing. `chatId` narrows
   * the count to one Chat (a live update).
   */
  async countRunning(
    ownerUserId: string,
    deadAfterSeconds: number,
    chatId?: string,
  ): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ chatId: chatJobs.chatId, running: count() })
      .from(chatJobs)
      .innerJoin(
        workerInstances,
        and(
          eq(workerInstances.id, chatJobs.workerInstanceId),
          workerAlive(deadAfterSeconds),
        ),
      )
      .where(
        and(
          eq(chatJobs.ownerUserId, ownerUserId),
          eq(chatJobs.state, 'running'),
          chatId === undefined ? undefined : eq(chatJobs.chatId, chatId),
        ),
      )
      .groupBy(chatJobs.chatId);

    return new Map(rows.map((row) => [row.chatId, row.running]));
  }

  /** One output of a job: its stored increments, appended in order. */
  async readOutput(
    ownerUserId: string,
    jobId: string,
    output: string,
  ): Promise<Buffer> {
    const rows = await this.db
      .select({ content: chatJobChunks.content })
      .from(chatJobChunks)
      .where(
        and(
          eq(chatJobChunks.jobId, jobId),
          eq(chatJobChunks.ownerUserId, ownerUserId),
          eq(chatJobChunks.output, output),
        ),
      )
      .orderBy(asc(chatJobChunks.position));

    return Buffer.concat(rows.map((row) => row.content));
  }
}

/** The Chat's jobs of one owner. */
function inChat(chatId: string, ownerUserId: string): SQL | undefined {
  return and(
    eq(chatJobs.chatId, chatId),
    eq(chatJobs.ownerUserId, ownerUserId),
  );
}

/** One job of the Chat, of one owner. */
function jobInChat(
  chatId: string,
  ownerUserId: string,
  jobId: string,
): SQL | undefined {
  return and(eq(chatJobs.id, jobId), inChat(chatId, ownerUserId));
}

/** The worker row's last heartbeat is inside the window (database time). */
function workerAlive(deadAfterSeconds: number): SQL {
  return gt(
    workerInstances.lastSeenAt,
    sql`now() - make_interval(secs => ${deadAfterSeconds})`,
  );
}
