import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearFence,
  createAttemptReceipt,
  executeManagedBash,
  recoverIncompleteAttempts,
  refusesUnknownReplay,
  resetManagedExecutorForTests,
} from "./index";
import { getAttempt, recordAttemptStart } from "./attempt-ledger";
import type { BashExecutorContext } from "./types";

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

  it("marks timeout as outcome_unknown and fences the directory", async () => {
    const result = await executeManagedBash(
      { command: "bash", args: ["-c", "while true; do sleep 0.05; done"] },
      context(directory, { durationMs: 80 }),
      { toolCallId: "tc-timeout" },
    );
    expect(result).toMatchObject({ type: "outcome_unknown" });

    const blocked = await executeManagedBash(
      { command: "bash", args: ["-c", "printf next"] },
      context(directory),
      { toolCallId: "tc-next" },
    );
    expect(blocked).toMatchObject({ type: "unavailable" });

    const replay = await executeManagedBash(
      { command: "bash", args: ["-c", "while true; do sleep 0.05; done"] },
      context(directory),
      { toolCallId: "tc-replay" },
    );
    expect(replay).toMatchObject({ type: "unavailable" });

    clearFence(directory);
    const after = await executeManagedBash(
      { command: "bash", args: ["-c", "printf recovered"] },
      context(directory),
      { toolCallId: "tc-recovered" },
    );
    expect(after).toMatchObject({ status: "success", stdout: "recovered" });
  });

  it("refuses a new tool-call ID from replaying an unknown digest", async () => {
    const first = await executeManagedBash(
      { command: "bash", args: ["-c", "while true; do sleep 0.05; done"] },
      context(directory, { durationMs: 80 }),
      { toolCallId: "tc-original" },
    );
    expect(first).toMatchObject({ type: "outcome_unknown" });

    clearFence(directory);
    const digest = createAttemptReceipt({
      command: "bash",
      args: ["-c", "while true; do sleep 0.05; done"],
    }).commandDigest;
    expect(refusesUnknownReplay(digest)).toBe(true);

    const replay = await executeManagedBash(
      { command: "bash", args: ["-c", "while true; do sleep 0.05; done"] },
      context(directory),
      { toolCallId: "tc-new-id" },
    );
    expect(replay).toMatchObject({ type: "unavailable" });
    expect("message" in replay ? String(replay.message) : "").toMatch(
      /not replayed/i,
    );
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
    clearFence(directory);
  });

  it("recovers incomplete attempts after a simulated host crash", async () => {
    const receipt = createAttemptReceipt({
      command: "bash",
      args: ["-c", "printf crash"],
    });
    recordAttemptStart(receipt, directory, "tc-crash");
    expect(getAttempt(receipt.attemptId)?.state).toBe("started");

    const recovered = recoverIncompleteAttempts();
    expect(recovered).toEqual([
      expect.objectContaining({
        type: "outcome_unknown",
        attemptId: receipt.attemptId,
      }),
    ]);
    expect(getAttempt(receipt.attemptId)?.state).toBe("unknown");

    const blocked = await executeManagedBash(
      { command: "bash", args: ["-c", "printf crash"] },
      context(directory),
      { toolCallId: "tc-crash-replay" },
    );
    expect(blocked).toMatchObject({ type: "unavailable" });
  });
});
