import { describe, expect, it } from "vitest";

import { compactionBoundaryIndex } from "./compaction";

const msg = (seq?: number) => ({ metadata: seq === undefined ? {} : { seq } });

describe("compactionBoundaryIndex", () => {
  it("is the first message past uptoSeq (strictly greater)", () => {
    // seq: 1,2,3,4 ; uptoSeq 2 → boundary before seq 3 (index 2).
    expect(compactionBoundaryIndex([msg(1), msg(2), msg(3), msg(4)], 2)).toBe(
      2,
    );
  });

  it("treats live/seq-less messages as newest (after the boundary)", () => {
    // history seq 1,2 (both <= uptoSeq) then a live message → boundary at the live one.
    expect(compactionBoundaryIndex([msg(1), msg(2), msg()], 5)).toBe(2);
  });

  it("returns -1 when there is no compaction", () => {
    expect(compactionBoundaryIndex([msg(1), msg(2)], null)).toBe(-1);
    expect(compactionBoundaryIndex([msg(1)], undefined)).toBe(-1);
  });

  it("returns -1 when there are no messages", () => {
    expect(compactionBoundaryIndex([], 5)).toBe(-1);
  });

  it("marks at the END when EVERY loaded message is summarized (the key case)", () => {
    // all seq <= uptoSeq → boundary after the last (messages.length), NOT -1.
    expect(compactionBoundaryIndex([msg(1), msg(2), msg(3)], 10)).toBe(3);
  });

  it("marks at the TOP when the whole loaded window is post-boundary", () => {
    // all seq > uptoSeq (older summarized ones not loaded) → index 0.
    expect(compactionBoundaryIndex([msg(20), msg(21)], 10)).toBe(0);
  });
});
