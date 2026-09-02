"use client";

import { use } from "react";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";

import {
  Message,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message";
import { MessageResponse } from "@workspace/ui/components/ai-elements/message-response";
import { Button, buttonVariants } from "@workspace/ui/components/button";

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

async function fetchAllSharedMessages(
  id: string,
): Promise<{ title: string | null; messages: Array<SharedChatMessage> }> {
  let title: string | null = null;
  const messages = await paginateAllMessages<SharedChatMessage>(
    (beforeSeq) => {
      const options: Parameters<typeof fetchSharedChat>[1] = {
        limit: CHAT_HISTORY_PAGE_SIZE,
      };
      if (beforeSeq !== undefined) options.beforeSeq = beforeSeq;
      return fetchSharedChat(id, options).then((page) => {
        title = page.title;
        return page;
      });
    },
    // Uncapped walk: faithfulness is the invariant for a share (see the
    // api-side removal of the message cap) — per-request cost is already
    // bounded by the page size, so the OWNER page's 20-page safety valve
    // must not silently truncate the shared conversation on top of that.
    Infinity,
  );
  return { title, messages };
}

function ShareForkOrLoginButton({
  isAuthenticated,
  loginHref,
  forkPending,
  onFork,
}: {
  isAuthenticated: boolean;
  loginHref: string;
  forkPending: boolean;
  onFork: () => void;
}) {
  if (isAuthenticated) {
    return (
      <Button size="sm" disabled={forkPending} onClick={onFork}>
        {forkPending ? "Forking…" : "Fork to continue"}
      </Button>
    );
  }
  return (
    <a
      href={loginHref}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      Log in to continue
    </a>
  );
}

function ShareChatHeader({
  title,
  meLoading,
  isAuthenticated,
  loginHref,
  forkPending,
  onFork,
}: {
  title: string | null;
  meLoading: boolean;
  isAuthenticated: boolean;
  loginHref: string;
  forkPending: boolean;
  onFork: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b pb-4">
      <div>
        <h1 className="text-xl font-semibold">
          {title ?? UNTITLED_CHAT_LABEL}
        </h1>
        <p className="text-muted-foreground mt-1 text-xs">
          Shared conversation · read-only
        </p>
      </div>
      {!meLoading && (
        <ShareForkOrLoginButton
          isAuthenticated={isAuthenticated}
          loginHref={loginHref}
          forkPending={forkPending}
          onFork={onFork}
        />
      )}
    </header>
  );
}

function SharedChatStatus({
  isLoading,
  hasError,
}: {
  isLoading: boolean;
  hasError: boolean;
}) {
  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }
  if (hasError) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-lg font-medium">This chat isn’t available</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          The link may be wrong, or the chat is no longer shared.
        </p>
      </main>
    );
  }
  return null;
}

function SharedMessageList({
  messages,
}: {
  messages: Array<SharedChatMessage>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((message) => {
        const text = message.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n\n");
        if (!text) return null;
        return (
          <Message key={message.id} from={message.role}>
            <MessageContent>
              <MessageResponse>{text}</MessageResponse>
            </MessageContent>
          </Message>
        );
      })}
    </div>
  );
}

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
    queryFn: () => fetchAllSharedMessages(id),
    retry: false,
  });

  // Optional auth check: a logged-out visitor must still see the chat (no
  // redirect on a 401 here — see useMeOptional's own doc comment) so the
  // fork button can render conditionally instead.
  const { data: me, isLoading: meLoading } = useMeOptional();
  const forkMutation = useForkSharedChat();

  if (isLoading || isError || !data) {
    return (
      <SharedChatStatus isLoading={isLoading} hasError={isError || !data} />
    );
  }

  const loginHref = `/login?callbackUrl=${encodeURIComponent(pathname)}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <ShareChatHeader
        title={data.title}
        meLoading={meLoading}
        isAuthenticated={Boolean(me)}
        loginHref={loginHref}
        forkPending={forkMutation.isPending}
        onFork={() =>
          forkMutation.mutate(id, {
            onSuccess: (forked) => router.push(`/chat/${forked.id}`),
          })
        }
      />
      <SharedMessageList messages={data.messages} />
    </main>
  );
}
