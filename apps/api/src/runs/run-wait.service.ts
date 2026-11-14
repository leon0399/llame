import { and, eq, inArray, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { toRunUserMessage } from '../chats/chat-message-parts';
import { chatJobs, runs, type AwaitingJobs, type Run } from '../db/schema';
import { isTerminalRunStatus } from './run-status';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { RunDispatchService } from './run-dispatch.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { retryRunTransaction } from './run-transaction';
import { type EnqueueOptions } from '../queue/queue';

export type RunWaitCause = 'settled' | 'interrupted' | 'timeout' | 'cancelled';

export type SuspendRunWaitInput = {
  runId: string;
  chatId: string;
  userId: string;
  attemptId: string;
  toolCallId: string;
  toolInput: AwaitingJobs['toolInput'];
  jobIds: Array<string>;
  deadline: string;
  parts: Array<unknown>;
  steps: Record<string, number>;
};

type WakeRunInput = {
  runId: string;
  userId: string;
  generation: number;
  cause: RunWaitCause;
  deadlineJobId?: string;
};

type WakeForChatInput = {
  chatId: string;
  userId: string;
  jobId?: string;
  kind: 'settlement' | 'steer' | 'interrupt' | 'cancel';
};

@Injectable()
export class RunWaitService {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(RunDispatchService)
    private readonly dispatch: Pick<RunDispatchService, 'enqueueInTransaction'>,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
  ) {}

  async suspend(
    input: SuspendRunWaitInput,
  ): Promise<
    | { kind: 'suspended' }
    | { kind: 'ready'; cause: 'settled' | 'interrupted' | 'cancelled' }
  > {
    return retryRunTransaction(() =>
      this.tenantDb.runAs(input.userId, (tx) =>
        this.suspendInTransaction(tx, input),
      ),
    );
  }

  private async suspendInTransaction(
    tx: Db,
    input: SuspendRunWaitInput,
  ): Promise<
    | { kind: 'suspended' }
    | { kind: 'ready'; cause: 'settled' | 'interrupted' | 'cancelled' }
  > {
    const run = await this.lockActiveRun(tx, input);

    if (!run) return { kind: 'ready', cause: 'cancelled' };

    const cause = await this.suspensionReadiness(
      tx,
      input,
      run.cancelRequestedAt !== null,
    );

    if (cause) return { kind: 'ready', cause };

    if (!(await this.suspendLockedRun(tx, run, input)))
      return { kind: 'ready', cause: 'cancelled' };

    return { kind: 'suspended' };
  }

  private async suspendLockedRun(
    tx: Db,
    run: Run,
    input: SuspendRunWaitInput,
  ): Promise<boolean> {
    const checkpoint = await this.writeSuspensionCheckpoint(tx, run, input);

    if (!checkpoint) return false;
    await this.enqueueRun(tx, {
      run,
      userId: input.userId,
      ...checkpoint,
      deadline: input.deadline,
    });

    return true;
  }

  private async writeSuspensionCheckpoint(
    tx: Db,
    run: Run,
    input: SuspendRunWaitInput,
  ): Promise<{ generation: number; jobId: string } | undefined> {
    const awaiting: AwaitingJobs = {
      toolCallId: input.toolCallId,
      toolInput: input.toolInput,
      jobIds: input.jobIds,
      deadline: input.deadline,
    };

    const generation = run.wakeGeneration + 1;
    const jobId = randomUUID();

    const updated = await new RunsRepository(tx).updateForAttempt(
      run.id,
      input.userId,
      input.attemptId,
      {
        status: 'awaiting_jobs',
        awaiting,
        wakeGeneration: generation,
        currentJobId: jobId,
        activeAttemptId: null,
      },
    );

    if (!updated) return undefined;
    await new RunEventsRepository(tx).append(run.id, 'run.suspended', {
      attemptId: input.attemptId,
      generation,
      toolCallId: input.toolCallId,
      parts: input.parts,
      steps: input.steps,
      awaiting,
    });

    return { generation, jobId };
  }

  private async lockActiveRun(tx: Db, input: SuspendRunWaitInput) {
    if (!(await new ChatsRepository(tx).lock(input.chatId, input.userId)))
      return undefined;

    const [run] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, input.runId),
          eq(runs.chatId, input.chatId),
          eq(runs.userId, input.userId),
        ),
      )
      .for('update');

    if (
      !run ||
      run.activeAttemptId !== input.attemptId ||
      isTerminalRunStatus(run.status) ||
      run.finishedAt !== null
    )
      return undefined;

    return run;
  }

  private async suspensionReadiness(
    tx: Db,
    input: SuspendRunWaitInput,
    cancelRequested: boolean,
  ): Promise<'settled' | 'interrupted' | 'cancelled' | undefined> {
    const jobs = await tx
      .select({ id: chatJobs.id })
      .from(chatJobs)
      .where(
        and(
          eq(chatJobs.chatId, input.chatId),
          eq(chatJobs.ownerUserId, input.userId),
          inArray(chatJobs.id, input.jobIds),
        ),
      );

    const listedIds = new Set<string>();

    for (const job of jobs) listedIds.add(job.id);

    if (input.jobIds.some((id) => !listedIds.has(id))) return 'interrupted';
    await this.settleDeadJobs(tx, input.chatId, input.userId);

    const pendingSteering = await new ChatDeliveriesRepository(
      tx,
    ).hasPendingSteering(input.chatId, input.userId);

    const states = await this.listedJobStates(
      tx,
      input.chatId,
      input.userId,
      input.jobIds,
    );

    if (cancelRequested) return 'cancelled';

    if (states.some((job) => job.state !== 'running')) return 'settled';

    return pendingSteering ? 'interrupted' : undefined;
  }

  async wakeInTransaction(tx: Db, input: WakeRunInput): Promise<boolean> {
    const candidate = await this.readWakeCandidate(tx, input);

    if (!candidate) return false;

    const deadJobIds = await this.settleDeadJobs(
      tx,
      candidate.chatId,
      input.userId,
    );

    const run = await this.lockWakeRun(tx, input);

    if (!run) return false;
    const cause = await this.resolveWakeCause(tx, run, input, deadJobIds);

    if (!cause) return false;
    const resumed = await this.persistWake(tx, run, input, cause);

    if (!resumed) return false;

    if (input.deadlineJobId === undefined)
      await this.enqueueRun(tx, { run, userId: input.userId, ...resumed });

    return true;
  }

  private async readWakeCandidate(tx: Db, input: WakeRunInput) {
    const [candidate] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, input.runId),
          eq(runs.userId, input.userId),
          eq(runs.status, 'awaiting_jobs'),
          eq(runs.wakeGeneration, input.generation),
        ),
      )
      .limit(1);

    if (!candidate) return undefined;

    if (!(await new ChatsRepository(tx).lock(candidate.chatId, input.userId)))
      return undefined;

    const [current] = await tx
      .select({ currentJobId: runs.currentJobId })
      .from(runs)
      .where(
        and(
          eq(runs.id, input.runId),
          eq(runs.userId, input.userId),
          eq(runs.status, 'awaiting_jobs'),
          eq(runs.wakeGeneration, input.generation),
        ),
      )
      .limit(1);

    if (
      !current ||
      (input.deadlineJobId !== undefined &&
        current.currentJobId !== input.deadlineJobId)
    )
      return undefined;

    return candidate;
  }

  private async lockWakeRun(tx: Db, input: WakeRunInput) {
    const [run] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, input.runId),
          eq(runs.userId, input.userId),
          eq(runs.status, 'awaiting_jobs'),
          eq(runs.wakeGeneration, input.generation),
        ),
      )
      .for('update');

    if (!run?.awaiting || !run.currentJobId) return undefined;

    if (
      input.deadlineJobId !== undefined &&
      run.currentJobId !== input.deadlineJobId
    )
      return undefined;

    return run;
  }

  private async resolveWakeCause(
    tx: Db,
    run: Run,
    input: WakeRunInput,
    deadJobIds: Set<string>,
  ): Promise<RunWaitCause | undefined> {
    const cause =
      input.cause === 'timeout' &&
      run.awaiting?.jobIds.some((jobId) => deadJobIds.has(jobId))
        ? 'settled'
        : input.cause;

    if (!run.awaiting) return undefined;

    if (cause === 'timeout') {
      const due = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.id, run.id),
            sql`${run.awaiting.deadline}::timestamptz <= now()`,
          ),
        );

      if (due.length === 0) return undefined;
    }

    if (cause === 'settled') {
      const states = await this.listedJobStates(
        tx,
        run.chatId,
        input.userId,
        run.awaiting.jobIds,
      );

      if (!states.some((job) => job.state !== 'running')) return undefined;
    }

    return cause;
  }

  private async persistWake(
    tx: Db,
    run: Run,
    input: WakeRunInput,
    cause: RunWaitCause,
  ): Promise<{ generation: number; jobId: string } | undefined> {
    const jobId =
      input.deadlineJobId === undefined ? randomUUID() : run.currentJobId;

    if (!jobId) return undefined;
    const generation = run.wakeGeneration;

    const [updated] = await tx
      .update(runs)
      .set({ status: 'queued', currentJobId: jobId })
      .where(
        and(
          eq(runs.id, run.id),
          eq(runs.status, 'awaiting_jobs'),
          eq(runs.wakeGeneration, input.generation),
        ),
      )
      .returning();

    if (!updated) return undefined;
    await new RunEventsRepository(tx).append(run.id, 'run.resumed', {
      generation,
      cause,
    });

    return { generation, jobId };
  }

  private async listedJobStates(
    tx: Db,
    chatId: string,
    userId: string,
    jobIds: Array<string>,
  ) {
    return tx
      .select({ id: chatJobs.id, state: chatJobs.state })
      .from(chatJobs)
      .where(
        and(
          eq(chatJobs.chatId, chatId),
          eq(chatJobs.ownerUserId, userId),
          inArray(chatJobs.id, jobIds),
        ),
      );
  }

  private async enqueueRun(
    tx: Db,
    data: {
      run: Run;
      userId: string;
      generation: number;
      jobId: string;
      deadline?: string;
    },
  ): Promise<void> {
    const { run, userId, generation, jobId } = data;

    const message =
      run.messageId === null
        ? undefined
        : await new MessagesRepository(tx).findById(
            run.chatId,
            userId,
            run.messageId,
          );

    if (!message) throw new Error(`Run ${run.id} has no triggering message`);
    const options: Omit<EnqueueOptions, 'tx'> = { id: jobId };

    if (data.deadline !== undefined)
      options.startAfter = new Date(data.deadline);
    await this.dispatch.enqueueInTransaction(
      tx,
      {
        runId: run.id,
        chatId: run.chatId,
        userId: run.userId,
        modelId: run.modelId,
        userMessage: toRunUserMessage(message),
        wake: { generation, jobId },
      },
      options,
    );
  }

  async wakeForChatInTransaction(
    tx: Db,
    input: WakeForChatInput,
  ): Promise<boolean> {
    const run = await this.lockChatAwaitingRun(tx, input);

    if (!run?.awaiting || !run.currentJobId) return false;
    const cause = await this.resolveChatWakeCause(tx, run, input);

    if (!cause) return false;

    const resumed = await this.persistWake(
      tx,
      run,
      {
        runId: run.id,
        userId: input.userId,
        generation: run.wakeGeneration,
        cause,
      },
      cause,
    );

    if (!resumed) return false;
    await this.enqueueRun(tx, { run, userId: input.userId, ...resumed });

    return true;
  }

  private async lockChatAwaitingRun(tx: Db, input: WakeForChatInput) {
    if (!(await new ChatsRepository(tx).lock(input.chatId, input.userId)))
      return undefined;

    const [candidate] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.chatId, input.chatId),
          eq(runs.userId, input.userId),
          eq(runs.status, 'awaiting_jobs'),
        ),
      )
      .limit(1);

    if (!candidate?.awaiting) return undefined;
    await this.settleDeadJobs(tx, input.chatId, input.userId);

    const [run] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.chatId, input.chatId),
          eq(runs.userId, input.userId),
          eq(runs.status, 'awaiting_jobs'),
        ),
      )
      .for('update');

    return run;
  }

  private async resolveChatWakeCause(
    tx: Db,
    run: Run,
    input: WakeForChatInput,
  ): Promise<RunWaitCause | undefined> {
    if (input.kind !== 'settlement')
      return input.kind === 'cancel' ? 'cancelled' : 'interrupted';
    const jobIds = run.awaiting?.jobIds;

    if (!jobIds) return undefined;

    const states = await this.listedJobStates(
      tx,
      input.chatId,
      input.userId,
      jobIds,
    );

    if (states.some((job) => job.state !== 'running')) return 'settled';

    if (!input.jobId || !jobIds.includes(input.jobId)) return 'interrupted';

    const [matched] = await tx
      .select({ id: chatJobs.id, state: chatJobs.state })
      .from(chatJobs)
      .where(
        and(
          eq(chatJobs.id, input.jobId),
          eq(chatJobs.chatId, input.chatId),
          eq(chatJobs.ownerUserId, input.userId),
        ),
      )
      .limit(1);

    if (matched?.state === 'running') return undefined;

    return matched ? 'settled' : 'interrupted';
  }
  private async settleDeadJobs(
    tx: Db,
    chatId: string,
    userId: string,
  ): Promise<Set<string>> {
    const lost = await new ChatJobsRepository(tx).settleOnDeadWorkers(
      chatId,
      userId,
      this.instanceConfig.config.runs.heartbeatSeconds * 4,
    );

    return new Set(lost.map((job) => job.id));
  }
}
