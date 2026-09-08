import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIGURED_TOOLS,
  admitManagedBash,
  executeManagedBash,
  isConfiguredTool,
  MANAGED_EXECUTOR,
  requireManagedBoundary,
  resolveConfiguredTool,
  resetManagedExecutorForTests,
} from "./index";
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
    durationMs: 2000,
    maxProcesses: 1,
    ...overrides,
  };
}

describe("managed executor contract", () => {
  let directory: string;

  beforeEach(async () => {
    resetManagedExecutorForTests();
    directory = await mkdtemp(join(tmpdir(), "bash-exec-"));
  });

  afterEach(async () => {
    resetManagedExecutorForTests();
    await rm(directory, { recursive: true, force: true });
  });

  it("does not advertise direct host bash", () => {
    expect(MANAGED_EXECUTOR).toBe("managed");
    expect(MANAGED_EXECUTOR).not.toBe("native");
    expect(MANAGED_EXECUTOR).not.toBe("host");
  });

  it("lists ordinary configured tools without a canonical editor", () => {
    expect([...CONFIGURED_TOOLS]).toEqual([
      "bash",
      "grep",
      "rg",
      "jq",
      "python",
      "python3",
    ]);
    expect(resolveConfiguredTool("bash")).toBe("bash");
    expect(resolveConfiguredTool("/bin/bash")).toBeNull();
    expect(resolveConfiguredTool("sed")).toBeNull();
    expect(isConfiguredTool("rg")).toBe(true);
  });

  it("stays unavailable when any required boundary is missing", async () => {
    expect(
      requireManagedBoundary(context(directory, { secretBoundary: false })),
    ).toMatchObject({ type: "boundary_missing" });
    const result = await executeManagedBash(
      { command: "bash", args: ["-c", "printf ok"] },
      context(directory, { processIsolation: false }),
    );
    expect(result).toMatchObject({ type: "boundary_missing" });
  });

  it("runs a bounded allowlisted command in the trusted directory", async () => {
    await writeFile(join(directory, "note.txt"), "alpha\nbeta\n");
    const result = await executeManagedBash(
      { command: "bash", args: ["-c", "printf hello"] },
      context(directory),
    );
    expect(result).toMatchObject({
      status: "success",
      executor: "managed",
      exitCode: 0,
      stdout: "hello",
    });
  });

  it("rejects oversized input and non-configured tools", async () => {
    const oversized = await executeManagedBash(
      { command: "bash", args: ["-c", "x".repeat(600)] },
      context(directory, { inputBound: 32 }),
    );
    expect(oversized).toMatchObject({ type: "unavailable" });

    const denied = await executeManagedBash(
      { command: "sed", args: ["-n", "1p"] },
      context(directory),
    );
    expect(denied).toMatchObject({ type: "unavailable" });
  });

  it("returns partial output when a deadline stops the process group", async () => {
    const result = await executeManagedBash(
      {
        command: "bash",
        args: [
          "-c",
          "printf partial; printf diagnostic >&2; while true; do :; done",
        ],
      },
      context(directory, { durationMs: 100 }),
    );
    expect(result).toMatchObject({
      status: "error",
      type: "timed_out",
      durationMs: 100,
      stdout: "partial",
      stderr: "diagnostic",
      truncated: false,
    });
  });

  it("honours cancellation before completion", async () => {
    const controller = new AbortController();
    const pending = executeManagedBash(
      { command: "bash", args: ["-c", "while true; do printf x; done"] },
      context(directory, { durationMs: 5000 }),
      { signal: controller.signal },
    );
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ type: "cancelled" });
  });

  it("classifies the trusted timeout source separately from cancellation", async () => {
    const timeout = AbortSignal.timeout(100);
    const result = await executeManagedBash(
      {
        command: "bash",
        args: ["-c", "printf partial; while true; do :; done"],
      },
      context(directory, { durationMs: 5000 }),
      {
        signal: timeout,
        timeoutSignal: timeout,
        timeoutMs: 100,
      },
    );
    expect(result).toMatchObject({
      type: "timed_out",
      durationMs: 100,
      stdout: "partial",
    });
  });

  it("keeps the managed duration as the maximum trusted deadline", async () => {
    const timeout = AbortSignal.timeout(100);
    const result = await executeManagedBash(
      { command: "bash", args: ["-c", "while true; do :; done"] },
      context(directory, { durationMs: 25 }),
      { signal: timeout, timeoutSignal: timeout, timeoutMs: 100 },
    );
    expect(result).toMatchObject({ type: "timed_out", durationMs: 25 });
  });

  it("does not spawn after a deadline aborts while admission is held", async () => {
    const timeout = new AbortController();
    const input = { command: "bash", args: ["-c", "printf spawned"] };
    const admitted = admitManagedBash(input, context(directory), {
      signal: timeout.signal,
      timeoutSignal: timeout.signal,
      timeoutMs: 40,
    });
    if ("type" in admitted) throw new Error("Expected admission");
    timeout.abort();
    expect(await admitted.run()).toMatchObject({
      type: "timed_out",
      durationMs: 40,
      stdout: "",
    });
    expect(await executeManagedBash(input, context(directory))).toMatchObject({
      status: "success",
      stdout: "spawned",
    });
  });

  it("returns a timeout before admission when its deadline already fired", async () => {
    const timeout = new AbortController();
    timeout.abort();
    const result = await executeManagedBash(
      { command: "bash", args: ["-c", "printf never"] },
      context(directory),
      {
        signal: timeout.signal,
        timeoutSignal: timeout.signal,
        timeoutMs: 40,
      },
    );
    expect(result).toMatchObject({
      type: "timed_out",
      durationMs: 40,
      stdout: "",
    });
  });

  it("keeps caller cancellation distinct from an unexpired deadline", async () => {
    const cancellation = new AbortController();
    const timeout = new AbortController();
    const pending = executeManagedBash(
      { command: "bash", args: ["-c", "while true; do :; done"] },
      context(directory, { durationMs: 5000 }),
      {
        signal: cancellation.signal,
        timeoutSignal: timeout.signal,
        timeoutMs: 1000,
      },
    );
    cancellation.abort();
    expect(await pending).toMatchObject({ type: "cancelled" });
  });

  it("returns a known refusal when the working directory vanished", async () => {
    const missing = join(directory, "missing");
    const result = await executeManagedBash(
      { command: "bash", args: ["-c", "printf never"] },
      context(missing),
    );
    expect(result).toMatchObject({ type: "unavailable" });
  });

  it("returns a known refusal when spawn throws synchronously", async () => {
    const result = await executeManagedBash(
      { command: "bash", args: ["-c", "printf \0"] },
      context(directory),
    );
    expect(result).toMatchObject({ type: "unavailable" });
  });

  it("reserves admission while durable recording is pending and releases refusals", async () => {
    const input = { command: "bash", args: ["-c", "printf admitted"] };
    const admitted = admitManagedBash(input, context(directory));
    if ("type" in admitted) throw new Error("Expected admission");
    expect(await executeManagedBash(input, context(directory))).toMatchObject({
      type: "unavailable",
      message: "Managed process limit reached.",
    });
    admitted.release();
    admitted.release();
    expect(await admitted.run()).toMatchObject({ type: "unavailable" });
    expect(await executeManagedBash(input, context(directory))).toMatchObject({
      status: "success",
      stdout: "admitted",
    });
  });

  it("cancels before spawn when aborted during durable recording", async () => {
    const controller = new AbortController();
    const input = { command: "bash", args: ["-c", "printf never"] };
    const admitted = admitManagedBash(input, context(directory), {
      signal: controller.signal,
    });
    if ("type" in admitted) throw new Error("Expected admission");
    controller.abort();
    expect(await admitted.run()).toMatchObject({ type: "cancelled" });
    expect(await executeManagedBash(input, context(directory))).toMatchObject({
      status: "success",
      stdout: "never",
    });
  });
});
