"use client";

import { useEffect, useMemo } from "react";

import { SidebarTrigger } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { usePathname } from "next/navigation";

import { topBarClasses } from "@/app/shell/top-bar";
import { useTypewriter } from "@/components/use-typewriter";
import { useChatQuery, useChatsQuery } from "@/lib/services/chat/queries";

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

/** Resolves the active chat's title from the sidebar list caches, falling
 *  back to a direct fetch for archived-unpinned chats those caches drop. */
function useResolvedChatTitle(): string | null | undefined {
  const pathname = usePathname();
  const chatId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2]
    : undefined;

  // Prefer the sidebar list caches when the active chat is in them — rename /
  // title-generation invalidate lists(), so the header stays in lockstep.
  const { data: pinnedData } = useChatsQuery({
    pinned: "only",
    archived: "with",
  });
  const { data: allData } = useChatsQuery({ pinned: "exclude" });

  const chatFromList = useMemo(() => {
    if (!chatId) return undefined;
    const chats = [
      ...(pinnedData?.pages.flat() ?? []),
      ...(allData?.pages.flat() ?? []),
    ];
    return chats.find((candidate) => candidate.id === chatId);
  }, [allData, chatId, pinnedData]);

  // Archived unpinned chats drop out of both list queries above; cold deep
  // links may not be in a loaded page. GET /chats/:id covers both — only
  // when the list has no row, so a healthy list path pays no extra request.
  const { data: chatFromFetch } = useChatQuery(
    chatId ?? "",
    chatId !== undefined && chatFromList === undefined,
  );

  const chat = chatFromList ?? chatFromFetch;

  return !chatId
    ? null
    : chat === undefined
      ? undefined
      : (chat.title ?? UNTITLED_CHAT_LABEL);
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

export function ChatHeader({ className }: ChatHeaderProps) {
  const pathname = usePathname();
  const settledTitle = useResolvedChatTitle();

  const target = isResolvedTitle(settledTitle) ? settledTitle : "";
  const display = useTypewriter(target, {
    enabled: isResolvedTitle(settledTitle),
  });

  useDocumentTitleSync(settledTitle);

  // The /projects pages render their own header (project title + trigger);
  // stacking this bar above it would double the chrome.
  if (pathname.startsWith("/projects")) {
    return null;
  }

  return (
    <header
      className={cn(topBarClasses, "bg-background gap-2 px-2", className)}
    >
      {/* Mobile-only: opens the sidebar sheet; the desktop rail has its own toggle. */}
      <SidebarTrigger className="md:hidden" />

      {isResolvedTitle(settledTitle) ? (
        <span className="max-w-[60ch] truncate pl-1 text-sm font-semibold">
          {display}
        </span>
      ) : null}
    </header>
  );
}
