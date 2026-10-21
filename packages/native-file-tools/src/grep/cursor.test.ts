import { decodeGrepCursor, encodeGrepCursor, hashGrepInputs } from "./cursor";

const INPUTS = {
  patterns: ["a"],
  literal: false,
  ignoreCase: false,
  projectedScopes: ["/home/u/repo/"],
  resolvedRoots: [],
};

describe("grep cursor codec", () => {
  it("round-trips a passage key", () => {
    const cursor = encodeGrepCursor({
      scopeIndex: 2,
      rel: "notes/a.md",
      startLine: 12,
      inputHash: "abc",
    });
    expect(decodeGrepCursor(cursor, "abc")).toEqual({
      scopeIndex: 2,
      rel: "notes/a.md",
      startLine: 12,
      truncated: undefined,
      inputHash: "abc",
    });
  });

  it("keeps the file-exhausted flag", () => {
    const cursor = encodeGrepCursor({
      scopeIndex: 0,
      rel: "a.md",
      startLine: 40,
      truncated: true,
      inputHash: "abc",
    });
    expect(decodeGrepCursor(cursor, "abc")).toMatchObject({ truncated: true });
  });

  it("refuses a cursor issued for other inputs", () => {
    const cursor = encodeGrepCursor({
      scopeIndex: 0,
      rel: "a.md",
      startLine: 1,
      inputHash: "abc",
    });
    expect(decodeGrepCursor(cursor, "other")).toEqual({
      error: "invalid_cursor",
    });
  });

  it("refuses malformed payloads", () => {
    expect(decodeGrepCursor("not base64url!", "abc")).toEqual({
      error: "invalid_cursor",
    });
    expect(decodeGrepCursor("bm90LWpzb24", "abc")).toEqual({
      error: "invalid_cursor",
    });
    const missingHash = Buffer.from(
      JSON.stringify({ scopeIndex: 0, rel: "a", startLine: 1 }),
      "utf8",
    ).toString("base64url");
    expect(decodeGrepCursor(missingHash, "abc")).toEqual({
      error: "invalid_cursor",
    });
    const badStart = Buffer.from(
      JSON.stringify({
        scopeIndex: 0,
        rel: "a",
        startLine: 0,
        inputHash: "abc",
      }),
      "utf8",
    ).toString("base64url");
    expect(decodeGrepCursor(badStart, "abc")).toEqual({
      error: "invalid_cursor",
    });
  });
});

describe("grep input hash", () => {
  it("is stable for the same resolved inputs", () => {
    expect(hashGrepInputs(INPUTS)).toBe(hashGrepInputs({ ...INPUTS }));
  });

  it("changes with patterns, scopes, roots, or flags", () => {
    const base = hashGrepInputs(INPUTS);
    expect(hashGrepInputs({ ...INPUTS, patterns: ["b"] })).not.toBe(base);
    expect(
      hashGrepInputs({ ...INPUTS, projectedScopes: ["/home/u/b/"] }),
    ).not.toBe(base);
    expect(hashGrepInputs({ ...INPUTS, resolvedRoots: ["kb-1"] })).not.toBe(
      base,
    );
    expect(hashGrepInputs({ ...INPUTS, literal: true })).not.toBe(base);
    expect(hashGrepInputs({ ...INPUTS, ignoreCase: true })).not.toBe(base);
  });
});
