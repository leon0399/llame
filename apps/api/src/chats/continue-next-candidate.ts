/**
 * Continue on the next candidate of a failed turn Run (model-roles D7): the
 * source Run is terminal, so the whole switch runs in admission's transaction —
 * the Continue cut keeps the failed reply's settled parts with its usage and
 * model, a host message carries the `failover` item, the new Run starts on that
 * message as an ordinary first segment, and the Chat takes the fallback hold of
 * D4 with the effort of D5. Split from `follow-up-admission.service.ts` so the
 * transaction stays a sequence of calls.
 */

import { randomUUID } from 'node:crypto';

import { isNumber, isRecord } from '@workspace/runtime-safety';

import { type Chat, type Message, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type LlameConfig } from '../instance-config/llame-config';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import {
  effortAfterSwitch,
  revertAtFor,
  type FailureTiming,
} from '../models/model-selection';
import {
  FAILURE_CLASSES,
  type FailureClass,
} from '../models/provider-failure/provider-failure';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { storeDeliveredMessage } from '../runs/segment-delivery-close';
import {
  createModelChangeItem,
  type ModelChangeModel,
} from './context-item-producers';
import { type ContinueNextDecision } from './follow-up-decisions';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { createRunForMessage } from './run-creation';
import { recordOwnerSwitch } from './selection-update';

/** The opened turn: the host message's Run, its message, and its model. */
export type ContinueNextOutcome = {
  readonly run: Run;
  readonly message: Message;
  readonly modelId: string;
};

/**
 * The failure class a failed Run recorded, as the switch item names it. A Run
 * whose stored error carries no known class still switches, under `unknown`,
 * so the item never invents a provider reason.
 */
function failureClassOf(run: Run): FailureClass {
  const error = run.error;

  if (!isRecord(error)) return 'unknown';

  const code = error['code'];

  return FAILURE_CLASSES.find((known) => known === code) ?? 'unknown';
}

/**
 * The saved timing of a failed Run's error, parsed from its JSON value. The
 * stored `resetsAt` is a millisecond instant; the hold stores ISO instants.
 */
function failureTiming(run: Run): FailureTiming {
  const error = run.error;

  if (!isRecord(error)) return { resetsAt: null, hintMs: null };

  const { resetsAt, hintMs } = error;

  const resetDate =
    isNumber(resetsAt) && Number.isFinite(resetsAt) ? new Date(resetsAt) : null;

  return {
    resetsAt:
      resetDate !== null && Number.isFinite(resetDate.getTime())
        ? resetDate.toISOString()
        : null,
    hintMs: isNumber(hintMs) && Number.isFinite(hintMs) ? hintMs : null,
  };
}

/** The host message of the switch: one `failover` item, no owner text. */
function storeSwitchHost(
  tx: Db,
  input: {
    run: Run;
    fromModel: ModelChangeModel;
    toModel: ModelChangeModel;
  },
): Promise<Message> {
  return storeDeliveredMessage(tx, input.run, [], {
    leading: [
      createModelChangeItem({
        oldModel: input.fromModel,
        newModel: input.toModel,
        runId: input.run.id,
        failureClass: failureClassOf(input.run),
      }),
    ],
  });
}

/** The Run row of the new candidate, continuing no parts from the log. */
async function startCandidateRun(
  tx: Db,
  input: {
    request: { chatId: string; userId: string };
    turn: { chat: Chat };
    latestRun: Run;
    next: { modelId: string; candidateEffort?: string };
    toModel: SystemModelCatalogEntry;
    permissionMode: PermissionMode;
    message: Message;
  },
): Promise<{ run: Run; effort: string | undefined }> {
  const choice = effortAfterSwitch({
    selectedEffort: input.latestRun.selectedEffort,
    model: input.toModel,
    candidateEffort: input.next.candidateEffort,
  });

  const effort = choice.kind === 'effort' ? choice.effort : undefined;

  const { run } = await createRunForMessage(
    tx,
    {
      userId: input.request.userId,
      chatId: input.request.chatId,
      modelId: input.next.modelId,
      selector: input.latestRun.selector,
      effort,
      selectedEffort: input.latestRun.selectedEffort ?? undefined,
      selectionRevision: input.turn.chat.modelSelection?.revision ?? null,
      permissionMode: input.permissionMode,
      targetRunId: randomUUID(),
      followUpAction: 'continue',
      sourceRunId: input.latestRun.id,
    },
    input.message,
  );

  return { run, effort };
}

async function openHostMessage(
  tx: Db,
  input: {
    chatId: string;
    userMessageId: string;
    latestRun: Run;
    source?: Message;
    keptParts: Array<unknown>;
    fromModel: ModelChangeModel;
    toModel: SystemModelCatalogEntry;
  },
): Promise<Message> {
  if (input.source !== undefined) {
    await new MessagesRepository(tx).updateAssistantReply({
      id: input.source.id,
      chatId: input.chatId,
      inReplyTo: input.userMessageId,
      parts: input.keptParts,
    });
  }

  return storeSwitchHost(tx, {
    run: input.latestRun,
    fromModel: input.fromModel,
    toModel: input.toModel,
  });
}

/**
 * Write the hold and the switch event of the new candidate. The hold lands
 * only while the owner's selection still carries the revision this Run read.
 */
async function recordSwitch(
  tx: Db,
  input: {
    latestRun: Run;
    next: { modelId: string };
    chat: Chat;
    run: Run;
    message: Message;
    effort: string | undefined;
  },
): Promise<void> {
  const { latestRun, chat, effort } = input;

  await recordOwnerSwitch(tx, {
    chat,
    run: latestRun,
    eventRunId: input.run.id,
    toModelId: input.next.modelId,
    toEffort: effort ?? null,
    failureClass: failureClassOf(latestRun),
    messageId: input.message.id,
    revertAt: revertAtFor(
      failureTiming(latestRun),
      await new ChatsRepository(tx).transactionNow(),
    ),
  });
}

/**
 * Open the next candidate of a failed turn Run in the caller's transaction.
 * The source Run is already terminal, so no attempt fence applies: the write
 * order is the cut, the host message, the Run, the hold, and the switch event.
 */
export async function openContinueNextCandidate(
  tx: Db,
  input: {
    request: { readonly chatId: string; readonly userId: string };
    turn: { readonly chat: Chat; readonly userMessage: Message };
    decision: Extract<ContinueNextDecision, { latestRun: Run }>;
    permissionMode: PermissionMode;
    config: LlameConfig;
  },
): Promise<ContinueNextOutcome> {
  const { request, turn, decision, config } = input;
  const { latestRun, next } = decision;

  const message = await openHostMessage(tx, {
    ...request,
    userMessageId: turn.userMessage.id,
    ...decision,
    fromModel: config.models.find(
      (model) => model.id === latestRun.modelId,
    ) ?? { id: latestRun.modelId },
    toModel: next.model,
  });

  const { run, effort } = await startCandidateRun(tx, {
    ...input,
    latestRun,
    next,
    toModel: next.model,
    message,
  });

  await recordSwitch(tx, {
    latestRun,
    next,
    chat: turn.chat,
    run,
    message,
    effort,
  });

  return { run, message, modelId: next.modelId };
}
