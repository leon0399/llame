/**
 * `truncateMessage`/`getTypeLabel` are pure formatting logic (docs/testing.md
 * rule 5's "pure logic" carve-out). Render/interaction detail for the item
 * itself lives in this component's own conversation-tree-item.stories.tsx.
 */

import { describe, expect, it } from "vitest";

import { MessageType } from "./conversation-tree-model";
import { getTypeLabel, truncateMessage } from "./conversation-tree-item";

describe("truncateMessage", () => {
  it("returns an empty string for empty input", () => {
    expect(truncateMessage("")).toBe("");
  });

  it("returns a message at exactly the limit verbatim", () => {
    const message = "a".repeat(40);
    expect(truncateMessage(message)).toBe(message);
  });

  it("cuts a message past the limit and appends an ellipsis", () => {
    const message = "a".repeat(41);
    expect(truncateMessage(message)).toBe(`${"a".repeat(40)}...`);
  });

  it("honors a custom maxLength", () => {
    expect(truncateMessage("hello world", 5)).toBe("hello...");
  });
});

describe("getTypeLabel", () => {
  it("labels each known message type", () => {
    expect(getTypeLabel(MessageType.USER)).toBe("You");
    expect(getTypeLabel(MessageType.ASSISTANT)).toBe("Assistant");
    expect(getTypeLabel(MessageType.MERGE)).toBe("Merge");
    expect(getTypeLabel(MessageType.AGENT_WORKING)).toBe("Agent");
  });

  it("falls back to System for every other type", () => {
    expect(getTypeLabel(MessageType.TOOL_CALL)).toBe("System");
    expect(getTypeLabel(MessageType.TOOL_RESULT)).toBe("System");
    expect(getTypeLabel(MessageType.SYSTEM)).toBe("System");
    expect(getTypeLabel(MessageType.REASONING)).toBe("System");
  });
});
