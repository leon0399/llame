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

  it("preserves paths, tracebacks, and error lines while redacting secrets", () => {
    const raw: BashKnownResult = {
      status: "success",
      operation: "bash",
      executor: "managed",
      exitCode: 0,
      stdout: `${"/tmp/llame-workspace"}/secret.txt\nTraceback (most recent call last):\n  at Object.run (/usr/lib/node)\nError: boom\nAUTH-TOKEN\n`,
      stderr: "Error: boom\n    at fail (/home/leon0399/proj/x.ts:1:1)",
      truncated: false,
    };
    const sanitized = sanitizeKnownResult(raw, context({ outputBound: 512 }), [
      "AUTH-TOKEN",
    ]);
    expect(sanitized.stdout).toBe(
      `${"/tmp/llame-workspace"}/secret.txt\nTraceback (most recent call last):\n  at Object.run (/usr/lib/node)\nError: boom\n[REDACTED]\n`,
    );
    expect(sanitized.stderr).toBe(
      "Error: boom\n    at fail (/home/leon0399/proj/x.ts:1:1)",
    );
    expect(sanitized.truncated).toBe(false);
  });

  it("redacts protected values before cutting at a code point boundary", () => {
    const raw: BashKnownResult = {
      status: "success",
      operation: "bash",
      executor: "managed",
      exitCode: 0,
      stdout: "prefix AUTH-TOKEN 😀 suffix",
      stderr: "",
      truncated: false,
    };
    const sanitized = sanitizeKnownResult(raw, context({ outputBound: 19 }), [
      "AUTH-TOKEN",
    ]);
    expect(sanitized.stdout).toBe("prefix [REDACTED] ");
    expect(sanitized.stdout).not.toContain("AUTH-TOKEN");
    expect(sanitized.truncated).toBe(true);
  });

  it("stays unavailable when a managed boundary field is missing", () => {
    expect(
      requireManagedBoundary(context({ secretBoundary: false })),
    ).toMatchObject({ type: "boundary_missing" });
  });
});
