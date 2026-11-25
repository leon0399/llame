import {
  PROTECTED_VALUE_REDACTION_MARKER,
  codePointSafeCutIndex,
  isNumber,
  isString,
  protectedValueIntervals,
  type ProtectedValueInterval,
  type UnknownRecord,
} from '@workspace/runtime-safety';

export type BashExecutorContext = {
  readonly workingDirectory: string;
  readonly secretBoundary: boolean;
  readonly processIsolation: boolean;
  readonly outputBound?: number;
  readonly outputBoundBytes?: number;
  readonly inputBound: number;
  readonly durationMs: number;
  readonly maxProcesses: number;
};

export type StreamFlags = {
  readonly stdout: boolean;
  readonly stderr: boolean;
};

export type BashKnownResult = {
  readonly status: 'success' | 'error';
  readonly exitCode: number;
  readonly stdout: string;
  readonly signal?: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly truncatedStreams?: StreamFlags;
  readonly wallTimeMs?: number;
};

export type BashTimedOutResult = {
  readonly status: 'error';
  readonly type: 'timed_out';
  readonly durationMs: number;
  readonly wallTimeMs?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly truncatedStreams?: StreamFlags;
};

export type BashUnknownResult = {
  readonly status: 'error';
  readonly type: 'outcome_unknown';
  readonly attemptId: string;
  readonly message: string;
};

export type BashUnavailableResult = {
  readonly status: 'error';
  readonly type: 'unavailable' | 'boundary_missing' | 'cancelled';
  readonly message: string;
};

export type BashResult =
  | BashKnownResult
  | BashTimedOutResult
  | BashUnknownResult
  | BashUnavailableResult;

export type BashBackgroundedResult = {
  readonly status: 'success';
  readonly backgrounded: true;
  readonly job: string;
  readonly cause: 'async' | 'time' | 'message';
  readonly wallTimeMs: number;
};

export type BashToolResult = BashResult | BashBackgroundedResult;

export type ManagedOutput = {
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly truncatedStreams: StreamFlags;
};

export type StreamBound = {
  readonly kind: 'code-units' | 'bytes';
  readonly limit: number;
};

export function streamOutputBound(context: BashExecutorContext): StreamBound {
  return context.outputBoundBytes === undefined
    ? { kind: 'code-units', limit: context.outputBound ?? 0 }
    : { kind: 'bytes', limit: context.outputBoundBytes };
}

function cutLength(text: string, bound: StreamBound): number {
  if (bound.kind === 'code-units')
    return codePointSafeCutIndex(text, Math.min(text.length, bound.limit));
  let bytes = 0;
  let index = 0;

  while (index < text.length) {
    const code = text.codePointAt(index) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7_ff ? 2 : code <= 0xff_ff ? 3 : 4;

    if (bytes > bound.limit) break;
    index += code > 0xff_ff ? 2 : 1;
  }

  return index;
}

export type BashCommandInput = {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
};

export function measureManagedInput(input: BashCommandInput): number {
  let size = Buffer.byteLength(input.command, 'utf8');

  for (const arg of input.args ?? [])
    size += Buffer.byteLength(arg, 'utf8') + 1;

  if (input.cwd !== undefined) size += Buffer.byteLength(input.cwd, 'utf8') + 1;

  for (const [key, value] of Object.entries(input.env ?? {})) {
    size +=
      Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8') + 2;
  }

  return size;
}

export function unusableWorkingDirectory(
  literal: string,
): BashUnavailableResult {
  return {
    status: 'error',
    type: 'unavailable',
    message: `Working directory argument ${JSON.stringify(literal)} is not usable. The command did not run; the argument was taken literally with no ~ or variable expansion. List its parent or create the directory.`,
  };
}

const BASE_ENVIRONMENT_NAMES = [
  'PATH',
  'LANG',
  'HOME',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'TERM',
] as const;

export function managedEnvironmentCollision(
  additions: Readonly<Record<string, string>> | undefined,
): string | undefined {
  return Object.keys(additions ?? {}).find((key) =>
    BASE_ENVIRONMENT_NAMES.some((name) => name === key),
  );
}

export type StreamCapture = {
  readonly endedByLlame: boolean;
  readonly gapAt?: number;
};

export type ResultCaptures = {
  readonly stdout?: StreamCapture;
  readonly stderr?: StreamCapture;
};

type Redaction = {
  readonly values: ReadonlyArray<string>;
  readonly longest: number;
};

type KeptCapture = {
  readonly text: string;
  readonly intervals: ReadonlyArray<ProtectedValueInterval>;
  readonly dropped: boolean;
};

const MARKER = PROTECTED_VALUE_REDACTION_MARKER;

export function sanitizeKnownResult<
  T extends BashKnownResult | BashTimedOutResult,
>(
  result: T,
  context: BashExecutorContext,
  protectedValues: ReadonlyArray<string> = [],
  captures: ResultCaptures = {},
): T {
  return sanitizeKnownResultAtBound(
    result,
    streamOutputBound(context),
    protectedValues,
    captures,
  );
}

export function sanitizeKnownResultAtBound<
  T extends BashKnownResult | BashTimedOutResult,
>(
  result: T,
  bound: StreamBound,
  protectedValues: ReadonlyArray<string> = [],
  captures: ResultCaptures = {},
): T {
  const redaction = createRedaction(protectedValues);

  const stdout = sanitizeStream(
    result.stdout,
    bound,
    redaction,
    captures.stdout,
  );

  const stderr = sanitizeStream(
    result.stderr,
    bound,
    redaction,
    captures.stderr,
  );

  const streams = result.truncatedStreams;

  return {
    ...result,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
    ...(streams !== undefined && {
      truncatedStreams: {
        stdout: streams.stdout || stdout.truncated,
        stderr: streams.stderr || stderr.truncated,
      },
    }),
  };
}

function createRedaction(values: ReadonlyArray<string>): Redaction {
  return {
    values,
    longest: values.reduce(
      (longest, value) => Math.max(longest, value.length),
      0,
    ),
  };
}

function sanitizeStream(
  value: string,
  bound: StreamBound,
  redaction: Redaction,
  capture: StreamCapture | undefined,
) {
  const kept = keptCapture(value, capture, redaction);
  const end = cutLength(kept.text, bound);
  const output: Array<string> = [];
  let cursor = 0;

  for (const interval of kept.intervals) {
    if (interval.start >= end) break;
    const clippedEnd = Math.min(interval.end, end);
    output.push(kept.text.slice(cursor, interval.start));

    if (clippedEnd - interval.start >= MARKER.length) output.push(MARKER);
    cursor = clippedEnd;
  }

  output.push(kept.text.slice(cursor, end));

  return {
    text: output.join(''),
    truncated: kept.dropped || end < kept.text.length,
  };
}

function keptCapture(
  value: string,
  capture: StreamCapture | undefined,
  redaction: Redaction,
): KeptCapture {
  if (capture?.gapAt !== undefined)
    return gapCapture(value, capture.gapAt, redaction);

  const drop =
    capture?.endedByLlame === true
      ? trailingMemberPrefixLength(value, redaction)
      : 0;

  const end = value.length - drop;
  const intervals: Array<ProtectedValueInterval> = [];

  for (const interval of protectedValueIntervals(value, redaction.values)) {
    if (interval.start >= end) break;
    intervals.push({ start: interval.start, end: Math.min(interval.end, end) });
  }

  return { text: value.slice(0, end), intervals, dropped: drop > 0 };
}

function gapCapture(
  value: string,
  gap: number,
  redaction: Redaction,
): KeptCapture {
  const boundedGap = Math.max(0, Math.min(gap, value.length));
  const head = value.slice(0, boundedGap);
  const tail = value.slice(boundedGap);
  const headDrop = trailingMemberPrefixLength(head, redaction);
  const tailDrop = leadingMemberSuffixLength(tail, redaction);
  const headText = head.slice(0, head.length - headDrop);
  const tailText = tail.slice(tailDrop);
  const intervals: Array<ProtectedValueInterval> = [];

  for (const interval of protectedValueIntervals(head, redaction.values)) {
    if (interval.start >= headText.length) break;
    intervals.push({
      start: interval.start,
      end: Math.min(interval.end, headText.length),
    });
  }

  for (const interval of protectedValueIntervals(tail, redaction.values)) {
    if (interval.end > tailDrop)
      intervals.push({
        start: headText.length + Math.max(0, interval.start - tailDrop),
        end: headText.length + interval.end - tailDrop,
      });
  }

  return { text: headText + tailText, intervals, dropped: true };
}

function trailingMemberPrefixLength(
  value: string,
  redaction: Redaction,
): number {
  for (
    let length = Math.min(redaction.longest - 1, value.length);
    length > 0;
    length -= 1
  ) {
    const suffix = value.slice(value.length - length);

    if (
      redaction.values.some(
        (member) => member.length > suffix.length && member.startsWith(suffix),
      )
    )
      return length;
  }

  return 0;
}

function leadingMemberSuffixLength(
  value: string,
  redaction: Redaction,
): number {
  for (
    let length = Math.min(redaction.longest - 1, value.length);
    length > 0;
    length -= 1
  ) {
    const prefix = value.slice(0, length);

    if (
      redaction.values.some(
        (member) => member.length > prefix.length && member.endsWith(prefix),
      )
    )
      return length;
  }

  return 0;
}

const OUTPUT_CUT_MARKER = '[output cut at the bound]';
const STDERR_LABEL = '[stderr]';
const NO_OUTPUT = '(no output)';

export function renderBashText(result: UnknownRecord): string {
  if (result.backgrounded === true && isString(result.job)) {
    const prefix =
      result.cause === 'message'
        ? 'Moved to the background to handle an incoming message. '
        : '';

    return `${prefix}The command continues in the background as ${result.job}. You get a notice when it settles. Do not poll it.`;
  }

  const seconds = isNumber(result.wallTimeMs)
    ? `, ${(result.wallTimeMs / 1000).toFixed(1)} s`
    : '';

  const exitCode = isNumber(result.exitCode) ? result.exitCode : 0;

  const header =
    result.type === 'timed_out'
      ? `timed out${seconds}`
      : `exit ${exitCode}${seconds}`;

  const produced = isString(result.stdout) ? result.stdout : '';
  const failed = isString(result.stderr) ? result.stderr : '';
  const stdout = produced.replace(/\n$/u, '');
  const stderr = failed.replace(/\n$/u, '');
  const lines = [header];

  if (produced !== '') lines.push(stdout);

  if (failed !== '') lines.push(STDERR_LABEL, stderr);

  if (produced === '' && failed === '') lines.push(NO_OUTPUT);
  const { truncationNotice } = result;

  if (
    result.cut === true ||
    (result.truncated === true &&
      !(isString(truncationNotice) && truncationNotice !== ''))
  )
    lines.push(OUTPUT_CUT_MARKER);

  if (isString(truncationNotice) && truncationNotice !== '')
    lines.push(`[${truncationNotice}]`);

  return lines.join('\n');
}
