/**
 * The Machine tool boundary shared by the native file tools and `bash`: the
 * request envelope, the time budget, the failure vocabulary, and the durable
 * effect fence a Machine mutation or command uses.
 *
 * A Machine operation never binds the Run to the local executor: its attempt is
 * recorded with the unbound fence, exactly like a `kb://` mutation, so a queue
 * retry on another worker replays the recorded outcome instead of failing on an
 * executor the target never needed. What the fence cannot decide is whether a
 * request already reached the Machine, so the connector's `sent` flag selects
 * the result: nothing sent is `machine_unavailable`, and a request sent into a
 * session that then ended is `outcome_unknown` and is never repeated.
 */

import {
  BUDGET_EXHAUSTED_MESSAGE,
  isSerializableRecord,
  MachineProtocolError,
  PATH_NOT_REGISTERED_MESSAGE,
  type JsonValue,
  type ProcBashResult,
  type RequestEnvelope,
  type SerializableRecord,
} from '@workspace/machine-protocol';
import { isBoolean, isString } from '@workspace/runtime-safety';

import type { MachineFailureReason } from '../machines/machines-status';
import {
  MachineUnavailableError,
  type MachineConnector,
} from '../machines/machine-connector.service';
import {
  machineEnvelope,
  machineAttemptKey as attemptKeyFor,
} from '../runs/machine-attempt';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { type ToolContext, type ToolResult } from './types';

/** How long a file operation may take on the Machine, absent a shorter call deadline. */
export const MACHINE_FILE_BUDGET_MS = 60_000;

/** The shared managed-bash duration bound a Machine command may use. */
export const MACHINE_BASH_BUDGET_MS = 300_000;

/**
 * The relative budget a request carries: what is left of this call's deadline,
 * capped at the operation's own bound. The Machine measures it from receipt on
 * its monotonic clock and refuses an exhausted one before any effect.
 */
export function machineBudgetMs(context: ToolContext, ceiling: number): number {
  const remaining = context.timeoutMs;
  return remaining === undefined
    ? ceiling
    : Math.max(1, Math.min(remaining, ceiling));
}

/**
 * The durable identity and time budget every Machine request carries, taken
 * from the live tool context. `runs/machine-attempt.ts` owns the request
 * identity and the default budget; this is the one place a tool context is
 * turned into them, so a tool never builds an envelope of its own.
 */
export function machineCallEnvelope(
  context: ToolContext,
  budgetMs: number,
): RequestEnvelope {
  return machineEnvelope({
    runId: context.runId,
    attemptId: context.machineAttemptKey,
    toolCallId: context.toolCallId,
    deliverySequence: context.nativeDeliverySequence,
    budgetMs,
  });
}

/**
 * The reachability verdict key: one Machine is decided once per attempt, so
 * preparation, instructions, skills, MCP, and later tool calls share the same
 * answer. A context that carries no attempt key falls back to the same formula
 * preparation uses, so a system-origin read shares the attempt's verdict.
 */
export function machineCallAttemptKey(context: ToolContext): string {
  return (
    context.machineAttemptKey ??
    attemptKeyFor(context.runId ?? '', context.nativeDeliverySequence)
  );
}

/** The connector a Machine call runs through; absent means no Machine surface. */
export function machineConnector(
  context: ToolContext,
): MachineConnector | undefined {
  const connector = context.machines;
  return connector?.enabled() === true ? connector : undefined;
}

/** A Machine refusal, narrow enough for a caller that returns only failures. */
export type MachineFailureResult = {
  readonly status: 'error';
  readonly type: string;
  readonly message: string;
};

export function machineNotFoundResult(name: string): MachineFailureResult {
  return {
    status: 'error',
    type: 'machine_not_found',
    message: `No Machine named "${name}" is configured.`,
  };
}

const REASON_TEXT: Readonly<Record<MachineFailureReason, string>> = {
  unreachable: 'it could not be reached',
  host_key_mismatch: 'its host key does not match the pinned one',
  auth_failed: 'authentication failed',
  incompatible_version: 'its daemon speaks an incompatible protocol version',
  session_lost: 'the session was lost',
};

export function machineUnavailableResult(
  name: string,
  reason?: MachineFailureReason,
): MachineFailureResult {
  return {
    status: 'error',
    type: 'machine_unavailable',
    message:
      reason === undefined
        ? `The Machine "${name}" is unavailable.`
        : `The Machine "${name}" is unavailable because ${REASON_TEXT[reason]}.`,
  };
}

/** A mutation or command whose success the hub could not establish. */
export function machineUnknownResult(name: string): MachineFailureResult {
  return {
    status: 'error',
    type: 'outcome_unknown',
    message: `The operation on Machine "${name}" may have executed; inspect it before retrying. It will not be repeated automatically.`,
  };
}

/** The Machine answered a shape this hub cannot use. */
export function machineUnusableResult(name: string): MachineFailureResult {
  return {
    status: 'error',
    type: 'machine_protocol_error',
    message: `The Machine "${name}" answered an unusable result.`,
  };
}

/** A Machine's own JSON-RPC refusal, as a settled tool observation. */
export function machineProtocolFailureResult(
  name: string,
  error: MachineProtocolError,
): MachineFailureResult {
  if (error.code === 'path_not_registered')
    return {
      status: 'error',
      type: 'path_not_registered',
      message: PATH_NOT_REGISTERED_MESSAGE,
    };
  if (error.code === 'budget_exhausted')
    return {
      status: 'error',
      type: 'timed_out',
      message: BUDGET_EXHAUSTED_MESSAGE,
    };
  if (error.code === 'incompatible_version')
    return machineUnavailableResult(name, 'incompatible_version');
  if (error.code === 'invalid_params')
    return {
      status: 'error',
      type: 'invalid_input',
      message: 'The Machine refused the request as invalid.',
    };
  return machineUnavailableResult(name);
}

/**
 * Run one Machine exchange and turn its failure into a tool observation. A
 * read is never `outcome_unknown` (it has no effect to be uncertain about); a
 * mutation reports it exactly when the request had already reached the link.
 */
async function machineCallResult(
  name: string,
  perform: () => Promise<ToolResult>,
  options: { readonly unknownOnSent: boolean },
): Promise<ToolResult> {
  try {
    return await perform();
  } catch (error) {
    if (error instanceof MachineUnavailableError)
      return error.sent && options.unknownOnSent
        ? machineUnknownResult(name)
        : machineUnavailableResult(name, error.reason);
    if (error instanceof MachineProtocolError)
      return machineProtocolFailureResult(name, error);
    throw error;
  }
}

/** A read, listing, or other effect-free exchange with the Machine. */
export function machineReadResult(
  name: string,
  perform: () => Promise<ToolResult>,
): Promise<ToolResult> {
  return machineCallResult(name, perform, { unknownOnSent: false });
}

export type MachineMutationTarget = {
  readonly name: string;
  readonly operation: 'edit' | 'write' | 'bash' | 'worktree';
  /** The canonical Machine locator the attempt records, never a host path. */
  readonly locator: string;
};

/**
 * One fenced Machine mutation or command. Reachability is decided first, so a
 * hopeless Machine records no attempt; the unbound attempt is then durable
 * before the request, its result follows exactly once, and a failure the hub
 * cannot attribute is settled as `outcome_unknown` rather than retried.
 * Serialization is per Machine, so a slow Machine never blocks local or
 * Knowledge writes.
 */
export async function runMachineMutation(
  context: ToolContext,
  target: MachineMutationTarget,
  perform: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const connector = machineConnector(context);
  const { runId, toolCallId, userId } = context;
  if (connector === undefined || !runId || !toolCallId)
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    };
  if (!connector.isConfigured(target.name))
    return machineNotFoundResult(target.name);
  if (!(await connector.reachable(target.name, machineCallAttemptKey(context))))
    return machineUnavailableResult(target.name);
  return connector.serializeMutation(target.name, () =>
    fencedMachineMutation(context, target, perform, {
      runId,
      userId,
      toolCallId,
    }),
  );
}

/** The Run identity a Machine attempt's fence and result event are recorded under. */
type MachineAttemptIdentity = {
  readonly runId: string;
  readonly userId: string;
  readonly toolCallId: string;
};

/**
 * The fenced body of one Machine mutation: the unbound attempt is durable
 * before the request, its result follows exactly once, and a failure already
 * recorded by a retry replays instead of running again.
 */
async function fencedMachineMutation(
  context: ToolContext,
  target: MachineMutationTarget,
  perform: () => Promise<ToolResult>,
  identity: MachineAttemptIdentity,
): Promise<ToolResult> {
  const prior = await beginMachineAttempt(context, target, identity);
  if (prior) return prior;
  context.abortSignal?.throwIfAborted();
  const settled = await machineCallResult(target.name, perform, {
    unknownOnSent: true,
  });
  await context.tenantDb.runAs(identity.userId, async (db) => {
    await new RunEventsRepository(db).append(identity.runId, 'native.result', {
      toolCallId: identity.toolCallId,
      result: settled,
    });
  });
  return settled;
}

/** The durable unbound attempt, or the settled outcome a retry replays. */
function beginMachineAttempt(
  context: ToolContext,
  target: MachineMutationTarget,
  identity: MachineAttemptIdentity,
): Promise<ToolResult | undefined> {
  return context.tenantDb.runAs(identity.userId, (db) =>
    new NativeFilesRepository(db).begin({
      runId: identity.runId,
      userId: identity.userId,
      fence: { bound: false },
      deliverySequence: context.nativeDeliverySequence,
      toolCallId: identity.toolCallId,
      operation: target.operation,
      path: target.locator,
    }),
  );
}

/** One `bytes` notification's payload, as the chunk buffer it carries. */
export function readBytesChunk(
  params: JsonValue | undefined,
): Buffer | undefined {
  if (!isSerializableRecord(params)) return undefined;
  const data = params['data'];
  return isString(data) ? Buffer.from(data, 'base64') : undefined;
}

/** Whether the value is a whole number, as an exit code or a duration is. */
function isInteger(value: unknown): value is number {
  // `Number.isInteger` already answers `false` for every non-number, so the
  // type predicate is honest without a redundant `typeof` guard.
  return Number.isInteger(value);
}

/** Whether the value is a whole, non-negative count. */
function isCount(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

/**
 * A `proc.bash` answer, narrowed to the shape `@workspace/bash-executor`
 * returns. A Machine is untrusted input, so every field is rebuilt rather than
 * asserted; an unusable answer narrows to undefined.
 */
export function readProcBashResult(
  value: JsonValue,
): ProcBashResult | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const status = value['status'];
  if (status !== 'success' && status !== 'error') return undefined;
  const type = value['type'];
  if (type === undefined) return readManagedBashResult(value, status);
  if (status !== 'error') return undefined;
  if (type === 'timed_out') return readTimedOutBashResult(value);
  if (type === 'outcome_unknown') return readUnknownBashResult(value);
  return readRefusedBashResult(value);
}

/** The managed-bash answer, whose operation and executor name the local shape. */
function readManagedBashResult(
  value: SerializableRecord,
  status: 'success' | 'error',
): ProcBashResult | undefined {
  const exitCode = value['exitCode'];
  const stdout = value['stdout'];
  const stderr = value['stderr'];
  const truncated = value['truncated'];
  if (
    value['operation'] !== 'bash' ||
    value['executor'] !== 'managed' ||
    !isInteger(exitCode) ||
    !isString(stdout) ||
    !isString(stderr) ||
    !isBoolean(truncated)
  )
    return undefined;
  return {
    status,
    operation: 'bash',
    executor: 'managed',
    exitCode,
    stdout,
    stderr,
    truncated,
  };
}

/** The daemon's own deadline refusal, with the output captured before it. */
function readTimedOutBashResult(
  value: SerializableRecord,
): ProcBashResult | undefined {
  const durationMs = value['durationMs'];
  const stdout = value['stdout'];
  const stderr = value['stderr'];
  const truncated = value['truncated'];
  if (
    !isCount(durationMs) ||
    !isString(stdout) ||
    !isString(stderr) ||
    !isBoolean(truncated)
  )
    return undefined;
  return {
    status: 'error',
    type: 'timed_out',
    durationMs,
    stdout,
    stderr,
    truncated,
  };
}

/** A command the daemon dispatched but could not attribute an outcome to. */
function readUnknownBashResult(
  value: SerializableRecord,
): ProcBashResult | undefined {
  const attemptId = value['attemptId'];
  const message = value['message'];
  if (!isString(attemptId) || !isString(message)) return undefined;
  return { status: 'error', type: 'outcome_unknown', attemptId, message };
}

/** The daemon's refusals that carry no result beyond their own message. */
function readRefusedBashResult(
  value: SerializableRecord,
): ProcBashResult | undefined {
  const type = value['type'];
  if (
    type !== 'unavailable' &&
    type !== 'boundary_missing' &&
    type !== 'cancelled'
  )
    return undefined;
  const message = value['message'];
  return isString(message) ? { status: 'error', type, message } : undefined;
}
