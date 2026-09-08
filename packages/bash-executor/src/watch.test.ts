import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { executeManagedBash, resetManagedExecutorForTests } from "./execute";
import { watchManagedChild } from "./watch";
import type { BashExecutorContext, BashResult } from "./types";

const context: BashExecutorContext = {
  workingDirectory: process.cwd(),
  fileToolsWorkingDirectory: process.cwd(),
  secretBoundary: true,
  processIsolation: true,
  outputBound: 32,
  inputBound: 256,
  durationMs: 20,
  maxProcesses: 1,
};

describe("process-group settlement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetManagedExecutorForTests();
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
        { context, attemptId: "survivor", options: {} },
        resolve,
      );
    });
    expect(await pending).toMatchObject({
      type: "outcome_unknown",
      attemptId: "survivor",
    });
    expect(signals).toHaveBeenCalledWith(-12_345, "SIGKILL");
    const command = { command: "bash", args: ["-c", "printf next"] };
    expect(await executeManagedBash(command, context)).toMatchObject({
      type: "unavailable",
    });
    alive = false;
    expect(
      await executeManagedBash(command, { ...context, durationMs: 1000 }),
    ).toMatchObject({ status: "success", stdout: "next" });
    child.emit("close", null, "SIGKILL");
  });

  it("settles a child without a pid as unavailable", async () => {
    const child = new ChildProcess();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const pending = new Promise<BashResult>((resolve) => {
      watchManagedChild(
        child,
        { context, attemptId: "missing-pid", options: {} },
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
        { context, attemptId: "started-error", options: {} },
        resolve,
      );
    });
    child.emit("error", new Error("spawn failed after pid assignment"));
    expect(await pending).toMatchObject({
      type: "outcome_unknown",
      attemptId: "started-error",
    });
    expect(signals).toHaveBeenCalledWith(-12_346, "SIGKILL");
    const next = await executeManagedBash(
      { command: "bash", args: ["-c", "printf next"] },
      { ...context, durationMs: 1000 },
    );
    expect(next).toMatchObject({ status: "success", stdout: "next" });
  });
});
