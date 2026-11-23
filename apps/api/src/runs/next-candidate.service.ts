/**
 * Continue on next candidate for a Run parked in a quota wait (model-roles D7,
 * `POST /api/v1/runs/:id/next-candidate`).
 *
 * A parked Run has no worker and no active attempt, so the API transaction IS
 * the switch: it runs in the wait subsystem's Chat-then-Run lock order, fences
 * on the wait itself (`awaiting_quota` under the job id the wait parked the Run
 * with), closes the parked reply, delivers the host message, moves the Run onto
 * it, writes the hold and the events, and enqueues the Run again. The job keeps
 * the pre-switch message as its `userMessage`, so the claim takes the
 * `currentSegmentInput` path and the Run continues on the next candidate.
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { isNumber, isRecord } from '@workspace/runtime-safety';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { isCompactCommand } from '../chats/commands/parse-chat-command';
import { ChatsRepository } from '../chats/chats-repository';
import {
  createModelChangeItem,
  type ModelChangeModel,
} from '../chats/context-item-producers';
import { writeSwitchHold } from '../chats/selection-update';
import { runs, type AwaitingQuota, type Chat, type Run } from '../db/schema';
import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import {
  effortAfterSwitch,
  revertAtFor,
  type NextCandidate,
} from '../models/model-selection';
import {
  ModelsService,
  NextCandidateUnavailableError,
} from '../models/models.service';
import { RunDispatchService } from './run-dispatch.service';
import { retryRunTransaction } from './run-transaction';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { enqueueSuspendedRun } from './run-suspension';
import { moveWaitingRunToDelivery } from './segment-delivery';
import { storeDeliveredMessage } from './segment-delivery-close';
import { finalizeRunReply } from './run-reply-finalizer';

/** What the action resolved to; the controller maps the refusals to HTTP. */
export type NextCandidateOutcome =
  | { readonly kind: 'moved'; readonly run: Run }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/** The 409 a Run that cannot continue on a next candidate answers. */
export function nextCandidateUnavailable(): NextCandidateUnavailableError {
  return new NextCandidateUnavailableError();
}

/**
 * The candidate a quota-waiting Run moves to, or undefined when it has none.
 * A compaction Run keeps the model its selector resolved at admission, and only
 * a Run in the wait can be moved from the outside; an exact selector answers
 * `undefined` from `nextCandidate` itself.
 */
export function switchTargetFor(
  run: Pick<Run, 'kind' | 'status' | 'selector' | 'modelId'>,
  nextCandidate: (
    selector: string,
    currentModelId: string,
  ) => NextCandidate | undefined,
): NextCandidate | undefined {
  if (run.kind === 'compaction' || run.status !== 'awaiting_quota') {
    return undefined;
  }

  return nextCandidate(run.selector, run.modelId);
}

/** The catalog as the switch's item names a model, degrading to its id. */
function modelView(
  models: ReadonlyArray<SystemModelCatalogEntry>,
  modelId: string,
): ModelChangeModel {
  const model = models.find((entry) => entry.id === modelId);

  if (model === undefined) return { id: modelId };

  return {
    id: model.id,
    ...(model.name !== undefined && { name: model.name }),
    providerModelId: model.providerModelId,
  };
}

/** `runs.effort` after the switch, as design D5 orders it. */
function effortFor(
  models: Pick<ModelsService, 'validateModelSelection'>,
  run: Pick<Run, 'selectedEffort'>,
  target: NextCandidate,
): string | null {
  const choice = effortAfterSwitch({
    selectedEffort: run.selectedEffort,
    model: models.validateModelSelection(target.modelId),
    candidateEffort: target.candidateEffort,
  });

  return choice.kind === 'effort' ? choice.effort : null;
}

/** The Run row locked SECOND, after the Chat (the wait subsystem's order). */
async function lockOwnedRun(
  tx: Db,
  runId: string,
  userId: string,
): Promise<Run | undefined> {
  const [locked] = await tx
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .for('update');

  return locked;
}

type SwitchInput = {
  readonly chat: Chat;
  readonly run: Run;
  readonly target: NextCandidate;
  readonly awaiting: AwaitingQuota;
  readonly fromJobId: string;
};

/** The error-record half of D4 and the events of the switch. */
async function appendSwitch(
  tx: Db,
  input: {
    readonly chat: Chat;
    readonly run: Run;
    readonly target: NextCandidate;
    readonly awaiting: AwaitingQuota;
    readonly effort: string | null;
    readonly messageId: string;
  },
): Promise<void> {
  const { chat, run, target, awaiting, effort, messageId } = input;
  const chats = new ChatsRepository(tx);

  const hintMs =
    isRecord(run.error) && isNumber(run.error['hintMs'])
      ? run.error['hintMs']
      : null;

  await writeSwitchHold(chats, chat, {
    runSelectionRevision: run.selectionRevision,
    runSelector: run.selector,
    modelId: target.modelId,
    effort,
    revertAt: revertAtFor(
      { resetsAt: awaiting.resetsAt, hintMs },
      await chats.transactionNow(),
    ),
  });

  await new RunEventsRepository(tx).append(run.id, 'model.switched', {
    fromModelId: run.modelId,
    fromEffort: run.effort,
    toModelId: target.modelId,
    toEffort: effort,
    failureClass: awaiting.failureClass,
    messageId,
    origin: 'owner',
  });
}

/** The quota-wait identity the action fences on, or undefined in any other state. */
function quotaFence(
  run: Run,
): { awaiting: AwaitingQuota; fromJobId: string } | undefined {
  const awaiting = run.awaiting;

  if (
    run.status !== 'awaiting_quota' ||
    awaiting?.kind !== 'quota' ||
    run.currentJobId === null
  ) {
    return undefined;
  }

  return { awaiting, fromJobId: run.currentJobId };
}

type DeliveredSwitch = {
  readonly messageId: string;
  readonly effort: string | null;
  readonly nextJobId: string;
};

/**
 * Close the parked reply, store one host message carrying the switch item and
 * the pending steers and notices, and move the Run onto it as a failover
 * delivery. The Run's own state write lives in the move, so it happens exactly
 * once, under the wait's fence.
 */
async function deliverSwitch(
  tx: Db,
  input: SwitchInput & {
    readonly catalog: ReadonlyArray<SystemModelCatalogEntry>;
    readonly models: Pick<ModelsService, 'validateModelSelection'>;
  },
): Promise<DeliveredSwitch> {
  const { chat, run, target, awaiting, fromJobId, catalog } = input;

  await finalizeRunReply(tx, { run, status: 'failed', models: catalog });

  const switchItem = createModelChangeItem({
    oldModel: modelView(catalog, run.modelId),
    newModel: modelView(catalog, target.modelId),
    runId: run.id,
    failureClass: awaiting.failureClass,
  });

  const pending = await new ChatDeliveriesRepository(tx).lockPendingBoundary(
    chat.id,
    run.userId,
  );

  const items = pending.filter((item) => !isCompactCommand(item));

  const message = await storeDeliveredMessage(tx, run, items, {
    leading: [switchItem],
  });

  const effort = effortFor(input.models, run, target);
  const nextJobId = randomUUID();

  await moveWaitingRunToDelivery(tx, run, {
    items,
    message,
    cause: 'failover',
    stoppedCalls: [],
    fromJobId,
    nextJobId,
    modelId: target.modelId,
    effort,
  });

  return { messageId: message.id, effort, nextJobId };
}

@Injectable()
export class NextCandidateService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(ModelsService)
    private readonly models: Pick<
      ModelsService,
      'nextCandidate' | 'validateModelSelection'
    >,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(RunDispatchService)
    private readonly dispatch: Pick<RunDispatchService, 'enqueueInTransaction'>,
  ) {}

  async moveWaitingRun(input: {
    runId: string;
    userId: string;
  }): Promise<NextCandidateOutcome> {
    return retryRunTransaction(() =>
      this.tenantDb.runAs(input.userId, (tx) =>
        this.moveInTransaction(tx, input),
      ),
    );
  }

  /**
   * Ownership is decided before any state read, so another owner's Run is a
   * 404 that leaks nothing; only the owner sees the state refusals.
   */
  private async moveInTransaction(
    tx: Db,
    input: { runId: string; userId: string },
  ): Promise<NextCandidateOutcome> {
    const found = await new RunsRepository(tx).findById(
      input.runId,
      input.userId,
    );

    if (found === undefined) return { kind: 'not-found' };

    const chat = await new ChatsRepository(tx).lock(found.chatId, input.userId);

    if (chat === undefined) return { kind: 'not-found' };

    const run = await lockOwnedRun(tx, input.runId, input.userId);

    if (run === undefined) return { kind: 'not-found' };

    return this.switchInTransaction(tx, { chat, run });
  }

  private async switchInTransaction(
    tx: Db,
    input: { chat: Chat; run: Run },
  ): Promise<NextCandidateOutcome> {
    const fence = quotaFence(input.run);

    const target = switchTargetFor(input.run, (selector, currentModelId) =>
      this.models.nextCandidate(selector, currentModelId),
    );

    if (fence === undefined || target === undefined) {
      return { kind: 'unavailable' };
    }

    const moved = await this.switchRun(tx, { ...input, ...fence, target });

    return { kind: 'moved', run: moved };
  }

  /** The switch itself, in one transaction: close, host, move, hold, wake. */
  private async switchRun(tx: Db, input: SwitchInput): Promise<Run> {
    const { run, target } = input;

    const delivered = await deliverSwitch(tx, {
      ...input,
      catalog: this.instanceConfig.config.models,
      models: this.models,
    });

    await appendSwitch(tx, {
      run,
      target,
      awaiting: input.awaiting,
      chat: input.chat,
      effort: delivered.effort,
      messageId: delivered.messageId,
    });

    await enqueueSuspendedRun(tx, this.dispatch, {
      run: { ...run, modelId: target.modelId },
      userId: run.userId,
      generation: run.wakeGeneration,
      jobId: delivered.nextJobId,
    });

    const moved = await new RunsRepository(tx).findById(run.id, run.userId);

    if (moved === undefined) {
      throw new Error(`Run ${run.id} vanished after its switch.`);
    }

    return moved;
  }
}
