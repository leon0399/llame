import type { UIMessage } from "ai";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  buildChatMessagesHistoryUrl,
  type ChatMessagesResponse,
  toChatUiMessages,
} from "./history";

const SESSION_COOKIE_NAME = "llame_session";
const CHAT_HISTORY_FETCH_TIMEOUT_MS = 5_000;

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

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    CHAT_HISTORY_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(buildChatMessagesHistoryUrl(chatId), {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}`,
      },
      cache: "no-store",
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeoutId);
  }
}
