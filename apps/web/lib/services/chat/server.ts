import type { Route } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getChatMessages } from "../../api/generated/chats/chats";
import { getApiErrorStatus } from "../../api/errors";
import { createServerFetch } from "../../api/fetch";
import {
  type ChatHistory,
  type ChatMessagesResponse,
  type Compaction,
  normalizeChatMessagesResponse,
  toChatUiMessages,
} from "./history";
import {
  CHAT_HISTORY_PAGE_SIZE,
  paginateAllMessages,
} from "./paginate-messages";
import { draftChatPath, type DraftPhase } from "./draft-route";

const SESSION_COOKIE_NAME = "llame_session";
const CHAT_HISTORY_FETCH_TIMEOUT_MS = 5_000;

function loginRedirectPath(chatId: string, phase: DraftPhase | null): Route {
  return `/login?callbackUrl=${encodeURIComponent(draftChatPath(chatId, phase))}`;
}

// One page of history for SSR, carrying the session cookie. Auth/timeout are
// applied PER page (redirect/notFound throw and propagate out of the paginator);
// the timeout bounds each round-trip.
async function fetchHistoryPage(
  chatId: string,
  cookieValue: string,
  beforeSeq: number | undefined,
  phase: DraftPhase | null,
  allowMissing: boolean,
): Promise<ChatMessagesResponse | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    CHAT_HISTORY_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await getChatMessages(
      encodeURIComponent(chatId),
      {
        limit: CHAT_HISTORY_PAGE_SIZE,
        ...(beforeSeq !== undefined ? { beforeSeq } : {}),
      },
      {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
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

function fetchChatHistory(
  chatId: string,
  phase: null,
  allowMissingInitial: false,
): Promise<ChatHistory>;
function fetchChatHistory(
  chatId: string,
  phase: DraftPhase,
  allowMissingInitial: true,
): Promise<ChatHistory | null>;
async function fetchChatHistory(
  chatId: string,
  phase: DraftPhase | null,
  allowMissingInitial: boolean,
): Promise<ChatHistory | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie) {
    redirect(loginRedirectPath(chatId, phase));
  }

  // Compaction (#57) is embedded in the messages response (#136) — capture it
  // the same way the client-side fetch does (fetchChatMessages in queries.ts):
  // every page in this one fetch carries the identical "latest compaction"
  // snapshot, so it doesn't matter which page's value is kept.
  let compaction: Compaction | null = null;
  let missingInitialPage = false;
  const messages = await paginateAllMessages((beforeSeq) => {
    const allowMissing = allowMissingInitial && beforeSeq === undefined;

    return fetchHistoryPage(
      chatId,
      sessionCookie.value,
      beforeSeq,
      phase,
      allowMissing,
    ).then((page) => {
      if (page === null) {
        missingInitialPage = true;
        return { messages: [], compaction: null };
      }

      compaction = page.compaction;
      return page;
    });
  });

  if (missingInitialPage) return null;
  return { messages: toChatUiMessages({ messages }), compaction };
}

export async function fetchInitialChatMessages(
  chatId: string,
): Promise<ChatHistory> {
  return fetchChatHistory(chatId, null, false);
}

export function fetchDraftChatMessages(
  chatId: string,
  phase: DraftPhase,
): Promise<ChatHistory | null> {
  return fetchChatHistory(chatId, phase, true);
}
