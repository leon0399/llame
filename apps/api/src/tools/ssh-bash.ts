/**
 * The `ssh://` branch of `bash` (ssh-locator design D6): one `bash -s` script
 * on stdin over the resolved binding the admission step produced. The script
 * enters the working directory first, prints the per-call start markers, runs
 * the model's command through `eval` in a subshell with an empty stdin — the
 * permitted `env` entries are exported there, so no entry can overwrite a
 * variable the script itself reads — and prints the end trailer with the
 * status of that subshell.
 *
 * Nothing model supplied reaches either argv: the cwd, each value, and the
 * command travel only inside single-quoted script words on stdin. The local
 * bounds, the shared process slot, and the unbound native attempt are the
 * local and Machine `bash` ones. Before the start marker, a process that ended
 * on its own can still name a known failure; once SSH is spawned, anything but
 * the end trailer is `outcome_unknown` and is never replayed.
 */

import {
  measureManagedInput,
  sanitizeKnownResult,
  streamOutputBound,
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
import { acquireBashSlot, managedBashContext } from './bash-limits';
import { toToolResult } from './bash-result';
import { spillBashResult } from './bash-spill';
import { sshUnavailableResult, sshUnsupportedHostResult } from './ssh-results';
import { type ToolContext, type ToolResult } from './types';

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

/** The tool result a verdict that is not a complete command becomes. */
function verdictResult(
  verdict: Exclude<SshBashVerdict, { readonly kind: 'complete' }>,
): ToolResult {
  switch (verdict.kind) {
    case 'unsupported':
      return sshUnsupportedHostResult(verdict.cause);
    case 'unavailable':
      return sshUnavailableResult(verdict.reason);
    case 'unknown':
      return sshOutcomeUnknownResult();
  }
}

/** An SSH run that ended on its own: its streams and trailer are trustworthy. */
type EndedRun = Extract<SshRunOutcome, { readonly outcome: 'ended' }>;

/**
 * Decode the retained bytes, dropping only an incomplete trailing sequence:
 * the byte bound can cut a UTF-8 character, and half of one must not become a
 * replacement character in the result or the artifact. Any other invalid byte
 * — a remote command writing raw 0xff, say — decodes as the replacement
 * character the stream itself produced, and never costs the text after it.
 */
export function decodeUtf8(bytes: Buffer): string {
  return new TextDecoder('utf-8').decode(
    bytes.subarray(0, completeSequenceEnd(bytes)),
  );
}

const CONTINUATION_FLOOR = 0x80;
const CONTINUATION_CEILING = 0xbf;
const TWO_BYTE_LEAD = 0xc2;
const THREE_BYTE_LEAD = 0xe0;
const FOUR_BYTE_LEAD = 0xf0;
const FOUR_BYTE_LIMIT = 0xf4;

/**
 * The offset where the last complete UTF-8 sequence ends. A trailing run of
 * continuation bytes under a valid lead that promises more of them is an
 * incomplete character and is dropped; every other trailing byte stands, so an
 * invalid byte decodes as a replacement character instead of costing text.
 */
function completeSequenceEnd(bytes: Buffer): number {
  const lead = leadIndex(bytes);

  if (lead === undefined) return bytes.length;
  const expected = expectedSequenceLength(bytes[lead]);

  if (expected === 0) return bytes.length;

  return bytes.length - lead < expected ? lead : bytes.length;
}

/** The lead byte of the trailing sequence, or undefined when none is within four bytes. */
function leadIndex(bytes: Buffer): number | undefined {
  const earliest = Math.max(0, bytes.length - 4);

  for (let index = bytes.length - 1; index >= earliest; index -= 1) {
    if (!isContinuation(bytes[index])) return index;
  }

  return undefined;
}

function isContinuation(byte: number): boolean {
  return byte >= CONTINUATION_FLOOR && byte <= CONTINUATION_CEILING;
}

/** How many bytes a valid UTF-8 lead promises; zero for anything invalid. */
function expectedSequenceLength(lead: number): number {
  if (lead >= TWO_BYTE_LEAD && lead <= 0xdf) return 2;

  if (lead >= THREE_BYTE_LEAD && lead <= 0xef) return 3;

  if (lead >= FOUR_BYTE_LEAD && lead <= FOUR_BYTE_LIMIT) return 4;

  return 0;
}

/** The finished command as the local result shape, under the local bounds. */
async function knownResult(
  request: RemoteCommand,
  outcome: EndedRun,
  frames: SshBashFrames,
  wallTimeMs: number,
): Promise<ToolResult> {
  const status = frames.status ?? 0;

  return spillBashResult(
    request.context,
    sanitizeKnownResult(
      {
        status: status === 0 ? 'success' : 'error',
        exitCode: status,
        stdout: decodeUtf8(frames.stdout),
        stderr: frames.stderr,
        truncated: outcome.stdoutOverflow || outcome.stderrOverflow,
        wallTimeMs,
      },
      request.executorContext,
      request.context.configuredCredentials,
      {
        stdout: { endedByLlame: outcome.stdoutOverflow },
        stderr: {
          endedByLlame: outcome.stderrOverflow,
          ...(frames.stderrGapAt !== undefined && {
            gapAt: frames.stderrGapAt,
          }),
        },
      },
    ),
    // An `ssh://` host cannot open a llame host path (D10).
    true,
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
async function commandResult(
  request: RemoteCommand,
  outcome: SshRunOutcome,
  frames: SshBashFrames,
  wallTimeMs: number,
): Promise<ToolResult> {
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
    ? knownResult(request, outcome, frames, wallTimeMs)
    : sshOutcomeUnknownResult();
}

/** Run one command and turn its frames into the tool result. */
async function runRemoteCommand(request: RemoteCommand): Promise<ToolResult> {
  const { client, binding, context } = request;
  // Spawn to settlement of the remote command: the SSH client is spawned
  // inside `run`, and its answer is the settlement.
  const startedAtMs = performance.now();

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
    // The bound is already in bytes (D4), so the buffer takes it as it is:
    // one byte of stream per byte of bound, plus the framing noise the script
    // adds around the command's own output.
    maxStdoutBytes:
      streamOutputBound(request.executorContext).limit + SSH_READ_NOISE_BYTES,
    deadlineMs: request.budgetMs,
    // A command's own stderr precedes the trailer, so the head alone would
    // lose it for a chatty command. The tail is the local output bound in
    // bytes, so a command that reaches the bound still keeps its trailer.
    stderrTailBytes: streamOutputBound(request.executorContext).limit,
    ...(context.abortSignal !== undefined && { signal: context.abortSignal }),
  });

  return commandResult(
    request,
    outcome,
    parseSshBashFrames(
      outcome.outcome === 'ended' ? outcome.stdout : Buffer.alloc(0),
      outcome.diagnostic,
      request.nonce,
      outcome.outcome === 'ended' ? outcome.diagnosticGap : undefined,
    ),
    Math.round(performance.now() - startedAtMs),
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
      attemptId: context.attemptId,
      toolCallId: identity.toolCallId,
      operation: 'bash',
      path: locator,
    }),
  );
}

/**
 * What the fence runs once its attempt is durable: the locator it records, a
 * recheck that can settle the call before SSH starts, and the command.
 */
type FencedCommand = {
  readonly locator: string;
  readonly preStart: () => ToolResult | undefined;
  readonly run: () => Promise<ToolResult>;
};

/**
 * The fenced body: the unbound attempt is durable before SSH starts, its
 * result follows once, and a failure already recorded by a retry replays
 * instead of running the command again.
 */
async function fencedRemoteCommand(
  context: ToolContext,
  identity: AttemptIdentity,
  command: FencedCommand,
): Promise<ToolResult> {
  const prior = await beginAttempt(context, identity, command.locator);

  if (prior) return prior;
  // The attempt write is durable, but a cancellation or deadline that fired
  // while it was awaited must not still start SSH: the known pre-start result
  // settles the attempt as a completed run.
  const settled = command.preStart() ?? (await command.run());
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
  const slot = acquireBashSlot(context);

  if ('status' in slot) return slot;

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

    return await fencedRemoteCommand(context, identity, {
      locator: target.binding.locator,
      preStart: () => preStartResult(context, budgetMs),
      run: () =>
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
    });
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

  // The bound measures what a local call measures, and it governs the model's
  // text the same way: the command, its fixed argv, the directory, and each
  // addition. The quoting the generated script adds is not part of it.
  // The `env` entries and a NUL in the command are refused by the admission,
  // before the destination resolves, so every call that reaches here carries
  // entries this script can export as data.
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
