"use client";

import { use } from "react";

import { useQuery } from "@tanstack/react-query";

import {
  Message,
  MessageContent,
} from "@/components/components/ai/message";
import { cn } from "@workspace/ui/lib/utils";

import { fetchSharedChat } from "@/lib/services/chat/shared";

/**
 * Public read-only share view. No session (middleware allows /shared/*); the
 * api's @Public endpoint + runAsPublic RLS is the boundary. Renders only the
 * text turns the api returns (reasoning + identity already stripped server-side).
 */
export default function SharedChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["shared", id],
    queryFn: () => fetchSharedChat(id),
    retry: false,
  });

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

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <header className="border-b pb-4">
        <h1 className="text-xl font-semibold">{data.title}</h1>
        <p className="text-muted-foreground mt-1 text-xs">
          Shared conversation · read-only
        </p>
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
