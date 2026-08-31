"use client";

import React from "react";
import { User, Bot, Settings, GitMerge } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

import {
  CORNER_RADIUS,
  MessageType,
  type MessageTypeValue,
  NODE_HEIGHT,
  NODE_WIDTH,
  OPACITY,
  ProviderIcons,
  STROKE,
  STROKE_WIDTH,
  getBranchX,
  getNodeY,
  type ConversationNode,
} from "./conversation-tree-model";

// Icon components
const UserIcon = () => <User className="w-4 h-4" />;

const AssistantIcon = ({ provider = "openai" }: { provider?: string }) => (
  <span className="text-sm">
    {
      // SAFETY: an unrecognized `provider` string just misses the lookup and
      // falls through to the `<Bot />` default below — no unsound narrowing.
      ProviderIcons[provider as keyof typeof ProviderIcons] || (
        <Bot className="w-4 h-4" />
      )
    }
  </span>
);

const ToolIcon = () => <Settings className="w-4 h-4" />;

const AgentIcon = () => <Bot className="w-4 h-4 animate-pulse" />;

const MergeIcon = () => <GitMerge className="w-4 h-4" />;

type NodeBaseProps = {
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  className: string;
};

type NodeMarkerProps = {
  x: number;
  y: number;
  isSelected: boolean;
  baseProps: NodeBaseProps;
};

function nodeStroke(isSelected: boolean): string {
  return isSelected ? "hsl(var(--ring))" : "hsl(var(--border))";
}

function MergeNodeMarker({ x, y, isSelected, baseProps }: NodeMarkerProps) {
  return (
    <g>
      <path
        d={`M ${x} ${y + NODE_HEIGHT / 2} L ${x - NODE_WIDTH / 2} ${y - NODE_HEIGHT / 2} L ${x + NODE_WIDTH / 2} ${y - NODE_HEIGHT / 2} Z`}
        fill="hsl(var(--warning))"
        stroke={nodeStroke(isSelected)}
        strokeWidth="1.5"
        {...baseProps}
      />
      <foreignObject
        x={x - NODE_WIDTH / 2}
        y={y - NODE_HEIGHT / 2}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
      >
        <div className="flex items-center justify-center w-4 h-4 text-warning-foreground">
          <MergeIcon />
        </div>
      </foreignObject>
    </g>
  );
}

function AgentWorkingNodeMarker({
  x,
  y,
  isSelected,
  baseProps,
}: NodeMarkerProps) {
  return (
    <g>
      <rect
        x={x - NODE_WIDTH / 2}
        y={y - NODE_HEIGHT / 2}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        fill="hsl(var(--success))"
        stroke={nodeStroke(isSelected)}
        strokeWidth="1.5"
        rx="2"
        {...{
          ...baseProps,
          className: cn(baseProps.className, "cursor-pointer animate-pulse"),
        }}
      />
      <foreignObject
        x={x - NODE_WIDTH / 2}
        y={y - NODE_HEIGHT / 2}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
      >
        <div className="flex items-center justify-center w-4 h-4 text-success-foreground">
          <AgentIcon />
        </div>
      </foreignObject>
    </g>
  );
}

function ToolNodeMarker({ x, y, isSelected, baseProps }: NodeMarkerProps) {
  return (
    <g>
      <path
        d={`M ${x} ${y - NODE_HEIGHT / 2} L ${x + NODE_WIDTH / 2} ${y} L ${x} ${y + NODE_HEIGHT / 2} L ${x - NODE_WIDTH / 2} ${y} Z`}
        fill="hsl(var(--primary))"
        stroke={nodeStroke(isSelected)}
        strokeWidth="1.5"
        {...baseProps}
      />
      <foreignObject
        x={x - NODE_WIDTH / 2}
        y={y - NODE_HEIGHT / 2}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
      >
        <div className="flex items-center justify-center w-4 h-4 text-primary-foreground">
          <ToolIcon />
        </div>
      </foreignObject>
    </g>
  );
}

function DefaultNodeIcon({
  isUser,
  provider,
}: {
  isUser: boolean;
  provider: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center w-4 h-4",
        isUser ? "text-primary-foreground" : "text-secondary-foreground",
      )}
    >
      {isUser ? <UserIcon /> : <AssistantIcon provider={provider} />}
    </div>
  );
}

function DefaultNodeMarker({
  x,
  y,
  isSelected,
  baseProps,
  node,
}: NodeMarkerProps & { node: ConversationNode }) {
  const isUser = node.type === MessageType.USER;
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={NODE_WIDTH / 2}
        fill={isUser ? "hsl(var(--primary))" : "hsl(var(--secondary))"}
        stroke={nodeStroke(isSelected)}
        strokeWidth="1.5"
        {...baseProps}
      />
      <foreignObject
        x={x - NODE_WIDTH / 2}
        y={y - NODE_HEIGHT / 2}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
      >
        <DefaultNodeIcon isUser={isUser} provider={node.metadata?.provider} />
      </foreignObject>
    </g>
  );
}

export interface GraphNodeProps {
  node: ConversationNode;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  conversations: Array<ConversationNode>;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * The marker a node type renders. Types absent here fall through to
 * DefaultNodeMarker, which is the only one that also needs the node itself.
 */
const NODE_MARKERS = new Map<
  MessageTypeValue,
  (props: NodeMarkerProps) => React.ReactNode
>([
  [MessageType.MERGE, MergeNodeMarker],
  [MessageType.AGENT_WORKING, AgentWorkingNodeMarker],
  [MessageType.TOOL_CALL, ToolNodeMarker],
  [MessageType.TOOL_RESULT, ToolNodeMarker],
]);

// Enhanced node component
export const GraphNode = ({
  node,
  index,
  isSelected,
  onClick,
  conversations,
  onMouseEnter,
  onMouseLeave,
}: GraphNodeProps) => {
  const markerProps: NodeMarkerProps = {
    x: getBranchX(node.branch, conversations),
    y: getNodeY(index),
    isSelected,
    baseProps: {
      onClick,
      onMouseEnter: () => onMouseEnter?.(),
      onMouseLeave: () => onMouseLeave?.(),
      className: "cursor-pointer transition-colors",
    },
  };

  const Marker = NODE_MARKERS.get(node.type);
  if (Marker) {
    return <Marker {...markerProps} />;
  }
  return <DefaultNodeMarker {...markerProps} node={node} />;
};

export interface BranchLineProps {
  parent: ConversationNode;
  child: ConversationNode;
  parentIndex: number;
  childIndex: number;
  conversations: Array<ConversationNode>;
}

// direction > 0  → split to the right  ⇒ horizontal segment at *parent* Y
// direction < 0  → merge from the left ⇒ horizontal segment at *child*  Y
// Builds the SVG path as an array of commands, then joins with spaces.
function buildBranchSwitchPath(
  parentX: number,
  startY: number,
  childX: number,
  endY: number,
): string {
  const direction = childX > parentX ? 1 : -1; // +1 = right, -1 = left

  return (
    direction > 0
      ? [
          // Split rightwards
          "M",
          parentX,
          startY, // ① move to bottom of parent
          "H",
          childX - CORNER_RADIUS, // ② horizontal to near‑child x
          "Q",
          childX,
          startY,
          childX,
          startY + CORNER_RADIUS, // ③ quarter‑circle corner
          "V",
          endY, // ④ vertical down to top of child
        ]
      : [
          // Merge leftwards
          "M",
          parentX,
          startY, // ① move to bottom of parent
          "V",
          endY - CORNER_RADIUS, // ② vertical down near child y
          "Q",
          parentX,
          endY,
          parentX + direction * CORNER_RADIUS,
          endY, // ③ quarter‑circle corner
          "H",
          childX, // ④ horizontal to child x
        ]
  ).join(" ");
}

// Branch line component: a straight line for a same-branch edge, otherwise a
// rounded split/merge path (see buildBranchSwitchPath).
export const BranchLine: React.FC<BranchLineProps> = ({
  parent,
  child,
  parentIndex,
  childIndex,
  conversations,
}) => {
  const parentX = getBranchX(parent.branch, conversations);
  const childX = getBranchX(child.branch, conversations);
  const parentY = getNodeY(parentIndex);
  const childY = getNodeY(childIndex);

  if (parent.branch === child.branch) {
    return (
      <line
        x1={parentX}
        y1={parentY}
        x2={childX}
        y2={childY}
        stroke={STROKE}
        strokeWidth={STROKE_WIDTH}
        opacity={OPACITY}
      />
    );
  }

  return (
    <path
      d={buildBranchSwitchPath(parentX, parentY, childX, childY)}
      stroke={STROKE}
      strokeWidth={STROKE_WIDTH}
      fill="none"
      opacity={OPACITY}
    />
  );
};

function BranchLines({
  conversations,
}: {
  conversations: Array<ConversationNode>;
}) {
  const nodeIndexMap: Record<string, number> = {};
  conversations.forEach((conv, index) => {
    nodeIndexMap[conv.id] = index;
  });

  return (
    <>
      {conversations.map((conv, childIndex) =>
        (conv.parentIds ?? []).map((parentId) => {
          const parentIndex = nodeIndexMap[parentId];
          if (parentIndex === undefined) return null;
          return (
            <BranchLine
              key={`${parentId}-${conv.id}`}
              parent={conversations[parentIndex]}
              child={conv}
              parentIndex={parentIndex}
              childIndex={childIndex}
              conversations={conversations}
            />
          );
        }),
      )}
    </>
  );
}

// Branch graph component
export const BranchGraph = ({
  conversations,
  selectedNodeId,
  setSelectedNodeId,
  dimensions,
  setHoveredNodeId,
}: {
  conversations: Array<ConversationNode>;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string) => void;
  dimensions: { width: number; height: number };
  hoveredNodeId: string | null;
  setHoveredNodeId: (id: string | null) => void;
}) => {
  return (
    <svg
      width={dimensions.width}
      height={dimensions.height}
      className="absolute left-0 top-0"
    >
      <BranchLines conversations={conversations} />
      {conversations.map((conv, index) => (
        <GraphNode
          key={conv.id}
          node={conv}
          index={index}
          isSelected={selectedNodeId === conv.id}
          onClick={() => setSelectedNodeId(conv.id)}
          conversations={conversations}
          onMouseEnter={() => setHoveredNodeId(conv.id)}
          onMouseLeave={() => setHoveredNodeId(null)}
        />
      ))}
    </svg>
  );
};
