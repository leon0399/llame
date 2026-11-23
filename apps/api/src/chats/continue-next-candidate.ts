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
import { NextCandidateUnavailableError } from '../models/models.service';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { storeDeliveredMessage } from '../runs/segment-delivery-close';
import { type ModelSwitchedPayload } from '../runs/model-switch';
import { RunEventsRepository } from '../runs/runs-repository';
import {
  createModelChangeItem,
  type ModelChangeModel,
} from './context-item-producers';
import { type ContinueNextDecision } from './follow-up-decisions';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { createRunForMessage } from './run-creation';
import { writeSwitchHold } from './selection-update';

/** The opened turn: the host message's Run, its message, and its model. */
export type ContinueNextOutcome =
  | { readonly run: Run; readonly message: Message; readonly modelId: string }
  | { readonly refusal: Error };

/** The target model the decision's candidate names, or its refusal. */
function candidateModel(
  config: LlameConfig,
  modelId: string,
): { model: SystemModelCatalogEntry } | { refusal: Error } {
  const model = config.models.find((entry) => entry.id === modelId);

  if (model === undefined) {
    return {
      refusal: new NextCandidateUnavailableError(
        `Candidate '${modelId}' is no longer configured`,
      ),
    };
  }

  return { model };
}

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

  return {
    resetsAt:
      isNumber(resetsAt) && Number.isFinite(resetsAt)
        ? new Date(resetsAt).toISOString()
        : null,
    hintMs: isNumber(hintMs) && Number.isFinite(hintMs) ? hintMs : null,
  };
}

/**
 * The Continue cut of the failed reply: its parts through the last settled
 * tool part, with its usage, its model, and its Run row untouched.
 */
async function cutContinuedReply(
  tx: Db,
  input: {
    chatId: string;
    userMessageId: string;
    source: Message;
    parts: Array<unknown>;
  },
): Promise<void> {
  await new MessagesRepository(tx).updateAssistantReply({
    id: input.source.id,
    chatId: input.chatId,
    inReplyTo: input.userMessageId,
    parts: input.parts,
  });
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

/**
 * Cut the failed reply, then store the switch's host message. Both precede the
 * new Run, so a refusal later in this transaction leaves neither behind.
 */
async function openHostMessage(
  tx: Db,
  input: {
    chatId: string;
    userMessageId: string;
    latestRun: Run;
    source: Message;
    keptParts: Array<unknown>;
    config: LlameConfig;
    toModel: ModelChangeModel;
  },
): Promise<Message> {
  await cutContinuedReply(tx, {
    chatId: input.chatId,
    userMessageId: input.userMessageId,
    source: input.source,
    parts: input.keptParts,
  });

  return storeSwitchHost(tx, {
    run: input.latestRun,
    fromModel: input.config.models.find(
      (model) => model.id === input.latestRun.modelId,
    ) ?? { id: input.latestRun.modelId },
    toModel: input.toModel,
  });
}

/**
 * The switch's opening: resolve the candidate, cut the failed reply, and store
 * the host message. A refusal here leaves the transaction with nothing written.
 */
async function openSwitch(
  tx: Db,
  input: {
    chatId: string;
    userMessageId: string;
    latestRun: Run;
    source: Message;
    keptParts: Array<unknown>;
    nextModelId: string;
    config: LlameConfig;
  },
): Promise<
  { message: Message; model: SystemModelCatalogEntry } | { refusal: Error }
> {
  const candidate = candidateModel(input.config, input.nextModelId);

  if ('refusal' in candidate) return candidate;

  const message = await openHostMessage(tx, {
    chatId: input.chatId,
    userMessageId: input.userMessageId,
    latestRun: input.latestRun,
    source: input.source,
    keptParts: input.keptParts,
    config: input.config,
    toModel: candidate.model,
  });

  return { message, model: candidate.model };
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
  const chats = new ChatsRepository(tx);

  await writeSwitchHold(chats, chat, {
    runSelectionRevision: latestRun.selectionRevision,
    runSelector: latestRun.selector,
    modelId: input.next.modelId,
    effort: effort ?? null,
    revertAt: revertAtFor(
      failureTiming(latestRun),
      await chats.transactionNow(),
    ),
  });

  await new RunEventsRepository(tx).append(input.run.id, 'model.switched', {
    fromModelId: latestRun.modelId,
    fromEffort: latestRun.effort,
    toModelId: input.next.modelId,
    toEffort: effort ?? null,
    failureClass: failureClassOf(latestRun),
    messageId: input.message.id,
    origin: 'owner',
  } satisfies ModelSwitchedPayload);
}

/** Start the candidate's Run, then record its hold and switch event. */
async function startAndRecord(
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
): Promise<Run> {
  const { run, effort } = await startCandidateRun(tx, input);

  await recordSwitch(tx, {
    latestRun: input.latestRun,
    next: input.next,
    chat: input.turn.chat,
    run,
    message: input.message,
    effort,
  });

  return run;
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
  const { request, turn, decision, permissionMode, config } = input;
  const { latestRun, source, next } = decision;

  const opened = await openSwitch(tx, {
    chatId: request.chatId,
    userMessageId: turn.userMessage.id,
    latestRun,
    source,
    keptParts: decision.keptParts,
    nextModelId: next.modelId,
    config,
  });

  if ('refusal' in opened) return opened;

  const run = await startAndRecord(tx, {
    request,
    turn,
    latestRun,
    next,
    toModel: opened.model,
    permissionMode,
    message: opened.message,
  });

  return { run, message: opened.message, modelId: next.modelId };
}
