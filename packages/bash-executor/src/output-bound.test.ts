import {
  boundedLength,
  cutToBound,
  streamOutputBound,
  type StreamBound,
} from "./index";
import type { BashExecutorContext } from "./types";

function context(
  overrides: Partial<BashExecutorContext> = {},
): BashExecutorContext {
  return {
    workingDirectory: "/tmp",
    secretBoundary: true,
    processIsolation: true,
    outputBound: 8,
    inputBound: 16,
    durationMs: 1000,
    maxProcesses: 1,
    ...overrides,
  };
}

const BYTES: StreamBound = { kind: "bytes", limit: 8 };
const UNITS: StreamBound = { kind: "code-units", limit: 8 };

describe("the stream output bound", () => {
  it("takes the byte bound when a context sets one", () => {
    expect(streamOutputBound(context({ outputBoundBytes: 1024 }))).toEqual({
      kind: "bytes",
      limit: 1024,
    });
    expect(streamOutputBound(context({ outputBound: 32 }))).toEqual({
      kind: "code-units",
      limit: 32,
    });
  });

  it("fails a context with neither bound closed", () => {
    expect(streamOutputBound({ ...context(), outputBound: undefined })).toEqual(
      { kind: "code-units", limit: 0 },
    );
  });

  it("measures a string in the bound's own unit", () => {
    expect(boundedLength("é😀", BYTES)).toBe(6);
    expect(boundedLength("é😀", UNITS)).toBe(3);
  });

  it("keeps a string within the bound as the same value", () => {
    const text = "abcdefgh";
    expect(cutToBound(text, BYTES)).toBe(text);
    expect(cutToBound(text, UNITS)).toBe(text);
  });

  it("cuts bytes without splitting a surrogate pair", () => {
    // Four bytes for the emoji, then four ASCII bytes fill the bound.
    expect(cutToBound("😀abcd", { kind: "bytes", limit: 7 })).toBe("😀abc");
    expect(cutToBound("😀abcd", { kind: "bytes", limit: 8 })).toBe("😀abcd");
  });

  it("cuts code units without splitting a surrogate pair", () => {
    // A cut between the two halves of the pair backs off, so the bound of one
    // unit keeps nothing rather than half an emoji.
    expect(cutToBound("😀abc", { kind: "code-units", limit: 1 })).toBe("");
    expect(cutToBound("😀abc", { kind: "code-units", limit: 2 })).toBe("😀");
  });
});
