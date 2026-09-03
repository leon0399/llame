import { describe, expect, it } from "vitest";

import {
  getBranchX,
  getNodeY,
  type ConversationNode,
} from "./conversation-tree-model";

function node(branch: string): ConversationNode {
  return {
    id: branch,
    type: "user",
    content: "",
    branch,
    parentIds: [],
    children: [],
    timestamp: "",
    position: 0,
  };
}

describe("getBranchX", () => {
  it("always places the main branch first regardless of input order", () => {
    const conversations = [node("zeta"), node("main"), node("alpha")];
    expect(getBranchX("main", conversations)).toBe(15);
  });

  it("sorts non-main branches alphabetically after main", () => {
    const conversations = [node("zeta"), node("main"), node("alpha")];
    // main=0, alpha=1, zeta=2 -> startX(15) + index * spacing(20)
    expect(getBranchX("alpha", conversations)).toBe(35);
    expect(getBranchX("zeta", conversations)).toBe(55);
  });

  it("falls back to the start position for a branch absent from the conversation list", () => {
    expect(getBranchX("ghost", [node("main")])).toBe(15);
  });
});

describe("getNodeY", () => {
  it("spaces nodes 60px apart with a 30px top offset", () => {
    expect(getNodeY(0)).toBe(30);
    expect(getNodeY(1)).toBe(90);
    expect(getNodeY(3)).toBe(210);
  });
});
