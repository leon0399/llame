import type { UIMessage } from "ai";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  buildChatMessagesHistoryUrl,
  type ChatMessagesResponse,
  toChatUiMessages,
} from "./history";

const SESSION_COOKIE_NAME = "llame_session";

function loginRedirectPath(chatId: string): string {
  return `/login?callbackUrl=${encodeURIComponent(`/chat/${chatId}`)}`;
}

export async function fetchInitialChatMessages(
  chatId: string,
): Promise<UIMessage[]> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie) {
    redirect(loginRedirectPath(chatId));
  }

  const response = await fetch(buildChatMessagesHistoryUrl(chatId), {
    headers: {
      Cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}`,
    },
    cache: "no-store",
  });

  if (response.status === 401) {
    redirect(loginRedirectPath(chatId));
  }

  if (response.status === 400 || response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error(
      `Failed to load chat ${chatId} history (${response.status})`,
    );
  }

  return toChatUiMessages((await response.json()) as ChatMessagesResponse);
}
