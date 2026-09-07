import { createHash } from "node:crypto";
import {
  cutStringAtCodePointBoundary,
  isRecord,
  isString,
} from "@workspace/runtime-safety";
import type {
  BashCommandInput,
  BashExecutorContext,
  BashKnownResult,
  BashSafeCommandMetadata,
  BashUnavailableResult,
} from "./types";

const STACK_LINE =
  /^\s*(?:at\s+\S+|Exception|Error:|Traceback \(most recent call last\):)/;

const WIDENING_KEYS = new Set([
  "cwd",
  "workingDirectory",
  "executor",
  "env",
  "path",
  "policy",
  "network",
  "permission",
]);

type SanitizedStream = {
  readonly text: string;
  readonly truncated: boolean;
};

function unavailable(message: string): BashUnavailableResult {
  return { status: "error", type: "unavailable", message };
}

/** Parse model command JSON at the I/O boundary; reject cwd/executor widening. */
export function parseCommandInput(
  input: unknown,
): BashCommandInput | BashUnavailableResult {
  if (!isRecord(input)) {
    return unavailable("Command arguments cannot select execution context.");
  }
  for (const key of Object.keys(input)) {
    if (WIDENING_KEYS.has(key)) {
      return unavailable("Command arguments cannot select execution context.");
    }
  }
  if (!isString(input.command)) {
    return unavailable("Command arguments cannot select execution context.");
  }
  const args = input.args;
  if (args === undefined) return { command: input.command };
  if (!Array.isArray(args) || !args.every((arg) => isString(arg))) {
    return unavailable("Command arguments cannot select execution context.");
  }
  return { command: input.command, args };
}

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

export function safeCommandMetadata(
  attemptId: string,
  input: BashCommandInput,
): BashSafeCommandMetadata {
  const args = input.args ?? [];
  return {
    attemptId,
    commandDigest: digestCommand(input.command, args),
    argCount: args.length,
  };
}

function digestCommand(command: string, args: ReadonlyArray<string>): string {
  return createHash("sha256")
    .update(command)
    .update("\0")
    .update(args.join("\0"))
    .digest("hex")
    .slice(0, 16);
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
