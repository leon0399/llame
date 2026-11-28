import { describe, expect, it } from "vitest";

import { knowledgeSpaceNameError } from "./name";

describe("knowledgeSpaceNameError", () => {
  it("accepts a trimmed name of 1 through 100 code points", () => {
    expect(knowledgeSpaceNameError("  Notes  ")).toBeNull();
    expect(knowledgeSpaceNameError("😀".repeat(100))).toBeNull();
  });

  it("rejects an empty name and a name past 100 code points", () => {
    expect(knowledgeSpaceNameError("   ")).toBe("Enter a name.");
    expect(knowledgeSpaceNameError("😀".repeat(101))).toBe(
      "Use 100 characters or fewer.",
    );
  });
});
