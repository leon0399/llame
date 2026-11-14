import { setTimeout as delay } from "node:timers/promises";
import { startManagedBash, type ExecuteManagedBashOptions } from "./execute";
import * as processTree from "./process-tree";
import type {
  BashExecutorContext,
  ManagedBashHandle,
  ManagedStopCause,
} from "./types";

const context: BashExecutorContext = {
  workingDirectory: process.cwd(),
  secretBoundary: true,
  processIsolation: true,
  outputBound: 256,
  inputBound: 512,
  durationMs: 40,
  maxProcesses: 1,
};

function start(script: string): ManagedBashHandle {
  const handle = startManagedBash(
    { command: "bash", args: ["-c", script] },
    context,
  );

  if ("type" in handle) throw new Error(`Expected a handle: ${handle.type}`);

  return handle;
}

describe("startManagedBash handle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets a child outlive the context duration", async () => {
    const handle = start("printf first; sleep 0.3; printf second");

    expect(handle.pid).toBeGreaterThan(0);
    await delay(context.durationMs * 3);
    expect(handle.snapshot().stdout).toBe("first");

    expect(await handle.settled).toMatchObject({
      status: "success",
      stdout: "firstsecond",
    });
  });

  it("keeps running after a call signal aborts and still snapshots later output", async () => {
    const call = new AbortController();

    const options: ExecuteManagedBashOptions = {
      toolCallId: "signal-independent",
      signal: call.signal,
      timeoutSignal: call.signal,
    };

    const handle = startManagedBash(
      {
        command: "bash",
        args: ["-c", "printf one; sleep 0.2; printf two; sleep 5"],
      },
      context,
      options,
    );

    if ("type" in handle) throw new Error(`Expected a handle: ${handle.type}`);

    call.abort();
    await delay(400);
    expect(handle.snapshot()).toEqual({
      stdout: "onetwo",
      stderr: "",
      truncated: false,
      truncatedStreams: { stdout: false, stderr: false },
    });
    expect(await handle.stop("owner")).toMatchObject({ proved: true });
  });

  it.each<ManagedStopCause>([
    "run",
    "lifetime",
    "owner",
    "assistant",
    "worker",
  ])(
    "stops with the %s cause and returns the captured streams",
    async (cause) => {
      const handle = start("printf out; printf err >&2; sleep 5");
      await delay(150);

      const stopped = await handle.stop(cause);

      expect(stopped).toEqual({
        proved: true,
        stdout: "out",
        stderr: "err",
        truncated: false,
        truncatedStreams: { stdout: false, stderr: false },
      });
      expect(await handle.settled).toMatchObject({ type: "cancelled" });
    },
  );

  it("waits for a settlement already under way", async () => {
    const handle = start("printf done");
    const settled = await handle.settled;
    const stopped = await handle.stop("owner");

    expect(settled).toMatchObject({ status: "success", stdout: "done" });
    expect(stopped).toMatchObject({ proved: true, stdout: "done" });
  });

  it("keeps a natural trailing credential prefix in the final snapshot and stop", async () => {
    const handle = startManagedBash(
      {
        command: "bash",
        args: ["-c", "printf 'out SECRET'; printf 'err SECRET' >&2"],
      },
      context,
      { protectedValues: ["SECRET-KEY"] },
    );

    if ("type" in handle) throw new Error("Expected a handle");
    await expect(handle.settled).resolves.toMatchObject({
      status: "success",
      stdout: "out SECRET",
      stderr: "err SECRET",
      truncated: false,
    });
    expect(handle.snapshot()).toMatchObject({
      stdout: "out SECRET",
      stderr: "err SECRET",
      truncated: false,
    });
    await expect(handle.stop("owner")).resolves.toMatchObject({
      proved: true,
      stdout: "out SECRET",
      stderr: "err SECRET",
      truncated: false,
    });
  });

  it("reports an unproved stop and settles as outcome unknown", async () => {
    vi.spyOn(processTree, "stopProcessGroup").mockResolvedValue(false);
    const handle = start("printf out; sleep 5");
    await delay(150);

    expect(await handle.stop("worker")).toMatchObject({
      proved: false,
      stdout: "out",
    });
    expect(await handle.settled).toMatchObject({ type: "outcome_unknown" });
    vi.restoreAllMocks();
    process.kill(-handle.pid, "SIGKILL");
  });

  it("publishes captured-byte activity after capture and lets callers unsubscribe", async () => {
    const handle = start(
      "printf one; sleep 0.2; printf two; sleep 0.2; printf three",
    );

    const snapshots: Array<string> = [];

    const unsubscribe = handle.onOutput((bytes) => {
      expect(bytes).toBeGreaterThan(0);
      snapshots.push(handle.snapshot().stdout);
    });

    await delay(300);
    unsubscribe();
    const observed = snapshots.length;
    await handle.settled;
    expect(snapshots).toContain("onetwo");
    expect(snapshots.length).toBe(observed);
    expect(handle.snapshot().stdout).toBe("onetwothree");
  });

  it("names a natural terminating signal", async () => {
    const handle = start("printf before; kill -TERM $$");
    expect(await handle.settled).toMatchObject({
      status: "error",
      signal: "SIGTERM",
      stdout: "before",
    });
  });

  it("refuses a command outside the managed tool set", () => {
    expect(
      startManagedBash({ command: "rm", args: ["-rf", "/"] }, context),
    ).toMatchObject({ status: "error", type: "unavailable" });
  });
});
