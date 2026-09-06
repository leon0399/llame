import { spawn } from "node:child_process";
import { CliError, aborted } from "./errors";

export interface ProcessResult {
  readonly code: number | null;
  readonly output: string;
  readonly stopped: "timeout" | "output_limit" | "cancelled" | null;
}

export async function nativeProcess(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  ...rest: [env: NodeJS.ProcessEnv, signal: AbortSignal]
): Promise<ProcessResult> {
  const [env, signal] = rest;
  aborted(signal);
  // Windows needs a Job Object to bound descendant lifetime. Do not silently
  // downgrade to killing only the parent there.
  if (process.platform === "win32")
    throw new CliError(
      "platform",
      "Native process tools currently require POSIX process groups. Use WSL on Windows.",
    );
  return collectOutput(
    spawn(command, [...args], {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
    signal,
  );
}

function killGroup(
  child: ReturnType<typeof spawn>,
  kind: NodeJS.Signals,
): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, kind);
  } catch {
    /* The entire group already exited. */
  }
}

function collectOutput(
  child: ReturnType<typeof spawn>,
  signal: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const session = new NativeSession(child, signal, resolve, reject);
    session.bind();
  });
}

class NativeSession {
  private readonly chunks: Array<Buffer> = [];
  private bytes = 0;
  private settled = false;
  private stopped: ProcessResult["stopped"] = null;
  private killer: NodeJS.Timeout | undefined;
  private settler: NodeJS.Timeout | undefined;
  private readonly timer: NodeJS.Timeout;
  constructor(
    private readonly child: ReturnType<typeof spawn>,
    private readonly signal: AbortSignal,
    private readonly resolve: (result: ProcessResult) => void,
    private readonly reject: (error: CliError) => void,
  ) {
    this.timer = setTimeout(() => this.stop("timeout"), 30_000);
  }

  bind(): void {
    const onAbort = () => this.stop("cancelled");
    this.child.stdout?.on("data", (data: Buffer) => this.capture(data));
    this.child.stderr?.on("data", (data: Buffer) => this.capture(data));
    this.child.once("error", () => this.fail());
    this.child.once("close", (code) => this.finish(code));
    this.signal.addEventListener("abort", onAbort, { once: true });
    this.cleanupExtra = () => this.signal.removeEventListener("abort", onAbort);
    if (this.signal.aborted) onAbort();
  }

  private cleanupExtra = (): void => {};

  private cleanup(): void {
    clearTimeout(this.timer);
    clearTimeout(this.killer);
    clearTimeout(this.settler);
    this.cleanupExtra();
    killGroup(this.child, "SIGKILL");
  }

  private finish(code: number | null): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.resolve({
      code,
      output: Buffer.concat(this.chunks).toString("utf8"),
      stopped: this.stopped,
    });
  }

  private fail(): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.reject(
      new CliError(
        "process_failed",
        "Could not start the approved executable.",
      ),
    );
  }

  private stop(reason: ProcessResult["stopped"]): void {
    if (this.stopped) return;
    this.stopped = reason;
    killGroup(this.child, "SIGTERM");
    this.killer = setTimeout(() => {
      killGroup(this.child, "SIGKILL");
      this.settler = setTimeout(() => {
        this.child.stdout?.destroy();
        this.child.stderr?.destroy();
        this.finish(null);
      }, 2000);
    }, 500);
  }

  private capture(data: Buffer): void {
    const remaining = Math.max(0, 16_000 - this.bytes);
    if (remaining > 0) this.chunks.push(data.subarray(0, remaining));
    this.bytes += data.byteLength;
    if (this.bytes > 16_000) this.stop("output_limit");
  }
}
