// @vitest-environment jsdom

/**
 * `addNodeToTree` is pure tree-rebuild logic (docs/testing.md rule 5's "pure
 * logic" carve-out). `useConversation`'s outside-provider guard and the
 * provider's addNode/selection wiring are headless hook behavior — no render
 * output, so no story applies to this module.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ConversationNode } from "./conversation-tree-model";
import {
  addNodeToTree,
  ConversationProvider,
  useConversation,
} from "./conversation-tree-context";

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

describe("addNodeToTree", () => {
  it("adds the node and wires it as a child of each declared parent", () => {
    const result = addNodeToTree(
      { p: node({ id: "p" }) },
      node({ id: "c", parentIds: ["p"] }),
    );

    expect(result.p?.children).toEqual(["c"]);
    expect(result.c).toBeDefined();
  });

  it("rebuilds children from scratch, dropping edges to parents no longer declared", () => {
    const nodes = {
      p: node({ id: "p", children: ["stale"] }),
      stale: node({ id: "stale" }),
    };

    const result = addNodeToTree(nodes, node({ id: "c", parentIds: ["p"] }));

    expect(result.p?.children).toEqual(["c"]);
    expect(result.stale?.children).toEqual([]);
  });

  it("never lists a child twice under the same parent", () => {
    const result = addNodeToTree(
      { p: node({ id: "p" }) },
      node({ id: "c", parentIds: ["p", "p"] }),
    );

    expect(result.p?.children).toEqual(["c"]);
  });

  it("ignores a parentId with no matching node", () => {
    const result = addNodeToTree({}, node({ id: "c", parentIds: ["ghost"] }));

    expect(result.c?.children).toEqual([]);
    expect(result.ghost).toBeUndefined();
  });
});

describe("useConversation", () => {
  it("throws when used outside a ConversationProvider", () => {
    expect(() => renderHook(() => useConversation())).toThrow(
      "useConversation must be used within ConversationProvider",
    );
  });

  it("exposes addNode/setSelectedNodeId wired through the provider", () => {
    const { result } = renderHook(() => useConversation(), {
      wrapper: ConversationProvider,
    });

    expect(result.current.nodes).toEqual({});
    expect(result.current.selectedNodeId).toBeNull();

    act(() => {
      result.current.addNode(node({ id: "n1" }));
    });
    expect(result.current.nodes.n1).toBeDefined();

    act(() => {
      result.current.setSelectedNodeId("n1");
    });
    expect(result.current.selectedNodeId).toBe("n1");
  });
});
