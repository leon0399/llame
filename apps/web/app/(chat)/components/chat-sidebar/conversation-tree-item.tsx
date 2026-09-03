"use client";

import type React from "react";
import { cn } from "@workspace/ui/lib/utils";

import { MessageType, type ConversationNode } from "./conversation-tree-model";

/** The item's preview text: `message` verbatim under `maxLength`, else cut
 *  with a trailing ellipsis. Exported for unit tests (docs/testing.md rule 5). */
export function truncateMessage(message: string, maxLength = 40) {
  if (!message) return "";
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength) + "...";
}

/** The item's type label, or "System" for any type the switch doesn't name.
 *  Exported for unit tests (docs/testing.md rule 5). */
export function getTypeLabel(type: ConversationNode["type"]) {
  switch (type) {
    case MessageType.USER:
      return "You";
    case MessageType.ASSISTANT:
      return `Assistant`;
    case MessageType.MERGE:
      return "Merge";
    case MessageType.AGENT_WORKING:
      return "Agent";
    default:
      return "System";
  }
}

function ConversationItemLabel({
  typeLabel,
  preview,
}: {
  typeLabel: string;
  preview: string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="text-xs text-muted-foreground min-w-0">
        <div className="font-medium text-sidebar-foreground">{typeLabel}</div>
        <div className="truncate text-sidebar-foreground">{preview}</div>
      </div>
    </div>
  );
}

type ConversationItemProps = {
  node: ConversationNode;
  index: number;
  isSelected: boolean;
  isVisible: boolean;
  onClick: () => void;
  onHover: (id: string | null) => void;
};

function conversationItemClassName({
  isSelected,
  isVisible,
  node,
}: Pick<ConversationItemProps, "isSelected" | "isVisible" | "node">) {
  return cn(
    "px-3 py-2 cursor-pointer transition-all border-l-2 flex items-center",
    isSelected
      ? "bg-sidebar-accent border-primary"
      : "hover:bg-sidebar-accent/50 border-transparent",
    !isVisible && "opacity-60",
    node.archived && "opacity-70",
  );
}

// Conversation item in sidebar
export const ConversationItem = ({
  node,
  isSelected,
  isVisible,
  onClick,
  onHover,
}: ConversationItemProps) => {
  const typeLabel = getTypeLabel(node.type);
  const preview = truncateMessage(node.content);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      // Not a native <button>: this is a positioned row in a graph/tree
      // layout (paired with the SVG branch-line overlay), not a standalone
      // action — role=button + keyboard handling below covers a11y without
      // risking a UA-styling regression on the fixed-height row.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="button"
      tabIndex={0}
      aria-label={`${typeLabel}: ${preview}`}
      className={conversationItemClassName({ isSelected, isVisible, node })}
      style={{ height: "60px" }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      <ConversationItemLabel typeLabel={typeLabel} preview={preview} />
    </div>
  );
};
