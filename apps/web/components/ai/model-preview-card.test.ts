/**
 * `formatTokens`/`formatUsd`/`formatDate` are pure formatting logic
 * (docs/testing.md rule 5's "pure logic" carve-out). Both are pinned to
 * "en-US"/"UTC" rather than the host locale/timezone (see the JSDoc on
 * these in model-preview-card.tsx) — these expectations hold on every host,
 * which is exactly what the pin buys. The card's render itself is covered by
 * this component's own model-preview-card.stories.tsx.
 */

import { describe, expect, it } from "vitest";

import { formatDate, formatTokens, formatUsd } from "./model-preview-card";

describe("formatTokens", () => {
  it("groups thousands with commas, en-US style", () => {
    expect(formatTokens(1_234_567)).toBe("1,234,567");
  });

  it("passes through a value with no grouping needed", () => {
    expect(formatTokens(200)).toBe("200");
  });
});

describe("formatUsd", () => {
  it("formats as a two-decimal USD amount", () => {
    expect(formatUsd(3.5)).toBe("$3.50");
  });

  it("groups thousands in a large price", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("formatDate", () => {
  it("formats a date-only ISO string as a long en-US date", () => {
    // Date-only ISO strings parse at UTC midnight; pinning timeZone: "UTC"
    // means this holds regardless of the host's own timezone offset.
    expect(formatDate("2026-01-05")).toBe("January 5, 2026");
  });

  it("does not shift across a year boundary", () => {
    expect(formatDate("2026-12-31")).toBe("December 31, 2026");
  });
});
