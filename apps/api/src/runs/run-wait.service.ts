import { and, eq, inArray, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository } from '../chats/chats-repository';
import { enqueueSuspendedRun, persistRunSuspension } from './run-suspension';
import {
  chatJobs,
  runs,
  type AwaitingJobs,
  type AwaitingQuota,
  type Run,
} from '../db/schema';
import { isTerminalRunStatus, WAITING_RUN_STATUSES } from './run-status';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { RunDispatchService } from './run-dispatch.service';
import { RunEventsRepository } from './runs-repository';
import { retryRunTransaction } from './run-transaction';
import { type AssistantTurnTelemetry } from './run-reply-finalizer';
import type { StoppedCall } from '../chats/interrupted-notice';

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
  telemetry?: AssistantTurnTelemetry;
};

export type SuspendRunQuotaInput = {
  runId: string;
  chatId: string;
  userId: string;
  attemptId: string;
  awaiting: AwaitingQuota;
  parts: Array<unknown>;
  steps: Record<string, number>;
  stoppedCalls?: ReadonlyArray<StoppedCall>;
};

type AttemptRunInput = Pick<
  SuspendRunWaitInput,
  'runId' | 'chatId' | 'userId' | 'attemptId'
>;

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

function awaitingMatchesStatus(run: Pick<Run, 'status' | 'awaiting'>): boolean {
  if (!run.awaiting) return false;

  return run.status === 'awaiting_jobs'
    ? run.awaiting.kind === 'jobs'
    : run.status === 'awaiting_quota' && run.awaiting.kind === 'quota';
}

function wakeRunPredicate(input: WakeRunInput) {
  return and(
    eq(runs.id, input.runId),
    eq(runs.userId, input.userId),
    inArray(runs.status, [...WAITING_RUN_STATUSES]),
    eq(runs.wakeGeneration, input.generation),
  );
}

@Injectable()
export class RunWaitService {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(RunDispatchService)
    private readonly dispatch: Pick<RunDispatchService, 'enqueueInTransaction'>,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
  ) {}

  async suspendForQuota(
    input: SuspendRunQuotaInput,
  ): Promise<{ kind: 'suspended' } | { kind: 'ready'; cause: 'cancelled' }> {
    return retryRunTransaction(() =>
      this.tenantDb.runAs(input.userId, async (tx) => {
        const run = await this.lockActiveRun(tx, input);

        if (!run || run.cancelRequestedAt !== null)
          return { kind: 'ready', cause: 'cancelled' } as const;

        if (
          !(await persistRunSuspension(tx, this.dispatch, run, {
            kind: 'quota',
            input,
            awaiting: input.awaiting,
            deadline: input.awaiting.wakeAt,
          }))
        )
          return { kind: 'ready', cause: 'cancelled' } as const;

        return { kind: 'suspended' } as const;
      }),
    );
  }

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

    if (
      !(await persistRunSuspension(tx, this.dispatch, run, {
        kind: 'jobs',
        input,
        awaiting: {
          kind: 'jobs',
          toolCallId: input.toolCallId,
          toolInput: input.toolInput,
          jobIds: input.jobIds,
          deadline: input.deadline,
        },
        deadline: input.deadline,
      }))
    )
      return { kind: 'ready', cause: 'cancelled' };

    return { kind: 'suspended' };
  }

  private async lockActiveRun(tx: Db, input: AttemptRunInput) {
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

    const listedIds = new Set(jobs.map((job) => job.id));

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

    const deadJobIds =
      candidate.awaiting?.kind === 'jobs'
        ? await this.settleDeadJobs(tx, candidate.chatId, input.userId)
        : new Set<string>();

    const run = await this.lockWakeRun(tx, input);

    if (!run) return false;
    const cause = await this.resolveWakeCause(tx, run, input, deadJobIds);

    if (!cause) return false;
    const resumed = await this.persistWake(tx, run, input, cause);

    if (!resumed) return false;

    if (input.deadlineJobId === undefined)
      await enqueueSuspendedRun(tx, this.dispatch, {
        run,
        userId: input.userId,
        ...resumed,
      });

    return true;
  }

  private async readWakeCandidate(tx: Db, input: WakeRunInput) {
    const [candidate] = await tx
      .select()
      .from(runs)
      .where(wakeRunPredicate(input))
      .limit(1);

    if (candidate === undefined || !awaitingMatchesStatus(candidate))
      return undefined;

    if (!(await new ChatsRepository(tx).lock(candidate.chatId, input.userId)))
      return undefined;

    const [lockedCandidate] = await tx
      .select({ currentJobId: runs.currentJobId })
      .from(runs)
      .where(wakeRunPredicate(input))
      .limit(1);

    if (lockedCandidate === undefined) return undefined;

    if (
      input.deadlineJobId !== undefined &&
      lockedCandidate.currentJobId !== input.deadlineJobId
    )
      return undefined;

    return candidate;
  }

  private async lockWakeRun(tx: Db, input: WakeRunInput) {
    const [run] = await tx
      .select()
      .from(runs)
      .where(wakeRunPredicate(input))
      .for('update');

    if (!run?.currentJobId || !awaitingMatchesStatus(run)) return undefined;

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
    if (run.awaiting?.kind === 'quota')
      return this.resolveQuotaWakeCause(tx, run, input, run.awaiting);

    return this.resolveJobsWakeCause(tx, run, input, deadJobIds);
  }

  private async resolveQuotaWakeCause(
    tx: Db,
    run: Run,
    input: WakeRunInput,
    awaiting: AwaitingQuota,
  ): Promise<RunWaitCause | undefined> {
    if (input.cause !== 'timeout' && input.cause !== 'cancelled')
      return undefined;

    if (
      input.cause === 'timeout' &&
      !(await this.wakeDeadlineIsDue(tx, run.id, awaiting.wakeAt))
    )
      return undefined;

    return input.cause;
  }

  private async resolveJobsWakeCause(
    tx: Db,
    run: Run,
    input: WakeRunInput,
    deadJobIds: Set<string>,
  ): Promise<RunWaitCause | undefined> {
    const awaiting = run.awaiting;

    if (awaiting?.kind !== 'jobs') return undefined;

    if (input.cause === 'timeout') {
      if (awaiting.jobIds.some((jobId) => deadJobIds.has(jobId)))
        return 'settled';

      if (!(await this.wakeDeadlineIsDue(tx, run.id, awaiting.deadline)))
        return undefined;
    }

    if (input.cause !== 'settled') return input.cause;

    const states = await this.listedJobStates(
      tx,
      run.chatId,
      input.userId,
      awaiting.jobIds,
    );

    return states.some((job) => job.state !== 'running')
      ? 'settled'
      : undefined;
  }

  private async wakeDeadlineIsDue(
    tx: Db,
    runId: string,
    deadline: string,
  ): Promise<boolean> {
    const due = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, runId), sql`${deadline}::timestamptz <= now()`));

    return due.length > 0;
  }

  private async persistWake(
    tx: Db,
    run: Run,
    input: WakeRunInput,
    cause: RunWaitCause,
  ): Promise<{ generation: number; jobId: string } | undefined> {
    const jobId =
      input.deadlineJobId === undefined ? randomUUID() : run.currentJobId;

    if (!jobId || !run.awaiting) return undefined;
    const generation = run.wakeGeneration;

    const quotaAttemptId =
      run.awaiting.kind === 'quota' ? randomUUID() : undefined;

    const [updated] = await tx
      .update(runs)
      .set({ status: 'queued', currentJobId: jobId })
      .where(
        and(
          eq(runs.id, run.id),
          eq(runs.status, run.status),
          eq(runs.wakeGeneration, input.generation),
        ),
      )
      .returning();

    if (!updated) return undefined;
    const events = new RunEventsRepository(tx);

    if (quotaAttemptId === undefined) {
      await events.append(run.id, 'run.resumed', { generation, cause });
    } else {
      await events.append(run.id, 'run.resumed', {
        kind: 'quota',
        attemptId: quotaAttemptId,
        generation,
        cause,
      });
    }

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

  async wakeForChatInTransaction(
    tx: Db,
    input: WakeForChatInput,
  ): Promise<boolean> {
    const run = await this.lockChatAwaitingRun(tx, input);

    if (!run?.awaiting || run.awaiting.kind !== 'jobs' || !run.currentJobId)
      return false;
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
    await enqueueSuspendedRun(tx, this.dispatch, {
      run,
      userId: input.userId,
      ...resumed,
    });

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

    if (!candidate?.awaiting || candidate.awaiting.kind !== 'jobs')
      return undefined;
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

    if (run.awaiting?.kind !== 'jobs') return undefined;
    const jobIds = run.awaiting.jobIds;

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
