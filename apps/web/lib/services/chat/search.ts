import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { chatQueryKeys } from "./queries";

/**
 * Chat search — find the user's chats by title or message content. The api
 * owns the query (owner-scoped, user/assistant text only); web just renders.
 * Debounced + a min length + request cancellation on retype so a type-ahead
 * doesn't hammer the api's single shared Postgres connection (FTS is a
 * follow-up; today it's an unindexed, statement_timeout-bounded scan).
 */
export const MIN_SEARCH_LENGTH = 2;

export type ChatSearchResult = {
  id: string;
  // null = untitled (#78) — a content-only match can surface a chat whose
  // title generation hasn't run yet.
  title: string | null;
  snippet: string | null;
  updatedAt: string;
};

export async function searchChats(
  q: string,
  signal?: AbortSignal,
): Promise<ChatSearchResult[]> {
  const url = new URL(buildApiUrl("/api/v1/chats/search"));
  url.searchParams.set("q", q);
  const { results } = await api
    .get(url.toString(), { signal })
    .json<{ results: ChatSearchResult[] }>();
  return results;
}

// Re-exported for callers that need the exact key (e.g. explicit invalidation
// or prefetching) without importing the whole chatQueryKeys factory.
export const chatSearchQueryKey = chatQueryKeys.search;

/**
 * `q` should already be the DEBOUNCED, trimmed term. The query only runs at or
 * above MIN_SEARCH_LENGTH; TanStack passes an AbortSignal that cancels the
 * in-flight request when the term changes (a fresh keystroke).
 */
export function useChatSearchQuery(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: chatSearchQueryKey({ q: trimmed }),
    queryFn: ({ signal }) => searchChats(trimmed, signal),
    enabled: trimmed.length >= MIN_SEARCH_LENGTH,
    staleTime: 30_000,
  });
}
