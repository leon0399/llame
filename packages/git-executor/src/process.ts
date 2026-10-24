import { spawn } from "node:child_process";

import { gitEnvironment } from "./env";
import { STDERR_BOUND, STDOUT_BOUND } from "./output";

/**
 * One `git` process, started from an argv array with the fixed environment and
 * a deadline. Nothing here goes through a shell, so a path or a remote holding
 * `;`, `$()`, or whitespace stays one argument.
 */

export type GitProcessResult =
  | {
      readonly status: "ok";
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly status: "failed";
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly status: "timed_out";
      readonly stdout: string;
      readonly stderr: string;
    };

type CollectedOutput = {
  readonly push: (chunk: Buffer) => void;
  readonly text: () => string;
};

/** Output is capped while the child runs, not after: a runaway listing must not
 *  grow this process's memory first. */
function collect(limit: number): CollectedOutput {
  const chunks: Array<string> = [];
  let length = 0;
  return {
    push: (chunk) => {
      if (length >= limit) return;
      const text = chunk.toString("utf8").slice(0, limit - length);
      length += text.length;
      chunks.push(text);
    },
    text: () => chunks.join(""),
  };
}

function exitOutcome(
  timedOut: boolean,
  code: number | null,
  output: { readonly stdout: string; readonly stderr: string },
): GitProcessResult {
  if (timedOut) return { status: "timed_out", ...output };
  return code === 0
    ? { status: "ok", ...output }
    : { status: "failed", exitCode: code ?? -1, ...output };
}

export function runGitProcess(
  args: ReadonlyArray<string>,
  options: { readonly timeoutMs: number; readonly env?: NodeJS.ProcessEnv },
): Promise<GitProcessResult> {
  const { promise, resolve } = Promise.withResolvers<GitProcessResult>();
  const stdout = collect(STDOUT_BOUND);
  const stderr = collect(STDERR_BOUND);
  const output = () => ({ stdout: stdout.text(), stderr: stderr.text() });
  let timedOut = false;
  let settled = false;

  const child = spawn("git", args, {
    env: gitEnvironment(options.env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timer = setTimeout(
    () => {
      timedOut = true;
      child.kill("SIGKILL");
    },
    Math.max(1, options.timeoutMs),
  );

  const settle = (result: GitProcessResult): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(result);
  };

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("error", (error: Error) => {
    // A git that cannot start at all (`ENOENT`, a refused exec) is a failed
    // call like any other, reported through the same bounded text.
    stderr.push(Buffer.from(error.message));
    settle({ status: "failed", exitCode: -1, ...output() });
  });
  child.on("close", (code: number | null) =>
    settle(exitOutcome(timedOut, code, output())),
  );
  return promise;
}
