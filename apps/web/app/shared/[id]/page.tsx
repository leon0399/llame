"use client";

import { use } from "react";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";

import { Message, MessageContent } from "@/components/components/ai/message";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";

import { useMeOptional } from "@/lib/services/auth/queries";
import {
  CHAT_HISTORY_PAGE_SIZE,
  paginateAllMessages,
} from "@/lib/services/chat/paginate-messages";
import {
  fetchSharedChat,
  useForkSharedChat,
  type SharedChatMessage,
} from "@/lib/services/chat/shared";

// Client-owned placeholder for untitled chats (title === null, generation
// pending, #78) — the api never invents a display literal, matching the
// authenticated chat list's convention.
const UNTITLED_CHAT_LABEL = "Untitled chat";

/**
 * Public read-only share view. No session (middleware allows /shared/*); the
 * api's @Public endpoint + runAsPublic RLS is the boundary. Renders only the
 * text turns the api returns (reasoning + identity already stripped
 * server-side). The full conversation is loaded via the SAME windowed
 * beforeSeq/limit cursor + `paginateAllMessages` walk the owner chat page
 * uses — cost is bounded per page, never by truncating the conversation.
 */
export default function SharedChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const pathname = usePathname();
  const router = useRouter();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["shared", id],
    queryFn: async () => {
      let title: string | null = null;
      const messages = await paginateAllMessages<SharedChatMessage>(
        (beforeSeq) =>
          fetchSharedChat(id, {
            limit: CHAT_HISTORY_PAGE_SIZE,
            ...(beforeSeq !== undefined ? { beforeSeq } : {}),
          }).then((page) => {
            title = page.title;
            return page;
          }),
      );
      return { title, messages };
    },
    retry: false,
  });

  // Optional auth check: a logged-out visitor must still see the chat (no
  // redirect on a 401 here — see useMeOptional's own doc comment) so the
  // fork button can render conditionally instead.
  const { data: me, isLoading: meLoading } = useMeOptional();
  const forkMutation = useForkSharedChat();

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-lg font-medium">This chat isn’t available</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          The link may be wrong, or the chat is no longer shared.
        </p>
      </main>
    );
  }

  const loginHref = `/login?callbackUrl=${encodeURIComponent(pathname)}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <header className="flex items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold">
            {data.title ?? UNTITLED_CHAT_LABEL}
          </h1>
          <p className="text-muted-foreground mt-1 text-xs">
            Shared conversation · read-only
          </p>
        </div>
        {!meLoading &&
          (me ? (
            <Button
              size="sm"
              disabled={forkMutation.isPending}
              onClick={() =>
                forkMutation.mutate(id, {
                  onSuccess: (forked) => router.push(`/chat/${forked.id}`),
                })
              }
            >
              {forkMutation.isPending ? "Forking…" : "Fork to continue"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <a href={loginHref}>Log in to continue</a>
            </Button>
          ))}
      </header>
      <div className="flex flex-col gap-4">
        {data.messages.map((message) => {
          const isUser = message.role === "user";
          const text = message.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n\n");
          if (!text) return null;
          return (
            <Message
              key={message.id}
              className={isUser ? "justify-end" : "justify-start"}
            >
              <MessageContent
                className={cn(
                  "prose text-primary",
                  isUser
                    ? "bg-secondary max-w-[85%] sm:max-w-[75%]"
                    : "w-full flex-1 overflow-x-auto rounded-lg bg-transparent p-0 py-0",
                )}
                markdown
              >
                {text}
              </MessageContent>
            </Message>
          );
        })}
      </div>
    </main>
  );
}
