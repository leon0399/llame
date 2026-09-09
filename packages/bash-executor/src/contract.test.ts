import { readFileSync } from "node:fs";
import { isRecord, isString } from "@workspace/runtime-safety";
import { requireManagedBoundary, sanitizeKnownResult } from "./index";
import type { BashExecutorContext, BashKnownResult } from "./types";

function context(
  overrides: Partial<BashExecutorContext> = {},
): BashExecutorContext {
  return {
    workingDirectory: "/tmp/llame-workspace",
    secretBoundary: true,
    processIsolation: true,
    outputBound: 64,
    inputBound: 256,
    durationMs: 1000,
    maxProcesses: 1,
    ...overrides,
  };
}

describe("bash-executor contract", () => {
  it("imports no Git, Markdown, URL, or permission implementation", () => {
    const parsed: unknown = JSON.parse(readFileSync("package.json", "utf8"));
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) return;
    const dependencyBlocks = [parsed.dependencies, parsed.devDependencies];
    const names = [];
    for (const block of dependencyBlocks) {
      if (!isRecord(block)) continue;
      for (const name of Object.keys(block)) {
        if (isString(name)) names.push(name);
      }
    }
    const joined = names.join(" ");
    expect(joined).not.toMatch(
      /git|markdown|marked|mdast|fetch|url-loader|rbac|permission/i,
    );
    expect(joined).toContain("@workspace/runtime-safety");
  });

  it("sanitizes host paths, secrets, stack traces, and unbounded output", () => {
    const raw: BashKnownResult = {
      status: "success",
      operation: "bash",
      executor: "managed",
      exitCode: 0,
      stdout: `${"/tmp/llame-workspace"}/secret.txt\nAUTH-TOKEN\nat Object.run (/usr/lib/node)\n${"x".repeat(200)}`,
      stderr: "Error: boom\n    at fail (/home/leon0399/proj/x.ts:1:1)",
      truncated: false,
    };
    const sanitized = sanitizeKnownResult(raw, context(), ["AUTH-TOKEN"]);
    expect(sanitized.stdout).not.toContain("/tmp/llame-workspace");
    expect(sanitized.stdout).not.toContain("AUTH-TOKEN");
    expect(sanitized.stdout).not.toContain("at Object.run");
    expect(sanitized.stdout.length).toBeLessThanOrEqual(64);
    expect(sanitized.truncated).toBe(true);
    expect(sanitized.stderr).not.toContain("/home/leon0399");
    expect(sanitized.stderr).not.toMatch(/at fail/);
  });

  it("stays unavailable when a managed boundary field is missing", () => {
    expect(
      requireManagedBoundary(context({ secretBoundary: false })),
    ).toMatchObject({ type: "boundary_missing" });
  });
});
