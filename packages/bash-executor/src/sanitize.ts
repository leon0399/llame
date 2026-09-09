import { cutStringAtCodePointBoundary } from "@workspace/runtime-safety";
import type {
  BashExecutorContext,
  BashKnownResult,
  BashUnavailableResult,
} from "./types";

const STACK_LINE =
  /^\s*(?:at\s+\S+|Exception|Error:|Traceback \(most recent call last\):)/;

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
    context.outputBound <= 0 ||
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
  const bound = context.outputBound;
  const stdout = sanitizeStream(result.stdout, bound, context, protectedValues);
  const stderr = sanitizeStream(result.stderr, bound, context, protectedValues);
  return {
    ...result,
    executor: "managed",
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
  };
}

function sanitizeStream(
  value: string,
  bound: number,
  context: BashExecutorContext,
  protectedValues: ReadonlyArray<string>,
): SanitizedStream {
  let text = value;
  for (const secret of protectedValues) {
    if (secret.length > 0) text = text.split(secret).join("[REDACTED]");
  }
  text = stripHostPaths(text, context.workingDirectory);
  text = stripStackTraces(text);
  const clipped = cutStringAtCodePointBoundary(text, bound);
  return { text: clipped, truncated: clipped.length < text.length };
}

function stripHostPaths(text: string, workingDirectory: string): string {
  const escaped = workingDirectory.replaceAll(
    /[.*+?^${}()|[\]\\]/g,
    String.raw`\$&`,
  );
  return text
    .replaceAll(new RegExp(escaped, "g"), ".")
    .replaceAll(/(?:^|[\s"'`])(\/(?:[^/\s"'`]+\/)+[^/\s"'`]*)/g, " [path]");
}

function stripStackTraces(text: string): string {
  return text
    .split("\n")
    .filter((line) => !STACK_LINE.test(line))
    .join("\n");
}
