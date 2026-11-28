import { describe, expect, it } from "vitest";

import { isLongMessage } from "./composer-expand";

describe("isLongMessage", () => {
  it("offers the expand past 280 characters", () => {
    expect(isLongMessage("x".repeat(280))).toBe(false);
    expect(isLongMessage("x".repeat(281))).toBe(true);
  });

  it("offers the expand past five lines", () => {
    expect(isLongMessage(["a", "b", "c", "d", "e"].join("\n"))).toBe(false);
    expect(isLongMessage(["a", "b", "c", "d", "e", "f"].join("\n"))).toBe(true);
  });
});
