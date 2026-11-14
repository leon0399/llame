import type { ReactNode } from "react";

import { BashTool } from "@workspace/ui/components/custom/bash";
import { ConversationReadTool } from "@workspace/ui/components/custom/conversation-read";
import { EditTool } from "@workspace/ui/components/custom/edit";
import { GrepTool } from "@workspace/ui/components/custom/grep";
import { KnowledgeSearchTool } from "@workspace/ui/components/custom/knowledge-search";
import { McpTool } from "@workspace/ui/components/custom/mcp-tool";
import { ReadTool } from "@workspace/ui/components/custom/read";
import { SearchConversationsTool } from "@workspace/ui/components/custom/search-conversations";
import { StopTool } from "@workspace/ui/components/custom/stop";
import type { ToolPartProps } from "@workspace/ui/components/custom/tool-row";
import { WaitTool } from "@workspace/ui/components/custom/wait";
import { WebSearchTool } from "@workspace/ui/components/custom/web-search";
import { WorkspaceTool } from "@workspace/ui/components/custom/workspace";
import { WriteTool } from "@workspace/ui/components/custom/write";

import type { ChatMarkdownRenderers } from "./use-chat-markdown-ready";

import { storedImageSources } from "@/lib/services/media/urls";

function markdownToolRow(
  toolName: string,
  props: ToolPartProps,
  renderers: ChatMarkdownRenderers,
): ReactNode | null {
  switch (toolName) {
    case "read":
      return (
        <ReadTool
          {...props}
          Markdown={renderers.MessageResponse}
          mediaSources={storedImageSources}
        />
      );
    case "web_search":
      return <WebSearchTool {...props} Markdown={renderers.MessageResponse} />;
    default:
      return null;
  }
}

/** Dedicated renderer for supported tools; unknown calls keep the generic row. */
export function dedicatedToolRow({
  toolName,
  props,
  renderers,
}: {
  toolName: string;
  props: ToolPartProps;
  renderers: ChatMarkdownRenderers;
}): ReactNode {
  const markdownRow = markdownToolRow(toolName, props, renderers);

  if (markdownRow !== null) return markdownRow;

  switch (toolName) {
    case "bash":
      return <BashTool {...props} />;
    case "wait":
      return <WaitTool {...props} />;
    case "stop":
      return <StopTool {...props} />;
    case "edit":
      return <EditTool {...props} />;
    case "write":
      return <WriteTool {...props} />;
    case "grep":
      return <GrepTool {...props} />;
    case "search_conversations":
      return <SearchConversationsTool {...props} />;
    case "conversation_read":
      return <ConversationReadTool {...props} />;
    case "knowledge_search":
      return <KnowledgeSearchTool {...props} />;
    case "enter_workspace":
    case "exit_workspace":
      return <WorkspaceTool {...props} name={toolName} />;
    default:
      return toolName.startsWith("mcp__") ? (
        <McpTool {...props} name={toolName} />
      ) : null;
  }
}
