"use client";

import React, { useCallback, useState } from "react";

import type { ConversationNode } from "./conversation-tree-model";

// Context for state management
const ConversationContext = React.createContext<{
  nodes: Record<string, ConversationNode>;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  addNode: (node: ConversationNode) => void;
} | null>(null);

/**
 * Adds `node` to `nodes` and rebuilds every parent -> child edge from
 * `parentIds` from scratch (not incrementally), so `children` never drifts
 * out of sync with the declared parents. Pure so it is unit-testable without
 * the provider (docs/testing.md rule 5).
 */
export function addNodeToTree(
  nodes: Record<string, ConversationNode>,
  node: ConversationNode,
) {
  const newNodes = { ...nodes, [node.id]: node };

  // Rebuild all parent-child relationships from scratch
  for (const n of Object.values(newNodes)) {
    n.children = [];
  }

  for (const n of Object.values(newNodes)) {
    for (const parentId of n.parentIds ?? []) {
      const parent = newNodes[parentId];
      if (parent && !parent.children.includes(n.id)) {
        parent.children.push(n.id);
      }
    }
  }

  return newNodes;
}

export const ConversationProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [nodes, setNodes] = useState<Record<string, ConversationNode>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const addNode = useCallback((node: ConversationNode) => {
    setNodes((prev) => addNodeToTree(prev, node));
  }, []);

  const value = {
    nodes,
    selectedNodeId,
    setSelectedNodeId,
    addNode,
  };

  return (
    <ConversationContext.Provider value={value}>
      {children}
    </ConversationContext.Provider>
  );
};

export const useConversation = () => {
  const context = React.useContext(ConversationContext);
  if (!context) {
    throw new Error("useConversation must be used within ConversationProvider");
  }
  return context;
};
