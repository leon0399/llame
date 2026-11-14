/**
 * Pure status-resolution logic only — the badge's rendered states live in
 * chat-activity-indicator.stories.tsx (docs/development/testing.md rule 5).
 */

import { describe, expect, it } from "vitest";

import {
  processingLabel,
  resolveChatActivityStatus,
} from "./chat-activity-indicator";

describe("resolveChatActivityStatus", () => {
  it.each([
    [false, false, undefined, null],
    [false, false, "completed", "unread"],
    [false, false, "failed", "failed"],
    [true, false, undefined, "processing"],
    // A generating reply has no outcome yet, whatever the last run did.
    [true, false, "completed", "processing"],
    [true, false, "failed", "processing"],
    [false, true, undefined, "background"],
    [false, true, "completed", "background"],
    [false, true, "failed", "background"],
    // Active replies outrank background jobs; background work outranks outcomes.
    [true, true, "failed", "processing"],
  ] as const)(
    "processing=%s, background=%s, outcome=%s → %s",
    (processing, background, outcome, status) => {
      expect(
        resolveChatActivityStatus({ processing, background, outcome }),
      ).toBe(status);
    },
  );
});

describe("processingLabel", () => {
  it.each([
    [undefined, "Generating response"],
    ["queued", "Generating response: queued"],
    ["thinking", "Generating response: thinking"],
    ["tool", "Generating response: using a tool"],
    ["writing", "Generating response: writing"],
  ] as const)("labels phase %s as %s", (phase, label) => {
    expect(processingLabel(phase)).toBe(label);
  });
});
