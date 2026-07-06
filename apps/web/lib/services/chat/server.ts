import type { UIMessage } from "ai";
import type { Route } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  buildChatMessagesHistoryUrl,
  type ChatMessagesResponse,
  toChatUiMessages,
} from "./history";
import {
  CHAT_HISTORY_PAGE_SIZE,
  paginateAllMessages,
} from "./paginate-messages";

const SESSION_COOKIE_NAME = "llame_session";
const CHAT_HISTORY_FETCH_TIMEOUT_MS = 5_000;

function loginRedirectPath(chatId: string): Route {
  return `/login?callbackUrl=${encodeURIComponent(`/chat/${chatId}`)}`;
}

// One page of history for SSR, carrying the session cookie. Auth/timeout are
// applied PER page (redirect/notFound throw and propagate out of the paginator);
// the timeout bounds each round-trip.
async function fetchHistoryPage(
  chatId: string,
  cookieValue: string,
  beforeSeq: number | undefined,
): Promise<ChatMessagesResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    CHAT_HISTORY_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      buildChatMessagesHistoryUrl(chatId, {
        limit: CHAT_HISTORY_PAGE_SIZE,
        ...(beforeSeq !== undefined ? { beforeSeq } : {}),
      }),
      {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
        cache: "no-store",
        signal: controller.signal,
      },
    );

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

    return (await response.json()) as ChatMessagesResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchInitialChatMessages(
  chatId: string,
): Promise<UIMessage[]> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie) {
    redirect(loginRedirectPath(chatId));
  }

  const messages = await paginateAllMessages((beforeSeq) =>
    fetchHistoryPage(chatId, sessionCookie.value, beforeSeq),
  );
  return toChatUiMessages({ messages });
}
