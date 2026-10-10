/**
 * The assistant reply's terminal write (design D3/D6): one finalizer every
 * terminal writer calls, whether it runs in the worker or the chat module, so
 * no reply created at dispatch stays `running`.
 */
import { isRecord, isString } from '@workspace/runtime-safety';

import {
  MessagesRepository,
  isCompletedAssistantTurn,
} from '../chats/chats-repository';
import { type MessagePart } from '../chats/context-builder';
import { isContextItemPart } from '../chats/context-item';
import { type TurnStatus, type TurnTelemetry } from '../chats/turn-telemetry';
import {
  type Message,
  type Run,
  type RunEvent,
  type RunStatus,
} from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { type BillingMode } from '../models/model-client';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { reconstructDurableAssistant } from './assistant-transcript';
import { NativeFilesRepository } from './native-files-repository';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { toolTerminationResult } from './tool-settlement';

export type TerminalRunStatus = Extract<
  RunStatus,
  'completed' | 'failed' | 'cancelled' | 'expired'
>;

/** The usage an executing attempt measured, stored on its reply. */
export type AssistantTurnTelemetry = TurnTelemetry & {
  runId: string;
  attemptId: string;
  complete?: boolean;
};

/** An attempt's reply as its live part collector holds it. */
export type AssistantTurnWrite = {
  chatId: string;
  inReplyTo: string;
  parts: Array<MessagePart>;
  telemetry: AssistantTurnTelemetry;
};

/** The usage a reply carries while the attempt named in it dispatches. */
export type RunningReplyUsage = {
  readonly status: 'running';
  readonly complete: false;
  readonly runId: string;
  readonly attemptId: string;
  readonly modelId: string;
  readonly effort?: string;
  readonly permissionMode?: 'bypass';
};

/**
 * Terminal usage written by a finalizer that measured nothing for the reply:
 * the reply's identity fields with no tokens, latency, or measured size.
 * `attemptId` is absent only on a legacy reply created from the full log.
 */
type TokenlessReplyUsage = {
  readonly status: TurnStatus;
  readonly complete: false;
  readonly runId: string;
  readonly attemptId?: string;
  readonly modelId: string;
  readonly effort?: string;
  readonly permissionMode?: 'bypass';
  readonly billing?: BillingMode;
};

/** The operator catalog entries billing resolves against. */
export type BillingCatalog = ReadonlyArray<{
  readonly id: string;
  readonly billing?: BillingMode;
}>;

export type RunReplyFinalization = {
  /** The Run row as its terminal transition returned it. */
  readonly run: Run;
  readonly status: TerminalRunStatus;
  /** The settling attempt; absent for a settler outside any attempt. */
  readonly attemptId?: string;
  /** The settling attempt's live collector, when the settler holds it. */
  readonly live?: AssistantTurnWrite;
  /** Usage the settling attempt synthesized without its collector. */
  readonly telemetry?: AssistantTurnTelemetry;
  readonly models: BillingCatalog;
};

type ReplyWrite = {
  readonly parts: Array<MessagePart>;
  readonly usage: AssistantTurnTelemetry | TokenlessReplyUsage;
};

export function turnStatusForTerminalRun(
  status: TerminalRunStatus,
): TurnStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'error';
  return 'aborted';
}

/**
 * The reply usage the dispatch transaction writes: `effort` only when the Run
 * has one, `permissionMode` only when the attempt's effective mode is bypass.
 */
export function runningReplyUsage(input: {
  runId: string;
  attemptId: string;
  modelId: string;
  effort: string | undefined;
  permissionMode: PermissionMode;
}): RunningReplyUsage {
  return {
    status: 'running',
    complete: false,
    runId: input.runId,
    attemptId: input.attemptId,
    modelId: input.modelId,
    ...(input.effort !== undefined && { effort: input.effort }),
    ...(input.permissionMode === 'bypass' && {
      permissionMode: 'bypass' as const,
    }),
  };
}

/** The stored usage of a reply whose attempt has not settled it. */
export function readRunningUsage(
  usage: unknown,
): RunningReplyUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const { status, runId, attemptId, modelId, effort } = usage;
  if (
    status !== 'running' ||
    !isString(runId) ||
    !isString(attemptId) ||
    !isString(modelId)
  ) {
    return undefined;
  }
  return {
    status: 'running',
    complete: false,
    runId,
    attemptId,
    modelId,
    ...(isString(effort) && { effort }),
    ...(usage['permissionMode'] === 'bypass' && {
      permissionMode: 'bypass' as const,
    }),
  };
}

/** The attempt a reply's usage names, whatever its status. */
export function replyAttemptId(usage: unknown): string | undefined {
  if (!isRecord(usage)) return undefined;
  const attemptId = usage['attemptId'];
  return isString(attemptId) ? attemptId : undefined;
}

function tokenlessUsage(
  identity: {
    runId: string;
    attemptId?: string;
    modelId: string;
    effort?: string;
    permissionMode?: 'bypass';
  },
  status: TerminalRunStatus,
  models: BillingCatalog,
): TokenlessReplyUsage {
  const billing = models.find(({ id }) => id === identity.modelId)?.billing;
  return {
    status: turnStatusForTerminalRun(status),
    complete: false,
    runId: identity.runId,
    ...(identity.attemptId !== undefined && { attemptId: identity.attemptId }),
    modelId: identity.modelId,
    ...(identity.effort !== undefined && { effort: identity.effort }),
    ...(identity.permissionMode !== undefined && {
      permissionMode: identity.permissionMode,
    }),
    ...(billing !== undefined && { billing }),
  };
}

/**
 * One attempt's events: from the `model.requested` that names it up to the
 * next attempt's `run.started`, or the end of the log. Empty when no request
 * names the attempt.
 */
export function attemptWindow(
  events: ReadonlyArray<RunEvent>,
  attemptId: string,
): Array<RunEvent> {
  const start = events.findIndex(
    (event) =>
      event.eventType === 'model.requested' &&
      replyAttemptId(event.payload) === attemptId,
  );
  if (start === -1) return [];
  const end = events.findIndex(
    (event, index) => index > start && event.eventType === 'run.started',
  );
  return events.slice(start, end === -1 ? undefined : end);
}

function toolCallIdOf(part: unknown): string | undefined {
  if (!isRecord(part)) return undefined;
  const toolCallId = part['toolCallId'];
  return isString(toolCallId) ? toolCallId : undefined;
}

/**
 * Places each context item of a stored part snapshot among parts rebuilt from
 * events: after the last rebuilt part whose `toolCallId` appears anywhere
 * before the item in the snapshot, at the start when none survives, and after
 * any item already placed there, so items keep their snapshot order.
 */
export function placeStoredContextItems(
  rebuilt: ReadonlyArray<MessagePart>,
  snapshot: ReadonlyArray<unknown>,
): Array<MessagePart> {
  const placed: Array<MessagePart> = [...rebuilt];
  const earlierToolCallIds = new Set<string>();
  for (const part of snapshot) {
    if (!isContextItemPart(part)) {
      const toolCallId = toolCallIdOf(part);
      if (toolCallId !== undefined) earlierToolCallIds.add(toolCallId);
      continue;
    }
    let index =
      placed.findLastIndex((candidate) => {
        const toolCallId = toolCallIdOf(candidate);
        return toolCallId !== undefined && earlierToolCallIds.has(toolCallId);
      }) + 1;
    while (index < placed.length && isContextItemPart(placed[index])) {
      index += 1;
    }
    placed.splice(index, 0, part);
  }
  return placed;
}

/**
 * Settles every tool call the log leaves open, appending its `tool.completed`
 * event, and returns those events. A completing Run cannot leave one open.
 */
async function settleOpenToolCalls(
  tx: Db,
  run: Run,
  status: TerminalRunStatus,
  log: Array<RunEvent>,
): Promise<Array<RunEvent>> {
  const events = new RunEventsRepository(tx);
  const appended: Array<RunEvent> = [];
  const { openToolCalls } = reconstructDurableAssistant(log);
  for (const [toolCallId, { toolName, permission }] of openToolCalls) {
    if (status === 'completed') {
      throw new Error(
        `Run ${run.id} cannot complete with durable tool calls still open.`,
      );
    }
    const nativeResult =
      toolName === 'edit' ||
      toolName === 'write' ||
      toolName === 'bash' ||
      toolName.startsWith('mcp__')
        ? await new NativeFilesRepository(tx).priorOutcome(run.id, toolCallId)
        : undefined;
    const result = nativeResult ?? toolTerminationResult(status, toolName);
    appended.push(
      await events.append(run.id, 'tool.completed', {
        toolCallId,
        toolName,
        status: result.status,
        output: result,
        ...(permission !== undefined && { permission }),
      }),
    );
  }
  return appended;
}

/** The reply write for a settler holding its attempt's live collector. */
function liveReplyWrite(
  input: RunReplyFinalization,
  live: AssistantTurnWrite,
  reply: Message | undefined,
): ReplyWrite | undefined {
  if (reply !== undefined) {
    const running = readRunningUsage(reply.usage);
    // Another attempt's reply, or one another writer already settled.
    if (running?.attemptId !== input.attemptId) return undefined;
  }
  return { parts: live.parts, usage: live.telemetry };
}

/**
 * The reply write for a settler without the attempt's collector. `settled`
 * completes calls the log left open; a window ignores those it never opened.
 */
function rebuiltReplyWrite(
  input: RunReplyFinalization,
  reply: Message | undefined,
  log: Array<RunEvent>,
  settled: Array<RunEvent>,
): ReplyWrite | undefined {
  if (reply !== undefined) {
    const running = readRunningUsage(reply.usage);
    if (running === undefined) return undefined;
    const rebuilt = reconstructDurableAssistant([
      ...attemptWindow(log, running.attemptId),
      ...settled,
    ]).collector.parts();
    return {
      parts: placeStoredContextItems(rebuilt, reply.parts),
      usage:
        input.telemetry !== undefined && input.attemptId === running.attemptId
          ? input.telemetry
          : tokenlessUsage(running, input.status, input.models),
    };
  }
  // No reply row: only a Run dispatched before the reply layer has output to
  // keep; one that never dispatched gets no reply and no usage.
  if (!log.some((event) => event.eventType === 'model.requested')) {
    return undefined;
  }
  return {
    parts: reconstructDurableAssistant([...log, ...settled]).collector.parts(),
    usage:
      input.telemetry ??
      tokenlessUsage(
        {
          runId: input.run.id,
          modelId: input.run.modelId,
          ...(input.run.effort !== null && { effort: input.run.effort }),
        },
        input.status,
        input.models,
      ),
  };
}

/**
 * Writes the reply onto its row, or creates it when the triggering user row
 * still exists; a deleted chat or user turn is skipped rather than hitting the
 * `in_reply_to` foreign key.
 */
export async function persistReply(
  messagesRepo: MessagesRepository,
  turn: { userMessage?: Message; assistantMessage?: Message },
  write: {
    chatId: string;
    inReplyTo: string;
    parts: Array<MessagePart>;
    usage: unknown;
  },
): Promise<Message | undefined> {
  if (turn.assistantMessage) {
    return messagesRepo.updateAssistantReply({
      id: turn.assistantMessage.id,
      chatId: write.chatId,
      inReplyTo: write.inReplyTo,
      parts: write.parts,
      usage: write.usage,
    });
  }
  if (!turn.userMessage) return undefined;
  return messagesRepo.createAssistantReplyIfAbsent({
    chatId: write.chatId,
    parts: write.parts,
    usage: write.usage,
    inReplyTo: write.inReplyTo,
  });
}

/**
 * Finalizes a terminal Run's reply (design D3/D6), after settling the tool
 * calls its log leaves open. The live collector's parts win when the settler
 * holds them; otherwise the reply is rebuilt from the events of the attempt
 * its usage names, around the context items stored on it. Without a reply
 * row, a Run whose log has a `model.requested` gets one from its full log;
 * one that never dispatched gets nothing. A completed reply is never touched.
 */
export async function finalizeRunReply(
  tx: Db,
  input: RunReplyFinalization,
): Promise<Message | undefined> {
  const { run } = input;
  const log = await new RunEventsRepository(tx).listByRunId(run.id, run.userId);
  const settled = await settleOpenToolCalls(tx, run, input.status, log);
  const chatId = input.live?.chatId ?? run.chatId;
  const inReplyTo = input.live?.inReplyTo ?? run.messageId;
  if (inReplyTo === null) return undefined;
  const messagesRepo = new MessagesRepository(tx);
  const turn = await messagesRepo.findTurnState(chatId, run.userId, inReplyTo);
  const reply = turn.assistantMessage;
  if (reply !== undefined && isCompletedAssistantTurn(reply)) return undefined;
  const write =
    input.live !== undefined
      ? liveReplyWrite(input, input.live, reply)
      : rebuiltReplyWrite(input, reply, log, settled);
  if (write === undefined) return undefined;
  return persistReply(messagesRepo, turn, { chatId, inReplyTo, ...write });
}

/**
 * Mark a run failed, finalize its reply, and append its `run.failed` event, in
 * one tenant-scoped transaction. Shared by every failure origin that must
 * produce the same outcome — enqueue failure (RunDispatchService) and pickup
 * failure (RunsWorkerService) — so the run row, its reply, and its event log
 * can never disagree about why a run ended.
 */
export async function failRunTransactionally(
  tenantDb: TenantRunner,
  job: { runId: string; userId: string },
  message: string,
  models: BillingCatalog,
): Promise<void> {
  await tenantDb.runAs(job.userId, async (tx) => {
    const failed = await new RunsRepository(tx).markFinished(
      job.runId,
      job.userId,
      'failed',
      { error: { message } },
    );
    if (failed) {
      await finalizeRunReply(tx, { run: failed, status: 'failed', models });
      await new RunEventsRepository(tx).append(job.runId, 'run.failed', {
        status: 'failed',
        message,
      });
    }
  });
}
