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
const CHAT_HISTORY_FETCH_TIMEOUT_MS = 5000;

function loginRedirectPath(chatId: string, phase: DraftPhase | null): Route {
  return `/login?callbackUrl=${encodeURIComponent(draftChatPath(chatId, phase))}`;
}

// Injected so tests exercise the real function bodies against fakes instead
// of swapping the next/headers and next/navigation modules underneath them.
// Defaulted to the real Next APIs — every existing caller is unaffected.
// `cookies` is narrowed to the one method this module actually calls, so a
// test fake can implement it faithfully without modeling all of Next's
// ReadonlyRequestCookies.
type SessionCookieReader = () => Promise<{
  get: (name: string) => { value: string } | undefined;
}>;

type ServerHistoryDeps = {
  cookies: SessionCookieReader;
  redirect: typeof redirect;
  notFound: typeof notFound;
};

const defaultServerHistoryDeps: ServerHistoryDeps = {
  cookies,
  redirect,
  notFound,
};

type HistoryRequest = {
  chatId: string;
  phase: DraftPhase | null;
  allowMissing: boolean;
};

async function readSessionCookieOrRedirect(
  request: Pick<HistoryRequest, "chatId" | "phase">,
  deps: ServerHistoryDeps,
): Promise<string> {
  const cookieStore = await deps.cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    deps.redirect(loginRedirectPath(request.chatId, request.phase));
  }
  return sessionCookie.value;
}

function handleHistoryFetchError(
  error: unknown,
  request: HistoryRequest,
  deps: ServerHistoryDeps,
): null {
  const status = getApiErrorStatus(error);

  if (status === 401) {
    deps.redirect(loginRedirectPath(request.chatId, request.phase));
  }
  if (status === 400) {
    deps.notFound();
  }
  if (status === 404) {
    if (request.allowMissing) return null;
    deps.notFound();
  }

  throw error;
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
  deps?: ServerHistoryDeps,
): Promise<ChatMessagesResponse>;
function fetchChatHistory(
  chatId: string,
  phase: DraftPhase,
  allowMissing: true,
  deps?: ServerHistoryDeps,
): Promise<ChatMessagesResponse | null>;
async function fetchChatHistory(
  chatId: string,
  phase: DraftPhase | null,
  allowMissing: boolean,
  deps: ServerHistoryDeps = defaultServerHistoryDeps,
): Promise<ChatMessagesResponse | null> {
  const sessionCookieValue = await readSessionCookieOrRedirect(
    { chatId, phase },
    deps,
  );

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
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionCookieValue}` },
        cache: "no-store",
        signal: controller.signal,
      },
      createServerFetch(globalThis.fetch),
    );

    return normalizeChatMessagesResponse(response);
  } catch (error) {
    return handleHistoryFetchError(
      error,
      { chatId, phase, allowMissing },
      deps,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function fetchInitialChatMessages(
  chatId: string,
  deps?: ServerHistoryDeps,
): Promise<ChatMessagesResponse> {
  return fetchChatHistory(chatId, null, false, deps);
}

export function fetchDraftChatMessages(
  chatId: string,
  phase: DraftPhase,
  deps?: ServerHistoryDeps,
): Promise<ChatMessagesResponse | null> {
  return fetchChatHistory(chatId, phase, true, deps);
}
