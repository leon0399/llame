"use client";

import { useEffect } from "react";

import { SidebarTrigger, useSidebar } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { usePathname } from "next/navigation";

import { topBarClasses } from "@/app/shell/top-bar";
import { useTypewriter } from "@/components/use-typewriter";
import { WorkspaceIndicator } from "@/components/workspace-indicator";

import { useOpenChat } from "@/lib/services/chat/queries";

import { ChatContextPanelTrigger, useOpenChatId } from "../chat-context-panel";
import { useChatContextPanel } from "../chat-context-panel/panel-state";

export interface ChatHeaderProps {
  className?: string;
}

// Same placeholder the chat-list / pins rows use for title === null (#78).
const UNTITLED_CHAT_LABEL = "New chat";

/** Tab title when no chat is open — root layout has no metadata title. */
const DEFAULT_DOCUMENT_TITLE = "llame";

/** null = not on a chat route; undefined = on a chat but title not resolved
 *  yet (do not fake "New chat"); string = known display title. */
function isResolvedTitle(title: string | null | undefined): title is string {
  return typeof title === "string";
}

/** Resolves the active chat from the list caches, falling back to a direct
 * fetch for chats those caches drop (see `useOpenChat`). */
function useResolvedChat(
  chatId: string | undefined,
): { title: string; workspaceRoot: string | null } | null | undefined {
  const chat = useOpenChat(chatId);

  return !chatId
    ? null
    : chat === undefined
      ? undefined
      : {
          title: chat.title ?? UNTITLED_CHAT_LABEL,
          workspaceRoot: chat.workspaceRoot,
        };
}

/** Keeps the tab title in sync with the resolved chat title, and restores the
 *  default when this header unmounts (e.g. navigating to /admin). */
function useDocumentTitleSync(settledTitle: string | null | undefined): void {
  useEffect(() => {
    if (settledTitle === null) {
      document.title = DEFAULT_DOCUMENT_TITLE;
    } else if (isResolvedTitle(settledTitle)) {
      document.title = settledTitle;
    }
  }, [settledTitle]);

  useEffect(() => {
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, []);
}

/**
 * Typewriter is remounted per chat (`key={chatId}` on the caller) so opening
 * a chat, reloading, or switching chats snaps the title. Animation only runs
 * when the same chat's title changes (generation / rename).
 */
function ChatHeaderTitle({ title }: { title: string }) {
  const display = useTypewriter(title);
  return (
    <span className="max-w-md truncate pl-1 text-sm font-semibold">
      {display}
    </span>
  );
}

export function ChatHeader({ className }: ChatHeaderProps) {
  const pathname = usePathname();
  const chatId = useOpenChatId();
  const resolvedChat = useResolvedChat(chatId);
  const settledTitle = resolvedChat === null ? null : resolvedChat?.title;
  const { isMobile } = useSidebar();
  const panel = useChatContextPanel();

  useDocumentTitleSync(settledTitle);

  // The /projects and /gallery pages render their own header (title +
  // trigger); stacking this bar above it would double the chrome.
  if (pathname.startsWith("/projects") || pathname.startsWith("/gallery")) {
    return null;
  }

  return (
    <header
      className={cn(topBarClasses, "bg-background gap-2 px-2", className)}
    >
      {/* Mobile-only: opens the sidebar sheet; the desktop rail has its own toggle. */}
      <SidebarTrigger className="md:hidden" />

      {chatId && resolvedChat ? (
        <>
          <ChatHeaderTitle key={chatId} title={resolvedChat.title} />
          <WorkspaceIndicator
            workspaceRoot={resolvedChat.workspaceRoot}
            expanded={isMobile ? panel.openMobile : panel.open}
            onActivate={() => panel.toggle(isMobile)}
          />
          <span className="ml-auto">
            <ChatContextPanelTrigger />
          </span>
        </>
      ) : null}
    </header>
  );
}
