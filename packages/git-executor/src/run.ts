import { spawn } from "node:child_process";

import { gitEnvironment } from "./env";

/*
 * One `git` process, started from an argv array with a fixed environment and a
 * deadline, plus the redaction every returned standard error goes through.
 *
 * Nothing here goes through a shell, so a path or a remote holding `;`, `$()`,
 * or whitespace stays one argument. A git call inherits nothing from the
 * daemon's or the hub's process; {@link gitEnvironment} owns that boundary.
 */

/** The bound on a returned standard error, and the wider one on stdout. */
const STDERR_BOUND = 4096;
const STDOUT_BOUND = 1_048_576;

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
  options: { readonly timeoutMs: number },
): Promise<GitProcessResult> {
  const { promise, resolve } = Promise.withResolvers<GitProcessResult>();
  const stdout = collect(STDOUT_BOUND);
  const stderr = collect(STDERR_BOUND);
  const output = () => ({ stdout: stdout.text(), stderr: stderr.text() });
  let timedOut = false;
  let settled = false;

  const child = spawn("git", args, {
    env: gitEnvironment(),
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

/**
 * Remove the userinfo part of every `scheme://user:password@host` URL, which is
 * where a clone URL carries a token. The `scp`-style `git@host:path` form has
 * no password position and is left as written.
 */
export function redactCredentials(text: string): string {
  return text.replaceAll(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/giu, "$1");
}
