"use client";

import { useEffect } from "react";

import { buttonVariants } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { MainRailTrigger } from "@/app/shell/main-rail";
import { topBarClasses } from "@/app/shell/top-bar";
import { useTypewriter } from "@/components/use-typewriter";

import { useOpenChat } from "@/lib/services/chat/queries";

import { SessionDetailsTrigger } from "../session-details";
import { useOpenChatId } from "../session-details/details-state";

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
): { title: string } | null | undefined {
  const chat = useOpenChat(chatId);

  return !chatId
    ? null
    : chat === undefined
      ? undefined
      : { title: chat.title ?? UNTITLED_CHAT_LABEL };
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

  useDocumentTitleSync(settledTitle);

  // The /projects, /gallery, and /brain pages render their own header (title +
  // trigger); stacking this bar above it would double the chrome.
  if (
    pathname.startsWith("/projects") ||
    pathname.startsWith("/gallery") ||
    pathname.startsWith("/brain")
  ) {
    return null;
  }

  return (
    <header
      className={cn(topBarClasses, "bg-background gap-2 px-2", className)}
    >
      {/* Mobile-only: opens the sidebar sheet; the desktop rail has its own toggle. */}
      <MainRailTrigger />

      {chatId && resolvedChat ? (
        <ChatHeaderTitle key={chatId} title={resolvedChat.title} />
      ) : null}
      <span className="ml-auto flex items-center gap-1">
        {/* Mobile-only: a new chat without opening the rail's sheet. */}
        {pathname !== "/" && (
          <Link
            href="/"
            prefetch={false}
            aria-label="New chat"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "md:hidden",
            )}
          >
            <SquarePenIcon aria-hidden="true" />
          </Link>
        )}
        {chatId && resolvedChat ? <SessionDetailsTrigger /> : null}
      </span>
    </header>
  );
}
