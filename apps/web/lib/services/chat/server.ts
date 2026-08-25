import type { Route } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getChatMessages } from "../../api/generated/chats/chats";
import { getApiErrorStatus } from "../../api/errors";
import { createServerFetch } from "../../api/fetch";
import {
  type ChatMessagesResponse,
  normalizeChatMessagesResponse,
} from "./history";
import { CHAT_HISTORY_PAGE_SIZE } from "./paginate-messages";
import { draftChatPath, type DraftPhase } from "./draft-route";

const SESSION_COOKIE_NAME = "llame_session";
const CHAT_HISTORY_FETCH_TIMEOUT_MS = 5_000;

function loginRedirectPath(chatId: string, phase: DraftPhase | null): Route {
  return `/login?callbackUrl=${encodeURIComponent(draftChatPath(chatId, phase))}`;
}

// SSR fetches only the NEWEST page of history (#187) — the window the reader
// lands on. Older pages load on demand as the reader scrolls toward the top
// (see useChatMessagesQuery), so a long chat no longer serializes an
// up-to-20-round-trip walk into its SSR latency. The timeout bounds the one
// round-trip. The overload pair proves at compile time that only the
// allowMissing (draft) caller can observe null — a disallowed 404 becomes
// notFound() inside.
function fetchChatHistory(
  chatId: string,
  phase: null,
  allowMissing: false,
): Promise<ChatMessagesResponse>;
function fetchChatHistory(
  chatId: string,
  phase: DraftPhase,
  allowMissing: true,
): Promise<ChatMessagesResponse | null>;
async function fetchChatHistory(
  chatId: string,
  phase: DraftPhase | null,
  allowMissing: boolean,
): Promise<ChatMessagesResponse | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie) {
    redirect(loginRedirectPath(chatId, phase));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    CHAT_HISTORY_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await getChatMessages(
      encodeURIComponent(chatId),
      { limit: CHAT_HISTORY_PAGE_SIZE },
      {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}` },
        cache: "no-store",
        signal: controller.signal,
      },
      createServerFetch(globalThis.fetch),
    );

    return normalizeChatMessagesResponse(response);
  } catch (error) {
    const status = getApiErrorStatus(error);

    if (status === 401) {
      redirect(loginRedirectPath(chatId, phase));
    }

    if (status === 400) {
      notFound();
    }

    if (status === 404) {
      if (allowMissing) return null;
      notFound();
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function fetchInitialChatMessages(
  chatId: string,
): Promise<ChatMessagesResponse> {
  return fetchChatHistory(chatId, null, false);
}

export function fetchDraftChatMessages(
  chatId: string,
  phase: DraftPhase,
): Promise<ChatMessagesResponse | null> {
  return fetchChatHistory(chatId, phase, true);
}
