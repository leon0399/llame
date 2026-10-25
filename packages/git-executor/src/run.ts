import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

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

/**
 * Output is capped while the child runs, not after: a runaway listing must not
 * grow this process's memory first.
 *
 * The decoder, not `chunk.toString("utf8")`, turns the bytes into text: a byte
 * sequence arrives split across `data` events, and decoding each chunk on its
 * own would replace both halves with U+FFFD, so a path or a remote that holds
 * a non-ASCII character and lands on a chunk boundary would be stored wrongly.
 */
function collect(limit: number): CollectedOutput {
  const chunks: Array<string> = [];
  const decoder = new StringDecoder("utf8");
  let length = 0;
  return {
    push: (chunk) => {
      if (length >= limit) return;
      const text = decoder.write(chunk).slice(0, limit - length);
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

/** The one settlement of one git call: deadline, caller abort, first result. */
type Completion = {
  readonly timedOut: () => boolean;
  readonly settle: (result: GitProcessResult) => void;
};

/**
 * Kill a git process and everything it started. `git worktree add` runs
 * `git reset --hard` (and a branch update) as children that inherit these
 * pipes, and `close` waits for the pipes: killing git alone would leave the
 * call pending past its deadline while that child keeps writing files.
 *
 * The child is spawned as a group leader, so the group id is its pid.
 */
function killProcessGroup(child: ChildProcess): void {
  const { pid } = child;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone (`ESRCH`), and `close` settles the call.
    child.kill("SIGKILL");
  }
}

function watchCompletion(
  child: ChildProcess,
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
  resolve: (result: GitProcessResult) => void,
): Completion {
  let timedOut = false;
  let settled = false;
  const stop = (): void => {
    timedOut = true;
    killProcessGroup(child);
  };
  const timer = setTimeout(stop, Math.max(1, options.timeoutMs));
  options.signal?.addEventListener("abort", stop, { once: true });
  return {
    timedOut: () => timedOut,
    settle: (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", stop);
      resolve(result);
    },
  };
}

/**
 * Run one git command. `signal` aborts the process the same way the deadline
 * does: a cancelled or expired caller must not leave git writing files. An
 * aborted call is reported as `timed_out`, the typed failure for a command that
 * was ended rather than allowed to finish.
 */
export function runGitProcess(
  args: ReadonlyArray<string>,
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<GitProcessResult> {
  const { promise, resolve } = Promise.withResolvers<GitProcessResult>();
  if (options.signal?.aborted) {
    resolve({ status: "timed_out", stdout: "", stderr: "" });
    return promise;
  }
  const stdout = collect(STDOUT_BOUND);
  const stderr = collect(STDERR_BOUND);
  const output = () => ({ stdout: stdout.text(), stderr: stderr.text() });
  const child = spawn("git", args, {
    env: gitEnvironment(),
    // Its own process group, so the deadline can end the git children too; see
    // {@link killProcessGroup}. The pipes keep the call tied to the child.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const completion = watchCompletion(child, options, resolve);
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("error", (error: Error) => {
    // A git that cannot start at all (`ENOENT`, a refused exec) is a failed
    // call like any other, reported through the same bounded text.
    stderr.push(Buffer.from(error.message));
    completion.settle({ status: "failed", exitCode: -1, ...output() });
  });
  child.on("close", (code: number | null) =>
    completion.settle(exitOutcome(completion.timedOut(), code, output())),
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
