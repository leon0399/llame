import { PROTECTED_VALUE_REDACTION_MARKER } from "@workspace/runtime-safety";
import { boundedLength } from "./output-bound";
import { sanitizeKnownResult, type ResultCaptures } from "./sanitize";
import type { BashExecutorContext, BashKnownResult } from "./types";

const MARKER = PROTECTED_VALUE_REDACTION_MARKER;

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

type SanitizeOptions = {
  readonly bound?: number;
  readonly boundBytes?: number;
  readonly endedByLlame?: boolean;
  readonly gapAt?: number;
  readonly truncated?: boolean;
};

function sanitizeStdout(
  stdout: string,
  protectedValues: ReadonlyArray<string>,
  options: SanitizeOptions = {},
): BashKnownResult {
  const bound =
    options.boundBytes === undefined
      ? context({ outputBound: options.bound ?? 64 })
      : context({ outputBoundBytes: options.boundBytes });

  const captures: ResultCaptures =
    options.gapAt === undefined
      ? { stdout: { endedByLlame: options.endedByLlame ?? false } }
      : {
          stdout: {
            endedByLlame: options.endedByLlame ?? true,
            gapAt: options.gapAt,
          },
        };

  return sanitizeKnownResult(
    {
      status: "success",
      exitCode: 0,
      stdout,
      stderr: "",
      truncated: options.truncated ?? false,
    },
    bound,
    protectedValues,
    captures,
  );
}

function expectNoMember(
  text: string,
  protectedValues: ReadonlyArray<string>,
): void {
  for (const protectedValue of protectedValues) {
    expect(text).not.toContain(protectedValue);
  }
}

function expectNoSplitMarker(text: string): void {
  const residue = text.split(MARKER).join("");
  expect(residue).not.toMatch(/REDACT/);
}

function expectWithinBound(text: string, options: SanitizeOptions): void {
  const bound =
    options.boundBytes === undefined
      ? { kind: "code-units" as const, limit: options.bound ?? 64 }
      : { kind: "bytes" as const, limit: options.boundBytes };

  expect(boundedLength(text, bound)).toBeLessThanOrEqual(bound.limit);
}

describe("bash result sanitization", () => {
  it("redacts a member wholly before the bound without truncation", () => {
    const members = ["SECRET-KEY"];
    const sanitized = sanitizeStdout("prefix SECRET-KEY suffix", members);

    expect(sanitized.stdout).toBe(`prefix ${MARKER} suffix`);
    expect(sanitized.truncated).toBe(false);
    expectNoMember(sanitized.stdout, members);
    expectNoSplitMarker(sanitized.stdout);
  });

  it("redacts a member crossing the bound whole through the capture lookahead", () => {
    const members = ["SECRET-KEY-0123456789"];
    const options = { bound: 30 };

    const sanitized = sanitizeStdout(
      `012345678901234${members[0]}`,
      members,
      options,
    );

    expect(sanitized.stdout).toBe(`012345678901234${MARKER}`);
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
    expectNoSplitMarker(sanitized.stdout);
    expectWithinBound(sanitized.stdout, options);
  });

  it("redacts an earlier long member and drops the longest member just past the bound", () => {
    const members = ["AAAA-BBBB-CCCC", "ZZZZZZZZZZZZZZZZZZZZ"];
    const options = { bound: 40 };
    const text = `${members[0]}${".".repeat(26)}${members[1]}`;
    const sanitized = sanitizeStdout(text, members, options);

    expect(sanitized.stdout).toBe(`${MARKER}${".".repeat(26)}`);
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
    expectNoSplitMarker(sanitized.stdout);
    expectWithinBound(sanitized.stdout, options);
  });

  it("merges a crossing member whose last character begins another member", () => {
    const members = ["ABCDEFGHIJ", "JKL"];
    const options = { bound: 16 };
    const sanitized = sanitizeStdout(`xxxx${members[0]}KLMN`, members, options);

    expect(sanitized.stdout).toBe(`xxxx${MARKER}`);
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
    expectNoSplitMarker(sanitized.stdout);
    expectWithinBound(sanitized.stdout, options);
  });

  it("drops a container member whose capture was cut inside it", () => {
    const members = ["AUTH", "AUTH-SENTINEL"];

    const sanitized = sanitizeStdout("prefix AUTH-SENT", members, {
      endedByLlame: true,
    });

    expect(sanitized.stdout).toBe("prefix ");
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
    expectNoSplitMarker(sanitized.stdout);
  });

  it("drops a capture cut mid-member", () => {
    const members = ["SECRET-KEY"];

    const sanitized = sanitizeStdout("prefix SECRET", members, {
      endedByLlame: true,
    });

    expect(sanitized.stdout).toBe("prefix ");
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
  });

  it("keeps a natural exit's trailing member prefix", () => {
    const members = ["SECRET-KEY"];
    const sanitized = sanitizeStdout("prefix SECRET", members);

    expect(sanitized.stdout).toBe("prefix SECRET");
    expect(sanitized.truncated).toBe(false);
  });

  it("drops both member fragments around a transport gap", () => {
    const members = ["SECRET-KEY"];
    const sanitized = sanitizeStdout("xSECRET-KEYy", members, { gapAt: 4 });

    expect(sanitized.stdout).toBe("xy");
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
  });

  it("keeps a pre-bound member interval from a non-ASCII capture", () => {
    const members = ["SECRET-ключ"];
    const options = { boundBytes: 21 };

    const sanitized = sanitizeStdout(
      `0123456789${members[0]}`,
      members,
      options,
    );

    expect(sanitized.stdout).toBe("0123456789");
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
    expectNoSplitMarker(sanitized.stdout);
    expectWithinBound(sanitized.stdout, options);
  });
  it("replaces a complete member whose capture cut starts inside it", () => {
    const members = ["ABCDEFGHIJ", "JKL"];
    const options = { bound: 16 };

    const sanitized = sanitizeStdout(
      `${"x".repeat(15)}${members[0]}K`,
      members,
      { ...options, endedByLlame: true },
    );

    expect(sanitized.stdout).toBe("x".repeat(15));
    expect(sanitized.stdout).not.toMatch(/[A-K]/u);
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
    expectWithinBound(sanitized.stdout, options);
  });

  it("replaces a complete member a timeout drop starts inside", () => {
    const members = ["sk-live-abc123e", "eyJhbGciOiJIUzI1NiJ9"];

    const sanitized = sanitizeStdout("key=sk-live-abc123e", members, {
      endedByLlame: true,
    });

    expect(sanitized.stdout).toBe(`key=${MARKER}`);
    expect(sanitized.stdout).not.toContain("abc123");
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
  });

  it("drops only the tail fragment a transport gap left", () => {
    const members = ["SECRET-KEY-ABCDEF"];

    const sanitized = sanitizeStdout("aaaKEY-ABCDEF zzz", members, {
      gapAt: 3,
    });

    expect(sanitized.stdout).toBe("aaa zzz");
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
  });

  it("replaces a complete member wholly kept in front of a transport gap", () => {
    const members = ["ABCDEFGHIJ"];

    const sanitized = sanitizeStdout("xxABCDEFGHIJKLMN", members, {
      gapAt: 12,
    });

    expect(sanitized.stdout).toBe(`xx${MARKER}KLMN`);
    expect(sanitized.truncated).toBe(true);
    expectNoMember(sanitized.stdout, members);
  });
});
