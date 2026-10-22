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
      kind: "passage",
      scopeIndex: 2,
      rel: "notes/a.md",
      startLine: 12,
      endLine: undefined,
      truncated: undefined,
      inputHash: "abc",
    });
  });

  it("keeps the last line of a cut passage", () => {
    const cursor = encodeGrepCursor({
      scopeIndex: 0,
      rel: "a.md",
      startLine: 4,
      endLine: 9,
      inputHash: "abc",
    });
    expect(decodeGrepCursor(cursor, "abc")).toMatchObject({
      kind: "passage",
      startLine: 4,
      endLine: 9,
    });
  });

  it("keeps the file-exhausted flag", () => {
    const cursor = encodeGrepCursor({
      kind: "passage",
      scopeIndex: 0,
      rel: "a.md",
      startLine: 40,
      truncated: true,
      inputHash: "abc",
    });
    expect(decodeGrepCursor(cursor, "abc")).toMatchObject({ truncated: true });
  });

  it("round-trips a position key", () => {
    const cursor = encodeGrepCursor({
      kind: "position",
      scopeIndex: 1,
      rel: "src/a.md",
      inputHash: "abc",
    });
    expect(decodeGrepCursor(cursor, "abc")).toEqual({
      kind: "position",
      scopeIndex: 1,
      rel: "src/a.md",
      inputHash: "abc",
    });
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
      JSON.stringify({
        kind: "passage",
        scopeIndex: 0,
        rel: "a",
        startLine: 1,
      }),
      "utf8",
    ).toString("base64url");
    expect(decodeGrepCursor(missingHash, "abc")).toEqual({
      error: "invalid_cursor",
    });
    const badStart = Buffer.from(
      JSON.stringify({
        kind: "passage",
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
    const unknownKind = Buffer.from(
      JSON.stringify({
        kind: "line",
        scopeIndex: 0,
        rel: "a",
        startLine: 1,
        inputHash: "abc",
      }),
      "utf8",
    ).toString("base64url");
    expect(decodeGrepCursor(unknownKind, "abc")).toEqual({
      error: "invalid_cursor",
    });
    const positionWithLine = Buffer.from(
      JSON.stringify({
        kind: "position",
        scopeIndex: 0,
        rel: "a",
        startLine: 1,
        inputHash: "abc",
      }),
      "utf8",
    ).toString("base64url");
    expect(decodeGrepCursor(positionWithLine, "abc")).toEqual({
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
