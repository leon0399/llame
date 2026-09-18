import { describe, expect, it } from "vitest";

import { separateGluedReasoningBlocks } from "./reasoning-blocks.js";

describe("separateGluedReasoningBlocks", () => {
  it("splits heading-onto-heading parts (the `****` run)", () => {
    expect(
      separateGluedReasoningBlocks(
        "**Investigating likely culprit PRs****Inspecting message schema**",
      ),
    ).toBe(
      "**Investigating likely culprit PRs**\n\n**Inspecting message schema**",
    );
  });

  it("splits every run when more than two summaries glued together", () => {
    expect(separateGluedReasoningBlocks("**One****Two****Three**")).toBe(
      "**One**\n\n**Two**\n\n**Three**",
    );
  });

  it("splits prose-onto-heading parts at the end of a line", () => {
    const glued =
      "**Simulating a greeting stream**\n\nIt feels like a streaming interaction!**Simulating a greeting stream**\n\nI want to meet the request.";

    expect(separateGluedReasoningBlocks(glued)).toContain(
      "interaction!\n\n**Simulating",
    );
    expect(separateGluedReasoningBlocks(glued)).not.toContain("interaction!**");
  });

  it("splits prose-onto-heading when the heading ends the text", () => {
    expect(
      separateGluedReasoningBlocks(
        "prose without a trailing newline**Heading**",
      ),
    ).toBe("prose without a trailing newline\n\n**Heading**");
  });

  it("is idempotent on already-separated text", () => {
    const separated = "**One**\n\n**Two**";

    expect(separateGluedReasoningBlocks(separated)).toBe(separated);
  });

  it("leaves emphasis inside prose alone", () => {
    const prose =
      "Looking at the logs, the **signature** field is missing — so the replay 400s.";

    expect(separateGluedReasoningBlocks(prose)).toBe(prose);
  });

  it("leaves punctuation-adjacent inline emphasis alone", () => {
    const parenthetical = "Check (**signature**) next";
    const trailingProse = "The **signature** field is what I checked.";

    expect(separateGluedReasoningBlocks(parenthetical)).toBe(parenthetical);
    expect(separateGluedReasoningBlocks(trailingProse)).toBe(trailingProse);
  });

  it("leaves a bold span followed by prose on the same line alone", () => {
    const sameLine = "**Heading** and then the prose continues.";

    expect(separateGluedReasoningBlocks(sameLine)).toBe(sameLine);
  });

  it("leaves a standalone **** separator alone", () => {
    expect(separateGluedReasoningBlocks("****")).toBe("****");
    expect(separateGluedReasoningBlocks("before\n\n****\n\nafter")).toBe(
      "before\n\n****\n\nafter",
    );
  });

  it("leaves an unclosed emphasis run alone", () => {
    expect(separateGluedReasoningBlocks("weighing options **")).toBe(
      "weighing options **",
    );
  });

  it("does not split a heading that already opens the text", () => {
    expect(separateGluedReasoningBlocks("**Only one part**")).toBe(
      "**Only one part**",
    );
  });
});
