// Message types
export const MessageType = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  SYSTEM: "system",
  REASONING: "reasoning",
  AGENT_WORKING: "agent_working",
  MERGE: "merge",
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

// Provider icons mapping
export const ProviderIcons = {
  openai: "🟢",
  anthropic: "🔶",
  google: "🔵",
  meta: "⚪",
  local: "🟣",
};

// Types
export interface ConversationNode {
  id: string;
  type: MessageTypeValue;
  content: string;
  branch: string;
  parentIds: Array<string>;
  children: Array<string>;
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
  toolCalls?: Array<{ name: string; args: unknown }>;
}

export const CORNER_RADIUS = 8;
export const STROKE = "rgb(156, 163, 175)";
export const STROKE_WIDTH = 2;
export const OPACITY = 0.8;

export const NODE_HEIGHT = 20;
export const NODE_WIDTH = 20;

// Helper functions
export const getBranchX = (
  branch: string,
  conversations: Array<ConversationNode>,
) => {
  const allBranches = [...new Set(conversations.map((c) => c.branch))];
  // Ensure 'main' branch is always first, then sort the rest
  const uniqueBranches = allBranches.sort((a, b) => {
    if (a === "main") return -1;
    if (b === "main") return 1;
    return a.localeCompare(b);
  });

  const branchIndex = uniqueBranches.indexOf(branch);
  const spacing = 20;
  const startX = 15;
  return branchIndex === -1 ? startX : startX + branchIndex * spacing;
};

export const getNodeY = (index: number) => {
  return index * 60 + 30;
};
