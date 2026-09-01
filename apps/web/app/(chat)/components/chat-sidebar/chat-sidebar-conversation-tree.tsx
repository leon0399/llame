"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@workspace/ui/components/sidebar";
import { ChevronDown } from "lucide-react";

import { MessageType, type ConversationNode } from "./conversation-tree-model";
import {
  ConversationProvider,
  useConversation,
} from "./conversation-tree-context";
import { BranchGraph } from "./conversation-tree-graph";
import { ConversationItem } from "./conversation-tree-item";

// Sample seed data for the tree (no live conversation source is wired up yet).
const SAMPLE_CONVERSATION_NODES: Array<ConversationNode> = [
  {
    id: "node-1",
    type: MessageType.USER,
    content: "Can you help me analyze this dataset?",
    branch: "main",
    parentIds: [],
    children: [],
    timestamp: new Date(Date.now() - 3_600_000).toISOString(),
    position: 0,
  },
  {
    id: "node-2",
    type: MessageType.ASSISTANT,
    content:
      "I'd be happy to help analyze your dataset. Let me search for the best approach.",
    branch: "main",
    parentIds: ["node-1"],
    children: [],
    timestamp: new Date(Date.now() - 3_500_000).toISOString(),
    metadata: { provider: "anthropic" },
    position: 1,
  },
  {
    id: "node-3",
    type: MessageType.ASSISTANT,
    content:
      "Of course! First, let me understand what kind of analysis you're looking for.",
    branch: "branch-1",
    parentIds: ["node-1"],
    children: [],
    timestamp: new Date(Date.now() - 3_500_000).toISOString(),
    metadata: { provider: "openai" },
    position: 1.1,
  },
  {
    id: "node-4",
    type: MessageType.TOOL_CALL,
    content: "Searching for data analysis best practices...",
    branch: "main",
    parentIds: ["node-2"],
    children: [],
    timestamp: new Date(Date.now() - 3_400_000).toISOString(),
    toolCalls: [
      {
        name: "web_search",
        args: { query: "pandas data analysis tutorial" },
      },
    ],
    metadata: { toolName: "web_search" },
    position: 2,
  },
  {
    id: "node-5",
    type: MessageType.REASONING,
    content:
      "The user wants to analyze a dataset. I should ask about the type of data.",
    branch: "branch-1",
    parentIds: ["node-3"],
    children: [],
    timestamp: new Date(Date.now() - 3_400_000).toISOString(),
    position: 2.1,
  },
  {
    id: "node-6",
    type: MessageType.TOOL_RESULT,
    content: "Found comprehensive guides on exploratory data analysis.",
    branch: "main",
    parentIds: ["node-4"],
    children: [],
    timestamp: new Date(Date.now() - 3_300_000).toISOString(),
    position: 3,
  },
  {
    id: "node-7",
    type: MessageType.AGENT_WORKING,
    content: "Running data profiling agent...",
    branch: "branch-1",
    parentIds: ["node-5"],
    children: [],
    timestamp: new Date(Date.now() - 3_300_000).toISOString(),
    metadata: { agentName: "DataProfiler", status: "running" },
    position: 3.1,
  },
  {
    id: "node-8",
    type: MessageType.MERGE,
    content: "Combined insights from web search and data profiling",
    branch: "main",
    parentIds: ["node-6", "node-7"],
    children: [],
    timestamp: new Date(Date.now() - 3_200_000).toISOString(),
    metadata: { mergeStrategy: "best-of-n", confidence: 0.92 },
    position: 4,
  },
  {
    id: "node-9",
    type: MessageType.ASSISTANT,
    content:
      "Based on my research and analysis, here's a comprehensive approach...",
    branch: "main",
    parentIds: ["node-8"],
    children: [],
    timestamp: new Date(Date.now() - 3_100_000).toISOString(),
    metadata: { provider: "anthropic" },
    position: 5,
  },
];

/**
 * The nodes visible when `selectedNodeId` is set: its ancestor chain plus its
 * descendant subtree (both traced through `nodes`, not the flat `conversations`
 * list). No selection means everything is visible. Pure so it is
 * unit-testable without the provider (docs/testing.md rule 5).
 */
export function computeVisibleConversations(
  nodes: Record<string, ConversationNode>,
  conversations: Array<ConversationNode>,
  selectedNodeId: string | null,
): Array<ConversationNode> {
  if (!selectedNodeId || !nodes[selectedNodeId]) return conversations;

  const visibleIds = new Set<string>();

  const traceParents = (nodeId: string) => {
    if (!nodeId || visibleIds.has(nodeId)) return;
    visibleIds.add(nodeId);
    for (const parentId of nodes[nodeId]?.parentIds ?? []) {
      traceParents(parentId);
    }
  };

  const traceChildren = (nodeId: string) => {
    if (!nodeId || visibleIds.has(nodeId)) return;
    visibleIds.add(nodeId);
    for (const childId of nodes[nodeId]?.children ?? []) {
      traceChildren(childId);
    }
  };

  traceParents(selectedNodeId);
  traceChildren(selectedNodeId);

  return conversations.filter((c) => visibleIds.has(c.id));
}

/**
 * Seeds the sample tree, tracks selection/hover/SVG sizing, and derives the
 * visible subset — the state driving `ChatSidebarConversationTree`'s render.
 * Exported for a headless renderHook test (docs/testing.md rule 5); the
 * rendered markup itself is covered by this file's story.
 */
export function useConversationTreeData() {
  const { nodes, selectedNodeId, setSelectedNodeId, addNode } =
    useConversation();
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [svgDimensions, setSvgDimensions] = useState({
    width: 120,
    height: 600,
  });

  // Initialize with sample data
  useEffect(() => {
    SAMPLE_CONVERSATION_NODES.forEach((node) => addNode(node));
    setSelectedNodeId("node-8");
  }, [addNode, setSelectedNodeId]);

  const conversations = useMemo(
    () => Object.values(nodes).sort((a, b) => a.position - b.position),
    [nodes],
  );

  // Update SVG dimensions
  useEffect(() => {
    const height = conversations.length * 60 + 40;
    const uniqueBranches = new Set(conversations.map((c) => c.branch)).size;
    setSvgDimensions({ width: 30 + uniqueBranches * 20, height });
  }, [conversations]);

  const visibleConversations = useMemo(
    () => computeVisibleConversations(nodes, conversations, selectedNodeId),
    [conversations, selectedNodeId, nodes],
  );

  return {
    conversations,
    visibleConversations,
    selectedNodeId,
    setSelectedNodeId,
    hoveredNodeId,
    setHoveredNodeId,
    svgDimensions,
  };
}

function ConversationItemList({
  conversations,
  visibleIds,
  selectedNodeId,
  setSelectedNodeId,
  setHoveredNodeId,
  leftOffset,
}: {
  conversations: Array<ConversationNode>;
  visibleIds: Set<string>;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string) => void;
  setHoveredNodeId: (id: string | null) => void;
  leftOffset: number;
}) {
  return (
    <div className="relative" style={{ marginLeft: `${leftOffset}px` }}>
      {conversations.map((conv, index) => (
        <ConversationItem
          key={conv.id}
          node={conv}
          index={index}
          isSelected={selectedNodeId === conv.id}
          isVisible={visibleIds.has(conv.id)}
          onClick={() => setSelectedNodeId(conv.id)}
          onHover={setHoveredNodeId}
        />
      ))}
    </div>
  );
}

// Main conversation tree content
const ConversationTreeContent = () => {
  const {
    conversations,
    visibleConversations,
    selectedNodeId,
    setSelectedNodeId,
    hoveredNodeId,
    setHoveredNodeId,
    svgDimensions,
  } = useConversationTreeData();
  const visibleIds = new Set(visibleConversations.map((c) => c.id));

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="relative">
          <BranchGraph
            conversations={conversations}
            selectedNodeId={selectedNodeId}
            setSelectedNodeId={setSelectedNodeId}
            dimensions={svgDimensions}
            hoveredNodeId={hoveredNodeId}
            setHoveredNodeId={setHoveredNodeId}
          />
          <ConversationItemList
            conversations={conversations}
            visibleIds={visibleIds}
            selectedNodeId={selectedNodeId}
            setSelectedNodeId={setSelectedNodeId}
            setHoveredNodeId={setHoveredNodeId}
            leftOffset={svgDimensions.width}
          />
        </div>
      </div>
    </div>
  );
};

export function ChatSidebarConversationTree() {
  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel render={<CollapsibleTrigger />}>
          Conversation History
          <ChevronDown className="ml-auto transition-transform group-data-[open]/collapsible:rotate-180" />
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <ConversationProvider>
              <ConversationTreeContent />
            </ConversationProvider>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
