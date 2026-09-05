import { spawn } from "node:child_process";
import { CliError, aborted } from "./errors";

export interface ProcessResult {
  readonly code: number | null;
  readonly output: string;
  readonly stopped: "timeout" | "output_limit" | "cancelled" | null;
}

export async function nativeProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<ProcessResult> {
  aborted(signal);
  // Windows needs a Job Object to bound descendant lifetime. Do not silently
  // downgrade to killing only the parent there.
  if (process.platform === "win32")
    throw new CliError(
      "platform",
      "Native process tools currently require POSIX process groups. Use WSL on Windows.",
    );
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let stopped: ProcessResult["stopped"] = null;
    let killer: NodeJS.Timeout | undefined;
    let settler: NodeJS.Timeout | undefined;
    const kill = (kind: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, kind);
      } catch {
        /* The entire group already exited. */
      }
    };
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        code,
        output: Buffer.concat(chunks).toString("utf8"),
        stopped,
      });
    };
    const stop = (reason: ProcessResult["stopped"]) => {
      if (stopped) return;
      stopped = reason;
      kill("SIGTERM");
      // A surviving descendant can hold pipes open after the group exits; do not wait forever for 'close'.
      killer = setTimeout(() => {
        kill("SIGKILL");
        settler = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(null);
        }, 2000);
      }, 500);
    };
    const onAbort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), 30_000);
    const capture = (data: Buffer) => {
      const remaining = Math.max(0, 16_000 - bytes);
      if (remaining > 0) chunks.push(data.subarray(0, remaining));
      bytes += data.byteLength;
      if (bytes > 16_000) stop("output_limit");
    };
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killer);
      clearTimeout(settler);
      signal.removeEventListener("abort", onAbort);
      kill("SIGKILL");
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new CliError(
          "process_failed",
          "Could not start the approved executable.",
        ),
      );
    });
    child.once("close", (code) => finish(code));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
