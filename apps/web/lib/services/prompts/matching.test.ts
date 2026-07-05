import { describe, expect, it } from "vitest";

import { matchingPrompts, type PromptSummary } from "./matching";

const prompts: PromptSummary[] = [
  { id: "1", name: "summarize", content: "Summarize: " },
  { id: "2", name: "Standup", content: "Daily standup: " },
];

describe("matchingPrompts", () => {
  it("triggers on a lone /<slug> token, prefix-filtered", () => {
    expect(matchingPrompts("/sum", prompts)?.map((p) => p.name)).toEqual([
      "summarize",
    ]);
  });

  it("is case-insensitive on the prefix", () => {
    expect(matchingPrompts("/stand", prompts)?.map((p) => p.name)).toEqual([
      "Standup",
    ]);
  });

  it("does NOT trigger for bare '/' (so a literal '/' message can send)", () => {
    expect(matchingPrompts("/", prompts)).toBeNull();
  });

  it("does NOT trigger when the message merely contains a slash (has spaces)", () => {
    expect(matchingPrompts("what is /etc/hosts", prompts)).toBeNull();
  });

  it("does NOT trigger on a multiline paste starting with '/'", () => {
    expect(matchingPrompts("/foo\nbar", prompts)).toBeNull();
  });

  it("returns null when nothing matches (so /xyz still sends literally)", () => {
    expect(matchingPrompts("/zzz", prompts)).toBeNull();
  });
});
