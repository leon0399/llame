"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";

import { useNewChatRequests } from "@/lib/new-chat";
import { safeRandomUUID } from "@/lib/uuid";

import { ChatPage } from "./chat-page";

/**
 * The new-chat page's draft. Its id is minted in the browser and stays out of
 * the URL until the first send makes the chat addressable. That send moves
 * the address bar to `/chat/:id` without a navigation, so this page stays
 * mounted under it; when the address returns to `/` (New chat, Back), the
 * sent chat is left behind and a new draft starts. New chat while already on
 * `/` starts one too, discarding the unsent text and choices (`requestNewChat`).
 *
 * History can land this page on another chat's address (Back or Forward to an
 * entry a home send rewrote). That address is routed again so the chat's own
 * page renders, instead of this draft under another chat's URL.
 */
export function NewChatHome() {
  const pathname = usePathname();
  const router = useRouter();
  const requests = useNewChatRequests();

  const [draft, setDraft] = useState(() => ({
    chatId: safeRandomUUID(),
    pathname,
    requests,
  }));

  // TODO(#1997): keep the New chat draft instead of discarding it here.
  if (pathname !== draft.pathname || requests !== draft.requests) {
    setDraft(
      pathname === "/"
        ? { chatId: safeRandomUUID(), pathname, requests }
        : { ...draft, pathname, requests },
    );
  }

  const foreign = pathname !== "/" && pathname !== `/chat/${draft.chatId}`;

  useEffect(() => {
    if (!foreign) return;
    const { pathname: path, search, hash } = window.location;
    // SAFETY: the address the browser is already on, so it is a route.
    router.replace(`${path}${search}${hash}` as Route);
  }, [foreign, router]);

  if (foreign) return null;

  return (
    <ChatPage
      key={draft.chatId}
      chatId={draft.chatId}
      initialChatExists={false}
      initialDraftPhase={null}
    />
  );
}
