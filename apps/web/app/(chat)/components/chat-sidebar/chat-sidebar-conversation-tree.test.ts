// @vitest-environment jsdom

/**
 * `computeVisibleConversations` is pure ancestor/descendant tracing
 * (docs/testing.md rule 5's "pure logic" carve-out). `useConversationTreeData`
 * is a headless hook (sample-data seeding, selection, SVG sizing) — its
 * render output (`ChatSidebarConversationTree`) is covered separately by this
 * file's story.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationProvider } from "./conversation-tree-context";
import type { ConversationNode } from "./conversation-tree-model";
import {
  computeVisibleConversations,
  useConversationTreeData,
} from "./chat-sidebar-conversation-tree";

function node(
  overrides: Partial<ConversationNode> & Pick<ConversationNode, "id">,
): ConversationNode {
  return {
    type: "user",
    content: "",
    branch: "main",
    parentIds: [],
    children: [],
    timestamp: "",
    position: 0,
    ...overrides,
  };
}

describe("computeVisibleConversations", () => {
  // a -> b -> d
  //   \> c
  const a = node({ id: "a", children: ["b", "c"] });
  const b = node({ id: "b", parentIds: ["a"], children: ["d"] });
  const c = node({ id: "c", parentIds: ["a"] });
  const d = node({ id: "d", parentIds: ["b"] });
  const nodes = { a, b, c, d } satisfies Record<string, ConversationNode>;
  const conversations = [a, b, c, d];

  it("returns every conversation when nothing is selected", () => {
    expect(computeVisibleConversations(nodes, conversations, null)).toBe(
      conversations,
    );
  });

  it("returns every conversation when the selection is unknown", () => {
    expect(computeVisibleConversations(nodes, conversations, "ghost")).toBe(
      conversations,
    );
  });

  it("shows the selected node's ancestor chain, excluding an unrelated sibling", () => {
    const visible = computeVisibleConversations(nodes, conversations, "b");

    expect(visible.map((n) => n.id)).toEqual(["a", "b"]);
  });

  // KNOWN DEFECT, pinned rather than silently fixed (out of this test's
  // scope): `traceChildren(selectedNodeId)` is always a no-op, because
  // `traceParents(selectedNodeId)` runs first and already marks
  // `selectedNodeId` visited — so traceChildren's own
  // `visibleIds.has(nodeId)` guard fires immediately and its loop over
  // `children` never runs. A node's descendants are never traced, only its
  // ancestors. A correct implementation would include b, c, and d here.
  it("never shows the selected node's descendants — traceChildren(selectedNodeId) is dead code", () => {
    const visible = computeVisibleConversations(nodes, conversations, "a");

    expect(visible.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("useConversationTreeData", () => {
  it("seeds the sample graph, selects node-8, and sizes the SVG from it", () => {
    const { result } = renderHook(() => useConversationTreeData(), {
      wrapper: ConversationProvider,
    });

    expect(result.current.conversations).toHaveLength(9);
    expect(result.current.selectedNodeId).toBe("node-8");
    // main + branch-1 => 2 unique branches: width = 30 + 2*20, height = 9*60+40
    expect(result.current.svgDimensions).toEqual({ width: 70, height: 580 });
  });

  it("selects the branch-merge node, whose ancestor chain covers both branches — except its own child, node-9 (the traceChildren defect above)", () => {
    const { result } = renderHook(() => useConversationTreeData(), {
      wrapper: ConversationProvider,
    });

    expect(result.current.visibleConversations).toHaveLength(8);
    expect(
      result.current.visibleConversations.some((n) => n.id === "node-9"),
    ).toBe(false);
  });
});
