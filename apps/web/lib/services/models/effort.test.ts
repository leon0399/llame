import { describe, expect, it } from "vitest";

import { effortDisplayLabel } from "./effort";

const LEVELS = [
  { value: "none" },
  { value: "xhigh", label: "Extra High" },
] as const;

describe("effortDisplayLabel", () => {
  it("returns the label when present", () => {
    expect(effortDisplayLabel(LEVELS, "xhigh")).toBe("Extra High");
  });

  it("falls back to the value when unlabeled", () => {
    expect(effortDisplayLabel(LEVELS, "none")).toBe("none");
  });

  it("falls back to the value when levels are missing or unknown", () => {
    expect(effortDisplayLabel(undefined, "max")).toBe("max");
    expect(effortDisplayLabel(LEVELS, "max")).toBe("max");
  });
});
