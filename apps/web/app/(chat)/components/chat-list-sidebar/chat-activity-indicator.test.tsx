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
    [false, undefined, null],
    [false, "completed", "unread"],
    [false, "failed", "failed"],
    [true, undefined, "processing"],
    // A generating reply has no outcome yet, whatever the last run did.
    [true, "completed", "processing"],
    [true, "failed", "processing"],
  ] as const)(
    "processing=%s, outcome=%s → %s",
    (processing, outcome, status) => {
      expect(resolveChatActivityStatus({ processing, outcome })).toBe(status);
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
