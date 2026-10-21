/**
 * The `ssh://` branch of `bash` (ssh-locator design D6): one `bash -s` script
 * on stdin over the resolved binding the admission step produced. The script
 * enters the working directory first, exports the permitted `env` entries,
 * prints the per-call start marker, runs the model's command through `eval`
 * with an empty stdin, and prints the end trailer with the status of that
 * subshell.
 *
 * Nothing model supplied reaches either argv: the cwd, each value, and the
 * command travel only inside single-quoted script words on stdin. The local
 * bounds, the shared process slot, and the unbound native attempt are the
 * local and Machine `bash` ones. Before the start marker ssh's own refusal can
 * still name a known failure; after it, anything but the end trailer is
 * `outcome_unknown` and is never replayed.
 */

import {
  managedEnvironmentCollision,
  measureManagedInput,
  reserveManagedProcessSlot,
  sanitizeKnownResult,
  unusableWorkingDirectory,
  type BashExecutorContext,
} from '@workspace/bash-executor';

import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import {
  type SshBinding,
  type SshClient,
  type SshRunOutcome,
} from '../ssh/ssh-client';
import { parseSshLocator } from '../ssh/ssh-locator';
import {
  classifySshBashOutcome,
  type SshBashVerdict,
} from '../ssh/ssh-read-failure';
import {
  SSH_READ_NOISE_BYTES,
  buildSshBashScript,
  createSshNonce,
  parseSshBashFrames,
  type SshBashFrames,
} from '../ssh/ssh-script';
import { managedBashContext } from './bash-limits';
import { toToolResult } from './bash-result';
import { sshUnavailableResult, sshUnsupportedHostResult } from './ssh-results';
import { type ToolContext, type ToolResult } from './types';

/** The tail kept past the stderr head, so the end trailer survives command output. */
const SSH_BASH_STDERR_TAIL_BYTES = 512;

/** The output bound in UTF-8 bytes: three bytes per UTF-16 code unit. */
const UTF8_BYTES_PER_CODE_UNIT = 3;

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const OUTCOME_UNKNOWN_MESSAGE =
  'The remote command may have executed; the connection ended without its end trailer. It will not be replayed automatically.';

const CANCELLED_BEFORE_START: ToolResult = {
  status: 'error',
  type: 'cancelled',
  message: 'Command was cancelled before start.',
};

/** The command a remote `bash` call runs: model text, never host authority. */
export type SshBashInput = {
  readonly command: string;
  readonly cwd: string;
  readonly env?: Record<string, string>;
};

/** A command whose end the hub could not establish is never replayed. */
function sshOutcomeUnknownResult(): ToolResult {
  return {
    status: 'error',
    type: 'outcome_unknown',
    message: OUTCOME_UNKNOWN_MESSAGE,
  };
}

/** The relative budget one command carries, capped at the shared bash bound. */
function bashBudgetMs(
  context: ToolContext,
  executorContext: BashExecutorContext,
): number {
  const remaining = context.timeoutMs;
  return remaining === undefined
    ? executorContext.durationMs
    : Math.max(1, Math.min(remaining, executorContext.durationMs));
}

/**
 * The `env` refusal, before any attempt or process: each key is an identifier,
 * no value holds NUL, and no entry replaces a managed base variable.
 */
function invalidEnvironment(
  env: Readonly<Record<string, string>>,
): ToolResult | undefined {
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_KEY_PATTERN.test(key))
      return {
        status: 'error',
        type: 'unavailable',
        message: `Environment key ${JSON.stringify(key)} is not a valid name; an ssh:// bash environment key must match [A-Za-z_][A-Za-z0-9_]*.`,
      };
    if (value.includes('\0'))
      return {
        status: 'error',
        type: 'unavailable',
        message: `Environment entry ${JSON.stringify(key)} must not contain NUL.`,
      };
  }
  const collision = managedEnvironmentCollision(env);
  return collision === undefined
    ? undefined
    : {
        status: 'error',
        type: 'unavailable',
        message: `Environment variable ${collision} cannot replace a managed base variable.`,
      };
}

/** The tool result a verdict that is not a complete command becomes. */
function verdictResult(
  verdict: Exclude<SshBashVerdict, { readonly kind: 'complete' }>,
): ToolResult {
  switch (verdict.kind) {
    case 'cancelled':
      return CANCELLED_BEFORE_START;
    case 'unsupported':
      return sshUnsupportedHostResult(verdict.cause);
    case 'unavailable':
      return sshUnavailableResult(verdict.reason);
    case 'unknown':
      return sshOutcomeUnknownResult();
  }
}

/** The finished command as the local result shape, under the local bounds. */
function knownResult(
  frames: SshBashFrames,
  stdoutOverflow: boolean,
  stderrOverflow: boolean,
  executorContext: BashExecutorContext,
): ToolResult {
  const status = frames.status ?? 0;
  return toToolResult(
    sanitizeKnownResult(
      {
        status: status === 0 ? 'success' : 'error',
        operation: 'bash',
        executor: 'managed',
        exitCode: status,
        stdout: frames.stdout.toString('utf8'),
        stderr: frames.stderr,
        truncated: stdoutOverflow || stderrOverflow,
      },
      executorContext,
    ),
  );
}

/** Everything one remote command needs, all of it trusted context. */
type RemoteCommand = {
  readonly client: SshClient;
  readonly binding: SshBinding;
  readonly cwd: string;
  readonly input: SshBashInput;
  readonly nonce: string;
  readonly context: ToolContext;
  readonly executorContext: BashExecutorContext;
  readonly budgetMs: number;
};

/** The result one command's frames become, complete or not. */
function commandResult(
  request: RemoteCommand,
  outcome: SshRunOutcome,
  frames: SshBashFrames,
): ToolResult {
  // Only the host can test the cwd, so the durable attempt precedes SSH and a
  // failed `cd` arrives as a refusal frame: a known result, not an attempt-free
  // refusal as a local unusable cwd is.
  if (frames.refusal !== undefined)
    return frames.refusal === 'cwd'
      ? toToolResult(unusableWorkingDirectory(request.input.cwd))
      : sshOutcomeUnknownResult();
  const verdict = classifySshBashOutcome(outcome, frames);
  if (verdict.kind !== 'complete') return verdictResult(verdict);
  // The classifier reports complete only for an ended process; a failed one
  // cannot carry a trailer to trust.
  return outcome.outcome === 'ended'
    ? knownResult(
        frames,
        outcome.stdoutOverflow,
        outcome.stderrOverflow,
        request.executorContext,
      )
    : sshOutcomeUnknownResult();
}

/** Run one command and turn its frames into the tool result. */
async function runRemoteCommand(request: RemoteCommand): Promise<ToolResult> {
  const { client, binding, context } = request;
  const outcome = await client.run({
    destination: binding.destination,
    resolved: binding,
    remoteCommand: ['bash', '-s'],
    input: buildSshBashScript({
      nonce: request.nonce,
      cwd: request.cwd,
      env: request.input.env ?? {},
      command: request.input.command,
    }),
    maxStdoutBytes:
      request.executorContext.outputBound * UTF8_BYTES_PER_CODE_UNIT +
      SSH_READ_NOISE_BYTES,
    deadlineMs: request.budgetMs,
    // A command's own stderr precedes the trailer, so the head alone would
    // lose it for a chatty command.
    stderrTailBytes: SSH_BASH_STDERR_TAIL_BYTES,
    ...(context.abortSignal !== undefined && { signal: context.abortSignal }),
  });
  return commandResult(
    request,
    outcome,
    parseSshBashFrames(
      outcome.outcome === 'ended' ? outcome.stdout : Buffer.alloc(0),
      outcome.diagnostic,
      request.nonce,
    ),
  );
}
/** The Run identity the unbound attempt and its result are recorded under. */
type AttemptIdentity = {
  readonly runId: string;
  readonly userId: string;
  readonly toolCallId: string;
};

function attemptIdentity(context: ToolContext): AttemptIdentity | undefined {
  const { runId, userId, toolCallId } = context;
  return runId === undefined || toolCallId === undefined
    ? undefined
    : { runId, userId, toolCallId };
}

/** The durable unbound attempt, or the settled outcome a retry replays. */
function beginAttempt(
  context: ToolContext,
  identity: AttemptIdentity,
  locator: string,
): Promise<ToolResult | undefined> {
  return context.tenantDb.runAs(identity.userId, (db) =>
    new NativeFilesRepository(db).begin({
      runId: identity.runId,
      userId: identity.userId,
      fence: { bound: false },
      deliverySequence: context.nativeDeliverySequence,
      toolCallId: identity.toolCallId,
      operation: 'bash',
      path: locator,
    }),
  );
}

/**
 * The fenced body: the unbound attempt is durable before SSH starts, its
 * result follows once, and a failure already recorded by a retry replays
 * instead of running the command again.
 */
async function fencedRemoteCommand(
  context: ToolContext,
  identity: AttemptIdentity,
  binding: SshBinding,
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const prior = await beginAttempt(context, identity, binding.locator);
  if (prior) return prior;
  const settled = await run();
  await context.tenantDb.runAs(identity.userId, async (db) => {
    await new RunEventsRepository(db).append(identity.runId, 'native.result', {
      toolCallId: identity.toolCallId,
      result: settled,
    });
  });
  return settled;
}

/** The submitted locator with the client and binding admission resolved. */
type RemoteTarget = {
  readonly path: string;
  readonly client: SshClient;
  readonly binding: SshBinding;
};

/** The locator and binding this call may use, or the refusal that replaces it. */
function remoteTarget(
  context: ToolContext,
  input: SshBashInput,
): RemoteTarget | ToolResult {
  const parsed = parseSshLocator(input.cwd);
  if (parsed.kind !== 'path' || parsed.selector !== undefined)
    return {
      status: 'error',
      type: 'invalid_path',
      message:
        'An ssh:// working directory is one absolute path without a selector.',
    };
  const { sshClient: client, sshBinding: binding } = context;
  return client === undefined || binding === undefined
    ? {
        status: 'error',
        type: 'invalid_path',
        message: 'This path scheme is not available.',
      }
    : { path: parsed.path, client, binding };
}

/** A call already ended before it started, as the local call would report it. */
function preStartResult(
  context: ToolContext,
  budgetMs: number,
): ToolResult | undefined {
  if (context.timeoutSignal?.aborted)
    return toToolResult({
      status: 'error',
      type: 'timed_out',
      durationMs: budgetMs,
      stdout: '',
      stderr: '',
      truncated: false,
    });
  return context.abortSignal?.aborted === true
    ? CANCELLED_BEFORE_START
    : undefined;
}

/** One admitted command under the shared slot, with its durable attempt. */
async function runWithSlot(
  context: ToolContext,
  input: SshBashInput,
  target: RemoteTarget,
  executorContext: BashExecutorContext,
): Promise<ToolResult> {
  const budgetMs = bashBudgetMs(context, executorContext);
  const slot = reserveManagedProcessSlot(executorContext);
  if ('type' in slot) return toToolResult(slot);
  try {
    const preStart = preStartResult(context, budgetMs);
    if (preStart !== undefined) return preStart;
    const identity = attemptIdentity(context);
    if (identity === undefined)
      return {
        status: 'error',
        type: 'executor_unavailable',
        message: 'Native host authority is unavailable.',
      };
    return await fencedRemoteCommand(context, identity, target.binding, () =>
      runRemoteCommand({
        client: target.client,
        binding: target.binding,
        cwd: target.path,
        input,
        nonce: createSshNonce(),
        context,
        executorContext,
        budgetMs,
      }),
    );
  } finally {
    slot.release();
  }
}

/**
 * Run one `bash` call with an `ssh://` working directory. The locator is
 * re-parsed here because execution gets the submitted text; the binding
 * carries the address the admission resolved and judged.
 */
export async function executeSshBash(
  context: ToolContext,
  input: SshBashInput,
): Promise<ToolResult> {
  const target = remoteTarget(context, input);
  if ('status' in target) return target;
  const executorContext = managedBashContext(context);
  const invalid = invalidEnvironment(input.env ?? {});
  if (invalid !== undefined) return invalid;
  // The bound measures what a local call measures: the command, its fixed
  // argv, the directory, and each addition.
  if (
    measureManagedInput({
      command: input.command,
      args: ['-s'],
      cwd: target.path,
      env: input.env,
    }) > executorContext.inputBound
  )
    return {
      status: 'error',
      type: 'unavailable',
      message: 'Command input exceeds the managed input bound.',
    };
  return runWithSlot(context, input, target, executorContext);
}
