"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@workspace/ui/components/sidebar";
import { ChevronDown, User, Bot, Settings, GitMerge } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

// Message types
const MessageType = {
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  SYSTEM: 'system',
  REASONING: 'reasoning',
  AGENT_WORKING: 'agent_working',
  MERGE: 'merge'
} as const;

type MessageTypeValue = typeof MessageType[keyof typeof MessageType];

// Provider icons mapping
const ProviderIcons = {
  openai: '🟢',
  anthropic: '🔶',
  google: '🔵',
  meta: '⚪',
  local: '🟣'
};

// Types
interface ConversationNode {
  id: string;
  type: MessageTypeValue;
  content: string;
  branch: string;
  parentIds: string[];
  children: string[];
  timestamp: string;
  position: number;
  archived?: boolean;
  metadata?: {
    provider?: string;
    toolName?: string;
    agentName?: string;
    status?: string;
    mergeStrategy?: string;
    confidence?: number;
  };
  toolCalls?: Array<{ name: string; args: any }>;
}

// Context for state management
const ConversationContext = React.createContext<{
  nodes: Record<string, ConversationNode>;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  addNode: (node: ConversationNode) => void;
} | null>(null);

const ConversationProvider = ({ children }: { children: React.ReactNode }) => {
  const [nodes, setNodes] = useState<Record<string, ConversationNode>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  
  const addNode = useCallback((node: ConversationNode) => {
    setNodes(prev => {
      const newNodes = { ...prev, [node.id]: node };
      
      // Rebuild all parent-child relationships from scratch
      Object.values(newNodes).forEach(n => {
        n.children = [];
      });
      
      Object.values(newNodes).forEach(n => {
        if (n.parentIds && n.parentIds.length > 0) {
          n.parentIds.forEach(parentId => {
            if (newNodes[parentId]) {
              if (!newNodes[parentId].children.includes(n.id)) {
                newNodes[parentId].children.push(n.id);
              }
            }
          });
        }
      });
      
      return newNodes;
    });
  }, []);
  
  const value = {
    nodes,
    selectedNodeId,
    setSelectedNodeId,
    addNode
  };
  
  return (
    <ConversationContext.Provider value={value}>
      {children}
    </ConversationContext.Provider>
  );
};

const useConversation = () => {
  const context = React.useContext(ConversationContext);
  if (!context) {
    throw new Error('useConversation must be used within ConversationProvider');
  }
  return context;
};

// Icon components
const UserIcon = () => <User className="w-4 h-4" />;

const AssistantIcon = ({ provider = 'openai' }: { provider?: string }) => (
  <span className="text-sm">{ProviderIcons[provider as keyof typeof ProviderIcons] || <Bot className="w-4 h-4" />}</span>
);

const ToolIcon = () => <Settings className="w-4 h-4" />;

const AgentIcon = () => <Bot className="w-4 h-4 animate-pulse" />;

const MergeIcon = () => <GitMerge className="w-4 h-4" />;

// Enhanced node component
const GraphNode = ({ 
  node, 
  index, 
  isSelected, 
  onClick, 
  conversations, 
  onMouseEnter, 
  onMouseLeave 
}: {
  node: ConversationNode;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  conversations: ConversationNode[];
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) => {
  const x = getBranchX(node.branch, conversations);
  const y = getNodeY(index);
  
  const handleMouseEnter = () => onMouseEnter && onMouseEnter();
  const handleMouseLeave = () => onMouseLeave && onMouseLeave();
  
  const renderNodeShape = () => {
    const baseProps = {
      onClick,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      className: "cursor-pointer transition-colors"
    };

    switch (node.type) {
      case MessageType.MERGE:
        return (
          <g>
            <path
              d={`M ${x} ${y + NODE_HEIGHT / 2} L ${x - NODE_WIDTH / 2} ${y - NODE_HEIGHT / 2} L ${x + NODE_WIDTH / 2} ${y - NODE_HEIGHT / 2} Z`}
              fill="hsl(var(--warning))"
              stroke={isSelected ? 'hsl(var(--ring))' : 'hsl(var(--border))'}
              strokeWidth="1.5"
              {...baseProps}
            />
            <foreignObject x={x - NODE_WIDTH / 2} y={y - NODE_HEIGHT / 2} width={NODE_WIDTH} height={NODE_HEIGHT}>
              <div className="flex items-center justify-center w-4 h-4 text-warning-foreground">
                <MergeIcon />
              </div>
            </foreignObject>
          </g>
        );
        
      case MessageType.AGENT_WORKING:
        return (
          <g>
            <rect
              x={x - NODE_WIDTH / 2}
              y={y - NODE_HEIGHT / 2}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              fill="hsl(var(--success))"
              stroke={isSelected ? 'hsl(var(--ring))' : 'hsl(var(--border))'}
              strokeWidth="1.5"
              rx="2"
              {...{
                ...baseProps,
                className: cn(baseProps.className, "cursor-pointer animate-pulse"),
              }}
            />
            <foreignObject x={x - NODE_WIDTH / 2} y={y - NODE_HEIGHT / 2} width={NODE_WIDTH} height={NODE_HEIGHT}>
              <div className="flex items-center justify-center w-4 h-4 text-success-foreground">
                <AgentIcon />
              </div>
            </foreignObject>
          </g>
        );
        
      case MessageType.TOOL_CALL:
      case MessageType.TOOL_RESULT:
        return (
          <g>
            <path
              d={`M ${x} ${y - NODE_HEIGHT / 2} L ${x + NODE_WIDTH / 2} ${y} L ${x} ${y + NODE_HEIGHT / 2} L ${x - NODE_WIDTH / 2} ${y} Z`}
              fill="hsl(var(--primary))"
              stroke={isSelected ? 'hsl(var(--ring))' : 'hsl(var(--border))'}
              strokeWidth="1.5"
              {...baseProps}
            />
            <foreignObject x={x - NODE_WIDTH / 2} y={y - NODE_HEIGHT / 2} width={NODE_WIDTH} height={NODE_HEIGHT}>
              <div className="flex items-center justify-center w-4 h-4 text-primary-foreground">
                <ToolIcon />
              </div>
            </foreignObject>
          </g>
        );
        
      default:
        return (
          <g>
            <circle
              cx={x}
              cy={y}
              r={NODE_WIDTH / 2}
              fill={node.type === MessageType.USER ? 'hsl(var(--primary))' : 'hsl(var(--secondary))'}
              stroke={isSelected ? 'hsl(var(--ring))' : 'hsl(var(--border))'}
              strokeWidth="1.5"
              {...baseProps}
            />
            <foreignObject x={x - NODE_WIDTH / 2} y={y - NODE_HEIGHT / 2} width={NODE_WIDTH} height={NODE_HEIGHT}>
              <div className={cn(
                "flex items-center justify-center w-4 h-4",
                node.type === MessageType.USER ? "text-primary-foreground" : "text-secondary-foreground"
              )}>
                {node.type === MessageType.USER ? 
                  <UserIcon /> : 
                  <AssistantIcon provider={node.metadata?.provider} />
                }
              </div>
            </foreignObject>
          </g>
        );
    }
  };
  
  return renderNodeShape();
};

// Branch graph component
const BranchGraph = ({ 
  conversations, 
  selectedNodeId, 
  setSelectedNodeId, 
  dimensions, 
  hoveredNodeId, 
  setHoveredNodeId 
}: {
  conversations: ConversationNode[];
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string) => void;
  dimensions: { width: number; height: number };
  hoveredNodeId: string | null;
  setHoveredNodeId: (id: string | null) => void;
}) => {
  const nodeIndexMap: Record<string, number> = {};
  conversations.forEach((conv, index) => {
    nodeIndexMap[conv.id] = index;
  });
  
  const renderBranchLines = () => {
    const lines: React.ReactElement[] = [];
    
    conversations.forEach((conv, childIndex) => {
      if (conv.parentIds) {
        conv.parentIds.forEach(parentId => {
          const parentIndex = nodeIndexMap[parentId];
          if (parentIndex === undefined) return;
          const parent = conversations[parentIndex];
          
          
          lines.push(
            <BranchLine
              key={`${parentId}-${conv.id}`}
              parent={parent}
              child={conv}
              parentIndex={parentIndex}
              childIndex={childIndex}
              conversations={conversations}
            />
          );
        });
      }
    });
    
    return lines;
  };
  
  return (
    <svg
      width={dimensions.width}
      height={dimensions.height}
      className="absolute left-0 top-0"
    >
      {renderBranchLines()}
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

// Conversation item in sidebar
const ConversationItem = ({ 
  node, 
  index, 
  isSelected, 
  isVisible, 
  onClick, 
  onHover 
}: {
  node: ConversationNode;
  index: number;
  isSelected: boolean;
  isVisible: boolean;
  onClick: () => void;
  onHover: (id: string | null) => void;
}) => {
  const truncateMessage = (message: string, maxLength = 40) => {
    if (!message) return '';
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  };
  
  const getTypeLabel = () => {
    switch (node.type) {
      case MessageType.USER:
        return 'You';
      case MessageType.ASSISTANT:
        return `Assistant`;
      case MessageType.MERGE:
        return 'Merge';
      case MessageType.AGENT_WORKING:
        return 'Agent';
      default:
        return 'System';
    }
  };
  
  return (
    <div
      className={cn(
        "px-3 py-2 cursor-pointer transition-all border-l-2 flex items-center",
        isSelected 
          ? "bg-sidebar-accent border-primary" 
          : "hover:bg-sidebar-accent/50 border-transparent",
        !isVisible && "opacity-30",
        node.archived && "opacity-50"
      )}
      style={{ height: '60px' }}
      onClick={onClick}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="text-xs text-muted-foreground min-w-0">
          <div className="font-medium text-sidebar-foreground">
            {getTypeLabel()}
          </div>
          <div className="text-muted-foreground truncate">
            {truncateMessage(node.content)}
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper functions
const getBranchX = (branch: string, conversations: ConversationNode[]) => {
  const allBranches = [...new Set(conversations.map(c => c.branch))];
  // Ensure 'main' branch is always first, then sort the rest
  const uniqueBranches = allBranches.sort((a, b) => {
    if (a === 'main') return -1;
    if (b === 'main') return 1;
    return a.localeCompare(b);
  });
  
  const branchIndex = uniqueBranches.indexOf(branch);
  const spacing = 20;
  const startX = 15;
  return branchIndex === -1 ? startX : startX + (branchIndex * spacing);
};

const getNodeY = (index: number) => {
  return index * 60 + 30;
};


export interface BranchLineProps {
  parent: ConversationNode;
  child: ConversationNode;
  parentIndex: number;
  childIndex: number;
  conversations: ConversationNode[];
}

const CORNER_RADIUS = 8;
const STROKE = "rgb(156, 163, 175)";
const STROKE_WIDTH = 2;
const OPACITY = 0.8;

const NODE_HEIGHT = 20;
const NODE_WIDTH = 20;

// Branch line component
export const BranchLine: React.FC<BranchLineProps> = ({
  parent,
  child,
  parentIndex,
  childIndex,
  conversations,
}) => {
  // Horizontal positions (x) of branches in the timeline
  const parentX = getBranchX(parent.branch, conversations);
  const childX  = getBranchX(child.branch,  conversations);

  // Vertical positions (y) of nodes in the timeline
  const parentY = getNodeY(parentIndex);
  const childY  = getNodeY(childIndex);

  // Edge offsets so the line meets the node just outside its rounded rectangle
  const startY = parentY; // bottom edge of parent node
  const endY   = childY; // top edge of child node

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Straight line for same branch and consecutive nodes
  // ────────────────────────────────────────────────────────────────────────────
  if (parent.branch === child.branch) {
    return (
      <line
        x1={parentX}
        y1={startY}
        x2={childX}
        y2={endY}
        stroke={STROKE}
        strokeWidth={STROKE_WIDTH}
        opacity={OPACITY}
      />
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Curved path when switching branches (split / merge)
  //    direction > 0  → split to the right  ⇒ horizontal segment at *parent* Y
  //    direction < 0  → merge from the left ⇒ horizontal segment at *child*  Y
  // ────────────────────────────────────────────────────────────────────────────
  const direction = childX > parentX ? 1 : -1; // +1 = right, -1 = left

  // Build the SVG path as an array of commands, then join with spaces.
  const d = (
    direction > 0
      ? [
          // Split rightwards
          "M", parentX, startY,                // ① move to bottom of parent
          "H", childX - CORNER_RADIUS,         // ② horizontal to near‑child x
          "Q", childX, startY, childX, startY + CORNER_RADIUS, // ③ quarter‑circle corner
          "V", endY,                           // ④ vertical down to top of child
        ]
      : [
          // Merge leftwards
          "M", parentX, startY,                // ① move to bottom of parent
          "V", endY - CORNER_RADIUS,           // ② vertical down near child y
          "Q", parentX, endY, parentX + direction * CORNER_RADIUS, endY, // ③ quarter‑circle corner
          "H", childX,                         // ④ horizontal to child x
        ]
  ).join(" ");

  return (
    <path
      d={d}
      stroke={STROKE}
      strokeWidth={STROKE_WIDTH}
      fill="none"
      opacity={OPACITY}
    />
  );
};


// Main conversation tree content
const ConversationTreeContent = () => {
  const { nodes, selectedNodeId, setSelectedNodeId, addNode } = useConversation();
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [svgDimensions, setSvgDimensions] = useState({ width: 120, height: 600 });
  
  // Initialize with sample data
  useEffect(() => {
    const sampleNodes: ConversationNode[] = [
      {
        id: 'node-1',
        type: MessageType.USER,
        content: 'Can you help me analyze this dataset?',
        branch: 'main',
        parentIds: [],
        children: [],
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        position: 0
      },
      {
        id: 'node-2',
        type: MessageType.ASSISTANT,
        content: 'I\'d be happy to help analyze your dataset. Let me search for the best approach.',
        branch: 'main',
        parentIds: ['node-1'],
        children: [],
        timestamp: new Date(Date.now() - 3500000).toISOString(),
        metadata: { provider: 'anthropic' },
        position: 1
      },
      {
        id: 'node-3',
        type: MessageType.ASSISTANT,
        content: 'Of course! First, let me understand what kind of analysis you\'re looking for.',
        branch: 'branch-1',
        parentIds: ['node-1'],
        children: [],
        timestamp: new Date(Date.now() - 3500000).toISOString(),
        metadata: { provider: 'openai' },
        position: 1.1
      },
      {
        id: 'node-4',
        type: MessageType.TOOL_CALL,
        content: 'Searching for data analysis best practices...',
        branch: 'main',
        parentIds: ['node-2'],
        children: [],
        timestamp: new Date(Date.now() - 3400000).toISOString(),
        toolCalls: [{ name: 'web_search', args: { query: 'pandas data analysis tutorial' } }],
        metadata: { toolName: 'web_search' },
        position: 2
      },
      {
        id: 'node-5',
        type: MessageType.REASONING,
        content: 'The user wants to analyze a dataset. I should ask about the type of data.',
        branch: 'branch-1',
        parentIds: ['node-3'],
        children: [],
        timestamp: new Date(Date.now() - 3400000).toISOString(),
        position: 2.1
      },
      {
        id: 'node-6',
        type: MessageType.TOOL_RESULT,
        content: 'Found comprehensive guides on exploratory data analysis.',
        branch: 'main',
        parentIds: ['node-4'],
        children: [],
        timestamp: new Date(Date.now() - 3300000).toISOString(),
        position: 3
      },
      {
        id: 'node-7',
        type: MessageType.AGENT_WORKING,
        content: 'Running data profiling agent...',
        branch: 'branch-1',
        parentIds: ['node-5'],
        children: [],
        timestamp: new Date(Date.now() - 3300000).toISOString(),
        metadata: { agentName: 'DataProfiler', status: 'running' },
        position: 3.1
      },
      {
        id: 'node-8',
        type: MessageType.MERGE,
        content: 'Combined insights from web search and data profiling',
        branch: 'main',
        parentIds: ['node-6', 'node-7'],
        children: [],
        timestamp: new Date(Date.now() - 3200000).toISOString(),
        metadata: { mergeStrategy: 'best-of-n', confidence: 0.92 },
        position: 4
      },
      {
        id: 'node-9',
        type: MessageType.ASSISTANT,
        content: 'Based on my research and analysis, here\'s a comprehensive approach...',
        branch: 'main',
        parentIds: ['node-8'],
        children: [],
        timestamp: new Date(Date.now() - 3100000).toISOString(),
        metadata: { provider: 'anthropic' },
        position: 5
      }
    ];
    
    sampleNodes.forEach(node => addNode(node));
    setSelectedNodeId('node-8');
  }, [addNode, setSelectedNodeId]);
  
  
  // Get conversations array from nodes
  const conversations = useMemo(() => 
    Object.values(nodes).sort((a, b) => a.position - b.position),
    [nodes]);
  
  // Update SVG dimensions
  useEffect(() => {
    const height = conversations.length * 60 + 40;
    const uniqueBranches = [...new Set(conversations.map(c => c.branch))].length;
    const width = 30 + (uniqueBranches * 20);
    setSvgDimensions({ width, height });
  }, [conversations]);
  
  // Get visible conversations based on selected node
  const visibleConversations = useMemo(() => {
    if (!selectedNodeId) return conversations;
    
    const selected = nodes[selectedNodeId];
    if (!selected) return conversations;
    
    const visibleIds = new Set<string>();
    
    const traceParents = (nodeId: string) => {
      if (!nodeId || visibleIds.has(nodeId)) return;
      visibleIds.add(nodeId);
      
      const node = nodes[nodeId];
      if (node && node.parentIds) {
        node.parentIds.forEach(parentId => traceParents(parentId));
      }
    };
    
    const traceChildren = (nodeId: string) => {
      if (!nodeId || visibleIds.has(nodeId)) return;
      visibleIds.add(nodeId);
      
      const node = nodes[nodeId];
      if (node && node.children) {
        node.children.forEach(childId => traceChildren(childId));
      }
    };
    
    traceParents(selectedNodeId);
    traceChildren(selectedNodeId);
    
    return conversations.filter(c => visibleIds.has(c.id));
  }, [conversations, selectedNodeId, nodes]);
  
  const visibleIds = new Set(visibleConversations.map(c => c.id));
  
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
          
          <div className="relative" style={{ marginLeft: `${svgDimensions.width}px` }}>
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
        </div>
      </div>
    </div>
  );
};

export function ChatSidebarConversationTree() {
  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            Conversation History
            <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
          </CollapsibleTrigger>
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
  )
}