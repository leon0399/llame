import { describe, expect, it } from "vitest";

import { extractPlaceholders, fillPlaceholders } from "./templating";

describe("extractPlaceholders", () => {
  it("returns unique names in first-seen order, trimmed", () => {
    expect(
      extractPlaceholders("Translate to {{ language }}: {{text}}"),
    ).toEqual(["language", "text"]);
  });

  it("dedupes a repeated name", () => {
    expect(extractPlaceholders("{{x}} and {{x}} again")).toEqual(["x"]);
  });

  it("returns [] for a body with none, and ignores empty {{}} / {{ }}", () => {
    expect(extractPlaceholders("no placeholders")).toEqual([]);
    expect(extractPlaceholders("a {{}} b {{  }} c")).toEqual([]);
  });
});

describe("fillPlaceholders", () => {
  it("substitutes each placeholder", () => {
    expect(
      fillPlaceholders("Translate to {{language}}: {{text}}", {
        language: "French",
        text: "hello",
      }),
    ).toBe("Translate to French: hello");
  });

  it("fills a duplicate everywhere", () => {
    expect(fillPlaceholders("{{x}}-{{x}}", { x: "z" })).toBe("z-z");
  });

  it("unfilled/missing → empty string", () => {
    expect(fillPlaceholders("a {{gap}} b", {})).toBe("a  b");
  });

  it("passes a no-placeholder body through unchanged", () => {
    expect(fillPlaceholders("just text", { x: "y" })).toBe("just text");
  });

  it("does NOT re-expand a value that itself contains {{...}} (single pass)", () => {
    expect(fillPlaceholders("{{a}}", { a: "{{b}}", b: "SHOULD_NOT_APPEAR" })).toBe(
      "{{b}}",
    );
  });
});
