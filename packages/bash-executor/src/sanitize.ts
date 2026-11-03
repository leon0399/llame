import {
  cutToBound,
  streamOutputBound,
  type StreamBound,
} from "./output-bound";
import type {
  BashExecutorContext,
  BashKnownResult,
  BashUnavailableResult,
} from "./types";

type SanitizedStream = {
  readonly text: string;
  readonly truncated: boolean;
};

export function requireManagedBoundary(
  context: BashExecutorContext,
): BashUnavailableResult | null {
  if (
    !context.secretBoundary ||
    !context.processIsolation ||
    streamOutputBound(context).limit <= 0 ||
    context.inputBound <= 0 ||
    context.durationMs <= 0 ||
    context.maxProcesses <= 0
  ) {
    return {
      status: "error",
      type: "boundary_missing",
      message: "Managed bash is unavailable without the required boundary.",
    };
  }
  return null;
}

export function sanitizeKnownResult(
  result: BashKnownResult,
  context: BashExecutorContext,
  protectedValues: ReadonlyArray<string> = [],
): BashKnownResult {
  const bound = streamOutputBound(context);
  const stdout = sanitizeStream(result.stdout, bound, protectedValues);
  const stderr = sanitizeStream(result.stderr, bound, protectedValues);
  return {
    ...result,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
  };
}

function sanitizeStream(
  value: string,
  bound: StreamBound,
  protectedValues: ReadonlyArray<string>,
): SanitizedStream {
  let text = value;
  for (const secret of protectedValues) {
    if (secret.length > 0) text = text.split(secret).join("[REDACTED]");
  }
  const clipped = cutToBound(text, bound);
  return { text: clipped, truncated: clipped !== text };
}
