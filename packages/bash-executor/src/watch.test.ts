import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { executeManagedBash } from "./execute";
import { BashProcessLimiter } from "./limiter";
import { watchManagedChild } from "./watch";
import type { BashExecutorContext, BashResult } from "./types";
import * as processTree from "./process-tree";

let limiter = new BashProcessLimiter(1);

const execute: typeof executeManagedBash = (input, context, options) =>
  executeManagedBash(input, context, { limiter, ...options });

const context: BashExecutorContext = {
  workingDirectory: process.cwd(),
  secretBoundary: true,
  processIsolation: true,
  outputBound: 32,
  inputBound: 256,
  durationMs: 20,
  maxProcesses: 1,
};

describe("process-group settlement", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    limiter = new BashProcessLimiter(1);
  });

  it("drains output queued while the process group is stopped", async () => {
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_347 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "stopProcessGroup").mockImplementation(() => {
      setImmediate(() => {
        child.stdout?.emit("data", Buffer.from("late"));
        child.stdout?.emit("end");
        child.stderr?.emit("end");
      });

      return Promise.resolve(true);
    });

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: { ...context, durationMs: 0 },
          attemptId: "late-output",
          deadline: true,
          options: {},
        },
        resolve,
      );
    });

    expect(await pending).toMatchObject({
      type: "timed_out",
      stdout: "late",
      stderr: "",
      truncated: false,
    });
  });

  it("records the wall time from spawn to settlement", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_349 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "waitForProcessGroupQuiescence").mockResolvedValue(
      true,
    );

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        { context, attemptId: "wall-time", deadline: true, options: {} },
        resolve,
      );
    });

    clock.mockReturnValue(2240);
    child.emit("close", 0, null);

    expect(await pending).toMatchObject({
      status: "success",
      exitCode: 0,
      wallTimeMs: 1240,
    });
  });

  it("records the elapsed time it measured when the deadline stops a command", async () => {
    vi.useFakeTimers();
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_346 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "stopProcessGroup").mockResolvedValue(true);

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: { ...context, durationMs: 30_000 },
          attemptId: "timeout-wall-time",
          deadline: true,
          options: {},
        },
        resolve,
      );
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    // `durationMs` is the deadline the watcher armed; `wallTimeMs` is what it
    // measured from spawn to the stop, which is what the message names.
    expect(result).toMatchObject({ type: "timed_out", durationMs: 30_000 });

    if (!("wallTimeMs" in result))
      throw new Error("Expected a measured wall time");
    expect(result.wallTimeMs).toBeGreaterThanOrEqual(30_000);
  });

  it("bounds an open output pipe and marks its result truncated", async () => {
    vi.useFakeTimers();
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_348 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "stopProcessGroup").mockReturnValue(
      Promise.resolve(true),
    );

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: { ...context, durationMs: 0 },
          attemptId: "open-output",
          deadline: true,
          options: {},
        },
        resolve,
      );
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({
      type: "timed_out",
      truncated: true,
    });
  });

  it("keeps a lookahead so a member crossing the byte bound is redacted whole", async () => {
    const member = "SECRET-KEY-0123456789";
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_360 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "waitForProcessGroupQuiescence").mockResolvedValue(
      true,
    );

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: { ...context, outputBound: undefined, outputBoundBytes: 30 },
          attemptId: "lookahead",
          deadline: true,
          options: { protectedValues: [member] },
        },
        resolve,
      );
    });

    child.stdout.emit("data", Buffer.from(`012345678901234${member}`));
    child.emit("close", 0, null);

    const result = await pending;
    expect(result).toMatchObject({ status: "success", truncated: true });

    if (!("stdout" in result)) throw new Error("Expected known output");
    expect(result.stdout).toBe("012345678901234[REDACTED]");
    expect(result.stdout).not.toContain(member);
  });

  it("redacts a non-ASCII member split across chunks and the byte bound", async () => {
    const member = "SECRET-ключ";
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_361 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "waitForProcessGroupQuiescence").mockResolvedValue(
      true,
    );
    const bytes = Buffer.from(`0123456789${member}`, "utf8");

    // The split lands inside the two-byte sequence of `л`, and the byte bound
    // does too; the streaming decoder must still see the member whole.
    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: { ...context, outputBound: undefined, outputBoundBytes: 20 },
          attemptId: "split-code-point",
          deadline: true,
          options: { protectedValues: [member] },
        },
        resolve,
      );
    });

    child.stdout.emit("data", bytes.subarray(0, 20));
    child.stdout.emit("data", bytes.subarray(20));
    child.emit("close", 0, null);

    const result = await pending;
    expect(result).toMatchObject({ status: "success", truncated: true });

    if (!("stdout" in result)) throw new Error("Expected known output");
    expect(result.stdout).toBe("0123456789");
    expect(result.stdout).not.toContain(member);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(20);
  });

  it("drops a capture the lookahead cut mid-member", async () => {
    const member = "SECRET-KEY";
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_362 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "waitForProcessGroupQuiescence").mockResolvedValue(
      true,
    );

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: { ...context, outputBound: 16 },
          attemptId: "capture-cut",
          deadline: true,
          options: { protectedValues: [member] },
        },
        resolve,
      );
    });

    child.stdout.emit("data", Buffer.from(`0123456789${member}${member}X`));
    child.emit("close", 0, null);

    const result = await pending;
    expect(result).toMatchObject({ status: "success", truncated: true });

    if (!("stdout" in result)) throw new Error("Expected known output");
    expect(result.stdout).toBe("0123456789");
    expect(result.stdout).not.toContain(member);
  });

  it("redacts a complete member whose capture cut starts inside it", async () => {
    const member = "SECRET-KEY";
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_365 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "waitForProcessGroupQuiescence").mockResolvedValue(
      true,
    );

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: {
            ...context,
            outputBound: undefined,
            outputBoundBytes: 16,
          },
          attemptId: "cut-inside-member",
          deadline: true,
          options: { protectedValues: [member] },
        },
        resolve,
      );
    });

    // The capture limit lands after 24 bytes because the emoji cannot fit, so
    // a drop-before-find would leave the member's first character visible.
    child.stdout.emit("data", Buffer.from(`${"x".repeat(15)}SECRET-KE😀`));
    child.emit("close", 0, null);

    const result = await pending;
    expect(result).toMatchObject({ status: "success", truncated: true });

    if (!("stdout" in result)) throw new Error("Expected known output");
    expect(result.stdout).toBe("x".repeat(15));
    expect(result.stdout).not.toContain("S");
  });

  it("discards an incomplete UTF-8 sequence the drain stopped on", async () => {
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_366 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "stopProcessGroup").mockImplementation(() => {
      setImmediate(() => {
        // `л` is D0 BB; the drain ends after its first byte, so the decoder
        // holds an incomplete sequence rather than a character.
        child.stdout?.emit(
          "data",
          Buffer.concat([Buffer.from("prefix SECRET-к"), Buffer.from([0xd0])]),
        );
        child.stdout?.emit("end");
        child.stderr?.emit("end");
      });

      return Promise.resolve(true);
    });

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: { ...context, durationMs: 0 },
          attemptId: "incomplete-sequence",
          deadline: true,
          options: { protectedValues: ["SECRET-ключ"] },
        },
        resolve,
      );
    });

    const result = await pending;
    expect(result).toMatchObject({ type: "timed_out", truncated: true });

    if (!("stdout" in result)) throw new Error("Expected known output");
    expect(result.stdout).toBe("prefix ");
    expect(result.stdout).not.toContain("\uFFFD");
  });

  it("keeps a natural exit's trailing member prefix", async () => {
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_363 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "waitForProcessGroupQuiescence").mockResolvedValue(
      true,
    );

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: { ...context, outputBound: 32 },
          attemptId: "natural-prefix",
          deadline: true,
          options: { protectedValues: ["SECRET-KEY"] },
        },
        resolve,
      );
    });

    child.stdout.emit("data", Buffer.from("prefix SECRET"));
    child.emit("close", 0, null);

    const result = await pending;
    expect(result).toMatchObject({
      status: "success",
      stdout: "prefix SECRET",
      truncated: false,
    });
  });

  it("drops a member prefix when a timeout kill ends the stream within the drain", async () => {
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_364 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(processTree, "stopProcessGroup").mockImplementation(() => {
      setImmediate(() => {
        child.stdout?.emit("data", Buffer.from("prefix SECRET"));
        child.stdout?.emit("end");
        child.stderr?.emit("end");
      });

      return Promise.resolve(true);
    });

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        {
          context: { ...context, durationMs: 0 },
          attemptId: "timeout-mid-member",
          deadline: true,
          options: { protectedValues: ["SECRET-KEY"] },
        },
        resolve,
      );
    });

    expect(await pending).toMatchObject({
      type: "timed_out",
      stdout: "prefix ",
      truncated: true,
    });
  });

  it("keeps a deadline unknown while a group survives the kill budget", async () => {
    // A kernel-blocked process can remain observable after SIGKILL. Model that
    // OS response without leaving an unkillable process on the test host.
    const kill = process.kill.bind(process);
    let alive = true;

    const signals = vi
      .spyOn(process, "kill")
      .mockImplementation((pid, signal) => {
        if (pid !== -12_345) return kill(pid, signal);

        if (!alive) {
          const missing = new Error("Process group no longer exists");
          Object.assign(missing, { code: "ESRCH" });
          throw missing;
        }

        return true;
      });

    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_345 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        { context, attemptId: "survivor", deadline: true, options: {} },
        resolve,
      );
    });

    expect(await pending).toMatchObject({
      type: "outcome_unknown",
      attemptId: "survivor",
    });
    expect(signals).toHaveBeenCalledWith(-12_345, "SIGKILL");
    const command = { command: "bash", args: ["-c", "printf next"] };
    // Unknown does not quarantine: the next call is admitted even while the
    // modelled survivor is still probeable.
    expect(
      await execute(command, { ...context, durationMs: 1000 }),
    ).toMatchObject({ status: "success", stdout: "next" });
    alive = false;
    child.emit("close", null, "SIGKILL");
  });

  it("settles a child without a pid as unavailable", async () => {
    const child = new ChildProcess();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        { context, attemptId: "missing-pid", deadline: true, options: {} },
        resolve,
      );
    });

    expect(await pending).toMatchObject({ type: "unavailable" });
    child.emit("error", new Error("spawn failed"));
  });

  it("keeps a pid-bearing child error unknown after the group stops", async () => {
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: 12_346 });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const kill = process.kill.bind(process);

    const signals = vi
      .spyOn(process, "kill")
      .mockImplementation((pid, signal) => {
        if (pid === -12_346) {
          const missing = new Error("Process group no longer exists");
          Object.assign(missing, { code: "ESRCH" });
          throw missing;
        }

        return kill(pid, signal);
      });

    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        { context, attemptId: "started-error", deadline: true, options: {} },
        resolve,
      );
    });

    child.emit("error", new Error("spawn failed after pid assignment"));
    expect(await pending).toMatchObject({
      type: "outcome_unknown",
      attemptId: "started-error",
    });
    expect(signals).toHaveBeenCalledWith(-12_346, "SIGKILL");

    const next = await execute(
      { command: "bash", args: ["-c", "printf next"] },
      { ...context, durationMs: 1000 },
    );

    expect(next).toMatchObject({ status: "success", stdout: "next" });
  });
});
