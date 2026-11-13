import { type Logger } from '@nestjs/common';
import {
  type ManagedBashHandle,
  type ManagedOutput,
  type ManagedStopResult,
} from '@workspace/bash-executor';
import { type ToolResult } from '@workspace/runtime-safety';

import { ChatsRepository } from '../chats/chats-repository';
import { type ChatJob } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { pgErrorCode } from '../db/pg-error';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { RunRowFenceRepository } from '../runs/run-row-fence.repository';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { appendJobOutput } from './bash-job-store';
import { ChatJobsRepository } from './chat-jobs.repository';
import { type BashJobFacts } from './bash-job-registry';
import { jobSequence, toolResultFromReceipt } from './bash-promotion-receipt';

type PromotionResult = {
  readonly result: ToolResult;
  readonly receiptCommitted: boolean;
  readonly recoveryWon: boolean;
};

type PromotionCallbacks = {
  readonly forJob: (job: ChatJob) => ToolResult;
  readonly forStopped: (stopped: ManagedStopResult) => ToolResult;
};

type PromotionOutcome =
  | {
      readonly kind: 'committed';
      readonly job: ChatJob;
      readonly result: ToolResult;
      readonly output: ManagedOutput;
    }
  | {
      readonly kind: 'receipt';
      readonly job?: ChatJob;
      readonly result: ToolResult;
      readonly output?: ManagedOutput;
    }
  | {
      readonly kind: 'reclaimed';
      readonly result: ToolResult;
      readonly receiptCommitted: boolean;
      readonly recoveryWon: boolean;
    };

type TransactionState = { callbackCompleted: boolean };

type CapturedOutput = { value?: ManagedOutput };

type PromotionFacts = BashJobFacts & { readonly attemptId: string };

type PromotionTransactionInput = {
  readonly handle: ManagedBashHandle;
  readonly facts: PromotionFacts;
  readonly attemptId: string;
  readonly forJob: (job: ChatJob) => ToolResult;
  readonly deadlineAt: Date | undefined;
  readonly captured: CapturedOutput;
  readonly state: TransactionState;
};

type LockedPromotionInput = PromotionTransactionInput & { readonly tx: Db };

type TrackJob = (
  handle: ManagedBashHandle,
  job: ChatJob,
  facts: BashJobFacts,
  output: ManagedOutput,
) => void;

type PromotionDependencies = {
  readonly tenantDb: TenantRunner;
  readonly workerInstanceId: string;
  readonly config: InstanceConfigReader;
  readonly logger: Pick<Logger, 'warn'>;
  readonly trackJob: TrackJob;
};

/** Owns atomic host-job admission, initial output, and its native receipt. */
export class BashJobPromotion {
  private readonly tenantDb: TenantRunner;
  private readonly workerInstanceId: string;
  private readonly config: InstanceConfigReader;
  private readonly logger: Pick<Logger, 'warn'>;
  private readonly trackJob: TrackJob;

  constructor({
    tenantDb,
    workerInstanceId,
    config,
    logger,
    trackJob,
  }: PromotionDependencies) {
    this.tenantDb = tenantDb;
    this.workerInstanceId = workerInstanceId;
    this.config = config;
    this.logger = logger;
    this.trackJob = trackJob;
  }

  async promote(
    handle: ManagedBashHandle,
    supplied: BashJobFacts,
    callbacks: PromotionCallbacks,
  ): Promise<PromotionResult> {
    const attemptId = supplied.attemptId;

    if (attemptId === undefined)
      throw new Error('Host promotion requires its Run attempt.');

    const facts: PromotionFacts = { ...copyFacts(supplied), attemptId };
    const deadlineAt = this.deadline(facts);
    const captured: CapturedOutput = {};

    while (true) {
      const result = await this.promoteAttempt(
        {
          handle,
          facts,
          attemptId,
          forJob: callbacks.forJob,
          deadlineAt,
          captured,
        },
        callbacks,
      );

      if (result !== undefined) return result;
    }
  }

  private async promoteAttempt(
    input: Omit<PromotionTransactionInput, 'state'>,
    callbacks: PromotionCallbacks,
  ): Promise<PromotionResult | undefined> {
    const { handle, facts, captured } = input;
    const state: TransactionState = { callbackCompleted: false };

    try {
      const outcome = await this.promoteTransaction({ ...input, state });

      return this.finishOutcome(handle, facts, outcome, captured);
    } catch (error) {
      return this.recoverAttempt({
        ...input,
        state,
        error,
        forStopped: callbacks.forStopped,
      });
    }
  }

  private async recoverAttempt({
    handle,
    facts,
    state,
    error,
    forStopped,
    captured,
  }: PromotionTransactionInput & {
    readonly error: unknown;
    readonly forStopped: PromotionCallbacks['forStopped'];
  }): Promise<PromotionResult | undefined> {
    if (!state.callbackCompleted) {
      if (!isRetryableConflict(error))
        return this.stopAndRecover(handle, facts, forStopped);

      this.logger.warn(
        `Retrying host promotion after lock conflict: ${String(error)}`,
      );
      await waitForRetry();

      return undefined;
    }

    const reconciled = await this.reconcile(handle, facts, captured);

    if (reconciled !== undefined) return reconciled;

    this.logger.warn(
      `Promotion acknowledgement is unresolved: ${String(error)}`,
    );
    await waitForRetry();

    return undefined;
  }

  private deadline(facts: BashJobFacts): Date | undefined {
    if (facts.unlimited === true) return undefined;

    return new Date(
      facts.startedAt.getTime() +
        this.config.config.tools.jobs.maxSeconds * 1000,
    );
  }

  private promoteTransaction({
    handle,
    facts,
    attemptId,
    forJob,
    deadlineAt,
    captured,
    state,
  }: PromotionTransactionInput): Promise<PromotionOutcome> {
    return this.tenantDb.runAs(facts.ownerUserId, (tx) =>
      this.resolveLockedPromotion({
        tx,
        handle,
        facts,
        attemptId,
        forJob,
        deadlineAt,
        captured,
        state,
      }),
    );
  }

  private async resolveLockedPromotion(
    input: LockedPromotionInput,
  ): Promise<PromotionOutcome> {
    const { tx, facts, attemptId, captured, state } = input;

    const chat = await new ChatsRepository(tx).lock(
      facts.chatId,
      facts.ownerUserId,
    );

    if (chat === undefined) {
      state.callbackCompleted = true;

      return reclaimed(unknownResult());
    }

    const run = await new RunRowFenceRepository(tx).lockHostPromotion(
      facts.runId,
      facts.ownerUserId,
      attemptId,
    );

    const events = new RunEventsRepository(tx);

    if (run === undefined)
      return this.recoverLockedPromotion(tx, facts, attemptId, state);

    const prior = await this.findPriorReceipt(tx, facts, captured);

    if (prior !== undefined) {
      state.callbackCompleted = true;

      return prior;
    }

    return this.persistPromotedJob({ ...input, events });
  }

  private async recoverLockedPromotion(
    tx: Db,
    facts: PromotionFacts,
    attemptId: string,
    state: TransactionState,
  ): Promise<PromotionOutcome> {
    const recovery = await new NativeFilesRepository(tx).recoverHostPromotion({
      runId: facts.runId,
      userId: facts.ownerUserId,
      attemptId,
      toolCallId: facts.toolCallId,
      result: unknownResult(),
    });

    state.callbackCompleted = true;

    return reclaimed(recovery.result, recovery.disposition !== 'fenced');
  }

  private async findPriorReceipt(
    tx: Db,
    facts: BashJobFacts,
    captured: CapturedOutput,
  ): Promise<PromotionOutcome | undefined> {
    const previous = await new RunEventsRepository(tx).findNativeResult(
      facts.runId,
      facts.ownerUserId,
      facts.toolCallId,
    );

    const result = toolResultFromReceipt(previous?.payload);

    if (result === undefined) return undefined;

    const seq = jobSequence(result);

    const job =
      seq === undefined
        ? undefined
        : await new ChatJobsRepository(tx).findByLocator(
            facts.chatId,
            facts.ownerUserId,
            'bash',
            seq,
          );

    return {
      kind: 'receipt',
      job,
      result,
      output: captured.value,
    };
  }

  private async persistPromotedJob({
    tx,
    events,
    handle,
    facts,
    forJob,
    deadlineAt,
    captured,
    state,
  }: LockedPromotionInput & {
    readonly events: RunEventsRepository;
  }): Promise<PromotionOutcome> {
    const seq = await new ArtifactsRepository(tx).nextSeq(
      facts.chatId,
      facts.ownerUserId,
    );

    if (seq === undefined) throw new Error('The Chat cannot store a job.');

    const output = handle.snapshot();
    captured.value = output;

    const job = await this.insertPromotedJob({
      tx,
      handle,
      facts,
      seq,
      deadlineAt,
    });

    await appendJobOutput(tx, job, output, { stdout: 0, stderr: 0 });
    const result = forJob(job);
    await events.append(facts.runId, 'native.result', {
      toolCallId: facts.toolCallId,
      result,
    });
    state.callbackCompleted = true;

    return { kind: 'committed', job, result, output };
  }

  private insertPromotedJob({
    tx,
    handle,
    facts,
    seq,
    deadlineAt,
  }: {
    readonly tx: Db;
    readonly handle: ManagedBashHandle;
    readonly facts: PromotionFacts;
    readonly seq: number;
    readonly deadlineAt: Date | undefined;
  }): Promise<ChatJob> {
    return new ChatJobsRepository(tx).insert({
      chatId: facts.chatId,
      ownerUserId: facts.ownerUserId,
      executor: 'bash',
      seq,
      runId: facts.runId,
      toolCallId: facts.toolCallId,
      workerInstanceId: this.workerInstanceId,
      pid: handle.pid,
      startedAt: facts.startedAt,
      deadlineAt,
      outputs: ['stdout', 'stderr'],
      artifactReadable: facts.artifactReadable,
      settings: facts.settings,
    });
  }

  private async finishOutcome(
    handle: ManagedBashHandle,
    facts: BashJobFacts,
    outcome: PromotionOutcome,
    captured: CapturedOutput,
  ): Promise<PromotionResult> {
    if (outcome.kind === 'committed') {
      this.trackJob(handle, outcome.job, facts, outcome.output);

      return {
        result: outcome.result,
        receiptCommitted: true,
        recoveryWon: false,
      };
    }

    if (outcome.kind === 'receipt') {
      if (outcome.job === undefined || outcome.output === undefined)
        await handle.stop('run');
      else this.trackJob(handle, outcome.job, facts, outcome.output);

      return {
        result: outcome.result,
        receiptCommitted: true,
        recoveryWon: false,
      };
    }

    const job = outcome.receiptCommitted
      ? await this.findResultJob(facts, outcome.result)
      : undefined;

    if (job === undefined || captured.value === undefined)
      await handle.stop('run');
    else this.trackJob(handle, job, facts, captured.value);

    return {
      result: outcome.result,
      receiptCommitted: outcome.receiptCommitted,
      recoveryWon: outcome.recoveryWon,
    };
  }

  private findResultJob(
    facts: BashJobFacts,
    result: ToolResult,
  ): Promise<ChatJob | undefined> {
    const seq = jobSequence(result);

    if (seq === undefined) return Promise.resolve(undefined);

    return this.tenantDb.runAs(facts.ownerUserId, (db) =>
      new ChatJobsRepository(db).findByLocator(
        facts.chatId,
        facts.ownerUserId,
        'bash',
        seq,
      ),
    );
  }

  private async stopAndRecover(
    handle: ManagedBashHandle,
    facts: PromotionFacts,
    forStopped: (stopped: ManagedStopResult) => ToolResult,
  ): Promise<PromotionResult> {
    let result: ToolResult;

    try {
      result = forStopped(await handle.stop('run'));
    } catch (error) {
      this.logger.warn(
        `Could not prove a stopped host command: ${String(error)}`,
      );
      result = unknownResult();
    }

    return this.persistFailureReceipt(facts, result);
  }

  private async persistFailureReceipt(
    facts: PromotionFacts,
    result: ToolResult,
  ): Promise<PromotionResult> {
    while (true) {
      try {
        const recovery = await this.tenantDb.runAs(facts.ownerUserId, (tx) =>
          new NativeFilesRepository(tx).recoverHostPromotion({
            runId: facts.runId,
            userId: facts.ownerUserId,
            attemptId: facts.attemptId,
            toolCallId: facts.toolCallId,
            result,
          }),
        );

        return {
          result: recovery.result,
          receiptCommitted: recovery.disposition !== 'fenced',
          recoveryWon: true,
        };
      } catch (error) {
        const recorded = await this.readReceipt(facts).catch(() => undefined);
        const prior = toolResultFromReceipt(recorded?.payload);

        if (prior !== undefined)
          return { result: prior, receiptCommitted: true, recoveryWon: true };

        this.logger.warn(
          `Promotion failure receipt is unresolved: ${String(error)}`,
        );
        await waitForRetry();
      }
    }
  }

  private async reconcile(
    handle: ManagedBashHandle,
    facts: BashJobFacts,
    captured: CapturedOutput,
  ): Promise<PromotionResult | undefined> {
    try {
      const receipt = await this.readReceipt(facts);
      const result = toolResultFromReceipt(receipt?.payload);

      if (result === undefined) return undefined;

      const job = await this.findResultJob(facts, result);

      if (job === undefined || captured.value === undefined)
        await handle.stop('run');
      else this.trackJob(handle, job, facts, captured.value);

      return { result, receiptCommitted: true, recoveryWon: false };
    } catch {
      // The acknowledgement remains ambiguous if reconciliation cannot read the receipt.
      return undefined;
    }
  }

  private readReceipt(facts: BashJobFacts) {
    return this.tenantDb.runAs(facts.ownerUserId, (db) =>
      new RunEventsRepository(db).findNativeResult(
        facts.runId,
        facts.ownerUserId,
        facts.toolCallId,
      ),
    );
  }
}

function copyFacts(facts: BashJobFacts): BashJobFacts {
  return {
    ...facts,
    settings: { ...facts.settings },
    startedAt: new Date(facts.startedAt),
    configuredCredentials: [...facts.configuredCredentials],
  };
}

function reclaimed(
  result: ToolResult,
  receiptCommitted = false,
): PromotionOutcome {
  return {
    kind: 'reclaimed',
    result,
    receiptCommitted,
    recoveryWon: true,
  };
}

function unknownResult(): ToolResult {
  return {
    status: 'error',
    type: 'outcome_unknown',
    message:
      'The host command receipt could not be safely committed. Inspect its effects before retrying; it will not be repeated automatically.',
  };
}

function isRetryableConflict(error: unknown): boolean {
  const code = pgErrorCode(error);

  return code === '40P01' || code === '40001';
}

async function waitForRetry(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, 250);
  timer.unref();
  await promise;
}
