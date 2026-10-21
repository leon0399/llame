/**
 * The `ssh://` branch of `read` (ssh-locator design D5): one `sh -s` script on
 * stdin over the resolved binding the admission step produced, framed by the
 * per-call nonce, and rendered on the hub with the local readers so contents,
 * line numbers, selector bounds, and the listing form match a local read of the
 * same bytes.
 *
 * A read records no native attempt: it changes nothing, and the result is the
 * answer the call already awaited. Nothing here can start a process without an
 * admitted binding, which is what binds the connection to the address
 * permission was decided on.
 */

import {
  DIRECTORY_TRAVERSAL_BUDGET,
  NativeFileError,
  applySelectorSuffix,
  compareEntries,
  fileMediaType,
  outlineReader,
  renderCollectedDirectory,
  resolveEndRelativeSelector,
  selectMultiRangeLines,
  selectSourceLines,
  splitSourceLines,
  type ReadTarget,
} from '@workspace/native-file-tools';

import { type SshBinding, type SshClient } from '../ssh/ssh-client';
import {
  SSH_LOCATOR_HELP,
  formatSshLocator,
  parseSshLocator,
  type SshPathLocator,
} from '../ssh/ssh-locator';
import {
  type SshReadVerdict,
  classifySshReadOutcome,
} from '../ssh/ssh-read-failure';
import {
  SSH_DIRECTORY_TRANSFER_BYTES,
  SSH_LIST_MAX_ENTRIES,
  SSH_READ_MAX_BYTES,
  SSH_READ_NOISE_BYTES,
  buildSshReadScript,
  createSshNonce,
  isSshReadRefusal,
  parseSshDirectoryEntries,
  parseSshReadFrames,
  type SshReadFrames,
  type SshReadRefusal,
} from '../ssh/ssh-script';
import {
  sshUnavailableResult,
  sshUnsupportedHostResult,
  sshUnsupportedMutationResult,
} from './ssh-results';
import { type ToolContext, type ToolResult } from './types';

/** How long one remote read may take, absent a shorter call deadline. */
export const SSH_READ_BUDGET_MS = 60_000;

/** The line a listing past its transfer bound ends with. */
const MORE_ENTRIES_LINE = '  … more entries exist';

const NOT_FOUND_MESSAGE = 'File not found.';
const UNREADABLE_MESSAGE = 'File could not be read.';
const NOT_REGULAR_MESSAGE =
  'Only a regular file or a directory can be read; a FIFO, socket, or device is never opened.';
const INVALID_UTF8_MESSAGE = 'The remote file is not valid UTF-8 text.';
const FILE_TOO_LARGE_MESSAGE = `The remote file is larger than the ${String(SSH_READ_MAX_BYTES / (1024 * 1024))} MiB read bound; examine it with a bash ssh:// cwd instead.`;
const UNFINISHED_READ_MESSAGE =
  'The remote read did not finish, so the file could not be read.';

const REFUSAL_RESULTS: Record<SshReadRefusal, ToolResult> = {
  not_found: {
    status: 'error',
    type: 'not_found',
    message: NOT_FOUND_MESSAGE,
  },
  not_regular_file: {
    status: 'error',
    type: 'not_regular_file',
    message: NOT_REGULAR_MESSAGE,
  },
  unreadable: {
    status: 'error',
    type: 'executor_unavailable',
    message: UNREADABLE_MESSAGE,
  },
};

/** The relative budget one read carries, capped at the read's own bound. */
function readBudgetMs(context: ToolContext): number {
  const remaining = context.timeoutMs;
  return remaining === undefined
    ? SSH_READ_BUDGET_MS
    : Math.max(1, Math.min(remaining, SSH_READ_BUDGET_MS));
}

function nativeErrorResult(error: unknown): ToolResult | undefined {
  if (!(error instanceof NativeFileError)) return undefined;
  return { status: 'error', type: error.type, message: error.message };
}

function directorySelectorFailure(target: ReadTarget): ToolResult | undefined {
  if (target.outline)
    return {
      status: 'error',
      type: 'invalid_selector',
      message: 'The :outline member is not supported for directory reads.',
    };
  if (target.raw)
    return {
      status: 'error',
      type: 'invalid_selector',
      message: 'The :raw selector is not supported for directory reads.',
    };
  if (target.ranges !== undefined || target.pending?.includes(',') === true)
    return {
      status: 'error',
      type: 'invalid_selector',
      message:
        'Comma-separated selectors are not supported for directory reads.',
    };
  return undefined;
}

/**
 * The verdict a read with no start marker or no trailer reports. A refusal the
 * host named is its own result: the script ran, and it says which precondition
 * failed.
 */
function failureResult(verdict: SshReadVerdict): ToolResult {
  if (verdict.kind === 'cancelled')
    return {
      status: 'error',
      type: 'cancelled',
      message: 'Tool "read" was cancelled.',
    };
  if (verdict.kind === 'unsupported')
    return sshUnsupportedHostResult(verdict.cause);
  if (verdict.kind === 'unavailable')
    return sshUnavailableResult(verdict.reason);
  return sshUnavailableResult('session_lost');
}

/** The error result a rendering helper threw, when it is a native refusal. */
function refusedRendering(error: unknown): ToolResult {
  return (
    nativeErrorResult(error) ?? {
      status: 'error',
      type: 'executor_unavailable',
      message: UNREADABLE_MESSAGE,
    }
  );
}

/**
 * The transferred bytes as strict UTF-8 text, or the refusal that replaces the
 * read. A file over the bound is refused before decoding; NUL stays valid text.
 */
function remoteText(
  content: Buffer,
): { text: string } | { result: ToolResult } {
  if (content.byteLength > SSH_READ_MAX_BYTES)
    return {
      result: {
        status: 'error',
        type: 'file_too_large',
        message: FILE_TOO_LARGE_MESSAGE,
      },
    };
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        content,
      ),
    };
  } catch {
    return {
      result: {
        status: 'error',
        type: 'invalid_utf8',
        message: INVALID_UTF8_MESSAGE,
      },
    };
  }
}

/**
 * Render text a file read transferred as the local reader would: the same line
 * source, selector windows, markdown rendering, and result bound.
 */
async function renderTextRead(
  target: {
    readonly locator: string;
    readonly selector: string | undefined;
    readonly path: string;
  },
  text: string,
): Promise<ToolResult> {
  try {
    const read = applySelectorSuffix(target.locator, target.selector);
    // The text is in hand, so its own line count is the count an `N-` or a
    // `-K` member resolves against, exactly as a file's own lines are.
    const lines =
      read.pending === undefined ? undefined : splitSourceLines(text);
    const resolved =
      lines === undefined
        ? read
        : resolveEndRelativeSelector(read, lines.length);
    const mediaType = fileMediaType(target.path);
    if (resolved.outline)
      return await outlineReader(mediaType)(
        lines ?? splitSourceLines(text),
        resolved,
      );
    return resolved.ranges === undefined
      ? selectSourceLines(text, resolved, mediaType)
      : selectMultiRangeLines(text, resolved, mediaType);
  } catch (error) {
    return refusedRendering(error);
  }
}

/** Render one transferred file, refusing what the local reader cannot show. */
async function renderFileRead(
  target: {
    readonly locator: string;
    readonly selector: string | undefined;
    readonly path: string;
  },
  content: Buffer,
): Promise<ToolResult> {
  const decoded = remoteText(content);
  if ('result' in decoded) return decoded.result;
  return renderTextRead(target, decoded.text);
}

/** The listing options one selector and transfer ask a remote listing for. */
function listingOptions(
  locator: string,
  selector: string | undefined,
  more: boolean,
) {
  const read = applySelectorSuffix(locator, selector);
  return {
    read,
    options: {
      displayPath: locator,
      // A link carries the local mark and never its target: the target is a
      // host path the model did not address.
      linkTargets: false,
      ...(read.offset > 0 && { offset: read.offset }),
      ...(read.limit !== undefined && { limit: read.limit }),
      ...(read.pending !== undefined && { pending: read.pending }),
      // The bound line is part of the result, so the renderer's cap reserves
      // its room instead of truncating the last entry to make it fit.
      ...(more && { reserveCodeUnits: MORE_ENTRIES_LINE.length + 1 }),
    },
  };
}

/** One level of a remote directory, in the local listing form. */
function renderDirectoryRead(
  target: { readonly locator: string; readonly selector: string | undefined },
  content: Buffer,
): ToolResult {
  try {
    const { entries, more } = parseSshDirectoryEntries(content);
    const { read, options } = listingOptions(
      target.locator,
      target.selector,
      more,
    );
    // A selector the local directory reader refuses is refused first, exactly
    // as locally: it needs no page of the directory.
    const refused = directorySelectorFailure(read);
    if (refused !== undefined) return refused;
    // The host collects at most the local traversal budget plus one, so a
    // transfer that reaches it is a directory a local listing refuses. The
    // local renderer names the refusal, and the count it prints is the one the
    // transfer carried: a subset of a directory that size would misreport it.
    if (entries.length > DIRECTORY_TRAVERSAL_BUDGET)
      return renderCollectedDirectory(target.locator, entries);
    // The host sends glob order; the hub keeps the local order, so the bound
    // selects the first entries a local listing shows rather than the first
    // ones a glob group happened to reach.
    const shown = [...entries]
      .sort(compareEntries)
      .slice(0, SSH_LIST_MAX_ENTRIES);
    const result = renderCollectedDirectory(target.locator, shown, options);
    if (result.status === 'error')
      return {
        status: 'error',
        type: result.type,
        message: result.message,
      };
    return more
      ? {
          ...result,
          content: `${result.content}${MORE_ENTRIES_LINE}\n`,
          truncated: true,
        }
      : result;
  } catch (error) {
    return refusedRendering(error);
  }
}

function helpResult(path: string): ToolResult {
  return {
    status: 'success',
    kind: 'file',
    path,
    representation: 'text',
    content: SSH_LOCATOR_HELP,
    truncated: false,
    requestedRange: null,
    shownRange: null,
  };
}

/** One read's frames and what they amount to. */
type RemoteRead = {
  readonly frames: SshReadFrames;
  readonly verdict: SshReadVerdict;
  /** True when the transfer was cut at the caller's stdout bound. */
  readonly overflow: boolean;
};

/** Everything one remote read needs, all of it trusted context. */
type RemoteReadRequest = {
  readonly client: SshClient;
  readonly binding: SshBinding;
  readonly path: string;
  readonly nonce: string;
  readonly context: ToolContext;
};

async function runRemoteRead(request: RemoteReadRequest): Promise<RemoteRead> {
  const { client, binding, context } = request;
  // The read's kind is unknown until its marker, so the bound covers a
  // directory transfer; a file's own bound is what the script asks for.
  const outcome = await client.run({
    destination: binding.destination,
    resolved: binding,
    remoteCommand: ['sh', '-s'],
    input: buildSshReadScript({ nonce: request.nonce, path: request.path }),
    maxStdoutBytes: SSH_DIRECTORY_TRANSFER_BYTES + SSH_READ_NOISE_BYTES,
    deadlineMs: readBudgetMs(context),
    // Login-shell noise larger than the stderr head would otherwise hide the
    // start marker, the refusal, or the end trailer. The tail keeps them.
    stderrTailBytes: SSH_READ_NOISE_BYTES,
    ...(context.abortSignal !== undefined && { signal: context.abortSignal }),
  });
  const frames = parseSshReadFrames(
    outcome.outcome === 'ended' ? outcome.stdout : Buffer.alloc(0),
    outcome.diagnostic,
    request.nonce,
  );
  return {
    frames,
    verdict: classifySshReadOutcome(outcome, frames),
    overflow: outcome.outcome === 'ended' && outcome.stdoutOverflow,
  };
}

/** The result a completed read's frames become, file or listing. */
function frameResult(
  parsed: SshPathLocator,
  locator: string,
  frames: SshReadFrames,
): Promise<ToolResult> | ToolResult {
  if (frames.status !== 0)
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: UNFINISHED_READ_MESSAGE,
    };
  if (frames.kind === 'file')
    return renderFileRead(
      { locator, selector: parsed.selector, path: parsed.path },
      frames.content,
    );
  if (frames.kind === 'dir')
    return renderDirectoryRead(
      { locator, selector: parsed.selector },
      frames.content,
    );
  return sshUnavailableResult('session_lost');
}

/**
 * Read one `ssh://` locator. The locator is re-parsed here because execution
 * gets the submitted text, exactly as the Machine branch does; the binding
 * carries the address the admission resolved and judged.
 */
export async function executeSshRead(
  context: ToolContext,
  path: string,
): Promise<ToolResult> {
  const parsed = parseSshLocator(path);
  if (parsed.kind === 'invalid')
    return { status: 'error', type: 'invalid_path', message: parsed.message };
  if (parsed.kind === 'help') return helpResult(path);
  const { sshClient: client, sshBinding: binding } = context;
  if (client === undefined || binding === undefined)
    return {
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    };
  const { frames, verdict, overflow } = await runRemoteRead({
    client,
    binding,
    path: parsed.path,
    nonce: createSshNonce(),
    context,
  });
  // The transfer stopped at the stdout bound, so its bytes are a prefix of
  // what the host sent: a truncated success would misreport the file or the
  // listing, whichever the marker named.
  if (overflow)
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: UNFINISHED_READ_MESSAGE,
    };
  // A refusal the host named is its own result: the script ran, and it says
  // which precondition failed. A kind this revision does not know is a frame
  // mismatch, not a refusal to act on.
  if (frames.refusal !== undefined)
    return isSshReadRefusal(frames.refusal)
      ? REFUSAL_RESULTS[frames.refusal]
      : sshUnavailableResult('session_lost');
  if (verdict.kind !== 'complete') return failureResult(verdict);
  return frameResult(
    parsed,
    formatSshLocator(parsed.destination, parsed.path) ?? binding.locator,
    frames,
  );
}

/** The `read` and mutation dispatch for one admitted `ssh://` path. */
export function executeSshNative(
  context: ToolContext,
  operation: 'read' | 'edit' | 'write',
  path: string,
): Promise<ToolResult> {
  return operation === 'read'
    ? executeSshRead(context, path)
    : Promise.resolve(sshUnsupportedMutationResult());
}
