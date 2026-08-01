/**
 * Pure status-resolution logic only — the badge's rendered states live in
 * chat-activity-indicator.stories.tsx (docs/testing.md rule 5).
 */

import { describe, expect, it } from "vitest";

import { resolveChatActivityStatus } from "./chat-activity-indicator";

describe("resolveChatActivityStatus", () => {
  it("is null when neither signal is set (idle chat)", () => {
    expect(
      resolveChatActivityStatus({ processing: false, unread: false }),
    ).toBeNull();
  });

  it("is 'unread' when only the unread signal is set", () => {
    expect(resolveChatActivityStatus({ processing: false, unread: true })).toBe(
      "unread",
    );
  });

  it("is 'processing' when only the processing signal is set", () => {
    expect(resolveChatActivityStatus({ processing: true, unread: false })).toBe(
      "processing",
    );
  });

  it("prefers 'processing' when both signals are set — a generating reply isn't unread yet", () => {
    expect(resolveChatActivityStatus({ processing: true, unread: true })).toBe(
      "processing",
    );
  });
});
