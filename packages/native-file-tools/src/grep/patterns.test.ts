import { vi } from "vitest";
import { compileGrepPatterns } from "./patterns";
import type { CompiledGrepPatterns } from "./patterns";

function compiled(
  patterns: ReadonlyArray<string>,
  literal = false,
  ignoreCase = false,
): CompiledGrepPatterns {
  const result = compileGrepPatterns({ patterns, literal, ignoreCase });
  if (!result.ok) throw new Error(result.message);
  return result.compiled;
}

describe("grep pattern compilation", () => {
  it("matches a line against any pattern of the disjunction", () => {
    const patterns = compiled(["alpha", "beta"]);
    expect(patterns.matches("an alpha line")).toBe(true);
    expect(patterns.matches("a beta line")).toBe(true);
    expect(patterns.matches("gamma")).toBe(false);
  });

  it("keeps metacharacters when literal is set", () => {
    const patterns = compiled(["a.b("], true);
    expect(patterns.matches("x a.b( y")).toBe(true);
    expect(patterns.matches("x axb( y")).toBe(false);
  });

  it("refuses a backreference with its pattern index", () => {
    const result = compileGrepPatterns({
      patterns: ["fine", String.raw`(a)\1`],
      literal: false,
      ignoreCase: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.index).toBe(1);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("refuses nine patterns", () => {
    const result = compileGrepPatterns({
      patterns: Array.from({ length: 9 }, (_, index) => `p${index}`),
      literal: false,
      ignoreCase: false,
    });
    expect(result).toMatchObject({ ok: false, index: 8 });
  });

  it("refuses an empty pattern list", () => {
    const result = compileGrepPatterns({
      patterns: [],
      literal: false,
      ignoreCase: false,
    });
    expect(result).toMatchObject({ ok: false, index: 0 });
  });

  it("refuses a pattern over 512 UTF-8 bytes at its index", () => {
    const result = compileGrepPatterns({
      patterns: ["small", "ä".repeat(300)],
      literal: false,
      ignoreCase: false,
    });
    expect(result).toMatchObject({ ok: false, index: 1 });
  });

  it("accepts a pattern of exactly 512 UTF-8 bytes", () => {
    expect(() => compiled(["a".repeat(512)])).not.toThrow();
  });

  it("ignores case on request", () => {
    expect(compiled(["todo"], false, true).matches("a TODO line")).toBe(true);
    expect(compiled(["todo"]).matches("a TODO line")).toBe(false);
  });

  it("refuses an unterminated class from the engine", () => {
    const result = compileGrepPatterns({
      patterns: ["["],
      literal: false,
      ignoreCase: false,
    });
    expect(result).toMatchObject({ ok: false, index: 0 });
  });

  it("asks the stop probe only between two pattern tests", () => {
    const stopped = vi.fn(() => true);
    const both = compiled(["zzz", "hit"]);

    // One pattern has no gap: the probe is never asked.
    expect(compiled(["a"]).matches("a", stopped)).toBe(true);
    expect(stopped).not.toHaveBeenCalled();
    // Between two tests the probe ends the line instead of reporting a miss,
    // so a later pattern's match is never silently lost.
    expect(both.matches("hit", stopped)).toBe("stopped");
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(compiled(["hit", "zzz"]).matches("hit", stopped)).toBe(true);
  });
});
