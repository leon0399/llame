import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeManagedBash, resetManagedExecutorForTests } from "./index";
import { completeAttemptUnknown } from "./attempt-ledger";
import type { BashExecutorContext } from "./types";
import * as processTree from "./process-tree";

function context(
  directory: string,
  overrides: Partial<BashExecutorContext> = {},
): BashExecutorContext {
  return {
    workingDirectory: directory,
    fileToolsWorkingDirectory: directory,
    secretBoundary: true,
    processIsolation: true,
    outputBound: 256,
    inputBound: 512,
    durationMs: 1500,
    maxProcesses: 1,
    ...overrides,
  };
}

describe("recovery and attempt ledger", () => {
  let directory: string;

  beforeEach(async () => {
    resetManagedExecutorForTests();
    directory = await mkdtemp(join(tmpdir(), "bash-recovery-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetManagedExecutorForTests();
    await rm(directory, { recursive: true, force: true });
  });

  it("records the attempt before start and marks known after quiescence", async () => {
    const result = await executeManagedBash(
      { command: "bash", args: ["-c", "printf ok"] },
      context(directory),
    );
    expect(result).toMatchObject({
      status: "success",
      executor: "managed",
      stdout: "ok",
    });
  });

  it("admits a new Run after an unknown outcome with no surviving process", async () => {
    const input = { command: "bash", args: ["-c", "printf next"] };
    // A survivor was observed at exit but disappeared before final settlement.
    vi.spyOn(
      processTree,
      "waitForProcessGroupQuiescence",
    ).mockResolvedValueOnce(false);
    expect(
      await executeManagedBash(input, context(directory), {
        toolCallId: "previous-run-call",
      }),
    ).toMatchObject({
      type: "outcome_unknown",
    });
    const result = await executeManagedBash(input, context(directory), {
      toolCallId: "new-run-call",
    });
    expect(result).toMatchObject({ status: "success", stdout: "next" });
  });

  it("refuses admission only while the quarantined process survives", async () => {
    const alive = vi
      .spyOn(processTree, "processGroupAlive")
      .mockReturnValue(true);
    const signal = vi
      .spyOn(processTree, "signalProcessGroup")
      .mockImplementation(() => {});
    completeAttemptUnknown("surviving-attempt", 12_345);
    const input = { command: "bash", args: ["-c", "printf recovered"] };
    const refused = await executeManagedBash(input, context(directory));
    expect(refused).toMatchObject({
      type: "unavailable",
      message: "Process group from attempt surviving-attempt is still alive.",
    });
    expect(signal).toHaveBeenCalledWith(12_345, "SIGKILL");
    alive.mockReturnValue(false);
    expect(await executeManagedBash(input, context(directory))).toMatchObject({
      status: "success",
      stdout: "recovered",
    });
  });

  it("drops dead quarantined groups without waiting for another admission", async () => {
    vi.useFakeTimers();
    const alive = vi
      .spyOn(processTree, "processGroupAlive")
      .mockReturnValue(true);
    completeAttemptUnknown("swept-attempt", 12_346);
    alive.mockReturnValue(false);
    vi.advanceTimersByTime(100);
    vi.useRealTimers();

    alive.mockReturnValue(true);
    const result = await executeManagedBash(
      { command: "bash", args: ["-c", "printf swept"] },
      context(directory),
    );
    expect(result).toMatchObject({ status: "success", stdout: "swept" });
  });

  it("treats a non-ESRCH group probe failure as alive", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      const denied = new Error("permission denied");
      Object.assign(denied, { code: "EPERM" });
      throw denied;
    });
    expect(processTree.processGroupAlive(12_345)).toBe(true);
    expect(kill).toHaveBeenCalledWith(-12_345, 0);
  });

  it("cancels when the process group is proven stopped", async () => {
    const controller = new AbortController();
    const pending = executeManagedBash(
      { command: "bash", args: ["-c", "while true; do sleep 0.05; done"] },
      context(directory, { durationMs: 5000 }),
      { signal: controller.signal, toolCallId: "tc-cancel" },
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    controller.abort();
    expect(await pending).toMatchObject({ type: "cancelled" });
  });

  it("treats surviving descendants as outcome_unknown", async () => {
    const result = await executeManagedBash(
      {
        command: "bash",
        args: ["-c", "sleep 30 >/dev/null 2>&1 & exit 0"],
      },
      context(directory),
      { toolCallId: "tc-orphan" },
    );
    expect(result).toMatchObject({ type: "outcome_unknown" });
  });
});
