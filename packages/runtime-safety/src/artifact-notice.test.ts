import { describe, expect, it } from "vitest";

import {
  ARTIFACT_NOT_STORED,
  artifactNotice,
  isOversizedResult,
  RESULT_TRUNCATE_CHARS,
  truncateOversizedResult,
} from "./index";
import { type ToolResult } from "./types";
import { isString } from "./unknown-record";

const LOCATOR = "artifact://mcp__docs__fetch-4";

function noticeOf(result: ToolResult): string {
  if (result.status !== "success" || !isString(result.truncationNotice)) {
    throw new Error(`Expected a capped result, got ${JSON.stringify(result)}`);
  }
  return result.truncationNotice;
}

describe("artifactNotice", () => {
  it("names one part with its line count and no continuation", () => {
    expect(
      artifactNotice([{ locator: "artifact://bash-5/stdout", lines: 5000 }]),
    ).toBe("[full result: artifact://bash-5/stdout (5000 lines)]");
  });

  it("reads a single line as `1 line`", () => {
    expect(artifactNotice([{ locator: "artifact://grep-7", lines: 1 }])).toBe(
      "[full result: artifact://grep-7 (1 line)]",
    );
  });

  it("joins two parts with a comma", () => {
    expect(
      artifactNotice([
        { locator: "artifact://bash-5/stdout", lines: 12 },
        { locator: "artifact://bash-5/stderr", lines: 3 },
      ]),
    ).toBe(
      "[full result: artifact://bash-5/stdout (12 lines), artifact://bash-5/stderr (3 lines)]",
    );
  });

  it("continues from the next artifact line when asked", () => {
    expect(
      artifactNotice([{ locator: "artifact://grep-7", lines: 4812 }], {
        continueWith: { locator: "artifact://grep-7", next: 201 },
      }),
    ).toBe(
      "[full result: artifact://grep-7 (4812 lines); continue with artifact://grep-7:201-]",
    );
  });

  it("names the host directory, or the host-only text", () => {
    expect(
      artifactNotice([{ locator: "artifact://bash-5/stdout", lines: 5 }], {
        host: { kind: "directory", directory: "/tmp/llame/chats/c1/artifacts" },
      }),
    ).toBe(
      "[full result: artifact://bash-5/stdout (5 lines); host files in /tmp/llame/chats/c1/artifacts]",
    );
    expect(
      artifactNotice([{ locator: "artifact://bash-5/stdout", lines: 5 }], {
        host: { kind: "host-only" },
      }),
    ).toBe(
      "[full result: artifact://bash-5/stdout (5 lines); host files on the llame host only]",
    );
  });

  it("renders a line break in a value as one space", () => {
    expect(
      artifactNotice([{ locator: "artifact://a-1", lines: 2 }], {
        host: { kind: "directory", directory: "/tmp/a\nb" },
      }),
    ).toBe("[full result: artifact://a-1 (2 lines); host files in /tmp/a b]");
  });
});

describe("isOversizedResult", () => {
  it("is false for a result at the cap and true for one over it", () => {
    const atCap: ToolResult = {
      status: "success",
      blob: "x".repeat(RESULT_TRUNCATE_CHARS - 30),
    };
    expect(JSON.stringify(atCap).length).toBe(RESULT_TRUNCATE_CHARS);
    expect(isOversizedResult(atCap)).toBe(false);
    expect(
      isOversizedResult({
        status: "success",
        blob: "x".repeat(RESULT_TRUNCATE_CHARS),
      }),
    ).toBe(true);
  });

  it("never reports an error as oversized", () => {
    expect(
      isOversizedResult({
        status: "error",
        type: "execution_failed",
        message: "x".repeat(RESULT_TRUNCATE_CHARS * 2),
      }),
    ).toBe(false);
  });

  it("follows the display rule of the truncation", () => {
    const measure = (candidate: ToolResult): number =>
      JSON.stringify(candidate).length;
    const result: ToolResult = {
      status: "success",
      content: "x".repeat(RESULT_TRUNCATE_CHARS),
      display: { startLine: 1, oldText: "a", newText: "b" },
    };

    expect(isOversizedResult(result, measure)).toBe(true);
    expect(truncateOversizedResult(result, measure)).toMatchObject({
      truncated: true,
      display: { startLine: 1, oldText: "a", newText: "b" },
    });
  });
});

describe("truncateOversizedResult — head spill", () => {
  const oversized = (): ToolResult => ({
    status: "success",
    content: "x".repeat(RESULT_TRUNCATE_CHARS * 2),
  });

  it("pins the artifact field and names the locator, line count, and range", () => {
    const result = truncateOversizedResult(
      { ...oversized(), artifact: LOCATOR },
      undefined,
      { kind: "stored", locator: LOCATOR, lineCount: 900 },
    );

    expect(result).toMatchObject({ artifact: LOCATOR, truncated: true });
    const notice = noticeOf(result);
    expect(notice).toContain(
      `The full result is ${LOCATOR} (900 lines); read it from ${LOCATOR}:1-.`,
    );
    expect(notice).toContain(
      "Re-run this tool with narrower arguments if you need the omitted content.",
    );
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
  });

  it("says the full result is not stored when the write did not happen", () => {
    const result = truncateOversizedResult(oversized(), undefined, {
      kind: "not-stored",
    });

    expect(result).not.toHaveProperty("artifact");
    expect(noticeOf(result)).toContain(ARTIFACT_NOT_STORED);
  });

  it("carries no artifact clause without a spill", () => {
    const notice = noticeOf(truncateOversizedResult(oversized()));

    expect(notice).not.toContain("The full result is");
    expect(notice).not.toContain(ARTIFACT_NOT_STORED);
  });
});
