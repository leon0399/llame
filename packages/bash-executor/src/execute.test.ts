import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIGURED_TOOLS,
  executeManagedBash,
  isConfiguredTool,
  MANAGED_EXECUTOR,
  requireManagedBoundary,
  resolveConfiguredTool,
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
    directory = await mkdtemp(join(tmpdir(), "bash-exec-"));
  });

  afterEach(async () => {
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
});
