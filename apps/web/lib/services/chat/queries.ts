import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  type QueryFunctionContext,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import {
  getChat,
  getChatMessages,
  listChats,
} from "../../api/generated/chats/chats";
import type {
  ChatListItemResponse,
  ChatResponse as ApiChatResponse,
  GetChatMessagesParams,
  ListChatsParams,
} from "../../api/generated/models";
import { getApiErrorStatus } from "../../api/errors";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import {
  type ChatHistory,
  type ChatMessagesResponse,
  normalizeChatMessagesResponse,
  toChatUiMessages,
} from "./history";
import { CHAT_HISTORY_PAGE_SIZE } from "./paginate-messages";

/** Component-facing chat shape, based on the generated list contract. */
export type ChatResponse = Omit<
  ChatListItemResponse,
  "lastMessage" | "ownerUserId"
> & {
  lastMessage?: string | null;
  ownerUserId?: string;
};

// NOTE: no pinnedAt field here. Pin state lives only in the pins subsystem
// (rework-item-pinning, design D5). The Pinned section is sourced from a
// server query (?pinned=only), not derived from GET /pins.

// The chat-search list's variable criteria, kept as one structured object —
// per TkDodo's "Effective React Query Keys" (https://tkdodo.eu/blog/effective-react-query-keys),
// filters belong in an object at the end of the key, not as bare positional
// values. `q` today; a future filter (status, project, date range, …) is an
// added field here, not a new array position — existing keys/invalidations/
// `predicate` matches on `filters.q` keep working unchanged.
export type ChatSearchFilters = {
  q: string;
};

// Chat-list filters, same structured-object-at-the-end convention as
// ChatSearchFilters above. `projectId` narrows the list server-side to chats
// filed into that project (the /projects page's list). `pinned` selects the
// Pinned category (?pinned=only) or the All category (?pinned=exclude);
// absent = default (both, archived excluded).
export type ChatListFilters = {
  projectId?: string;
  pinned?: "only" | "exclude";
  archived?: "only" | "with";
};

export const chatQueryKeys = {
  all: ["chats"] as const,
  lists: () => [...chatQueryKeys.all, "list"] as const,
  // No-filter calls keep the historical key shape (no trailing object), so
  // existing caches/invalidations are untouched; filtered lists get their own
  // entry under lists() and are therefore still caught by every
  // lists()-prefix invalidation (file/unfile, rename, pin, delete, send).
  infinite: (filters?: ChatListFilters) =>
    filters &&
    (filters.projectId !== undefined ||
      filters.pinned !== undefined ||
      filters.archived !== undefined)
      ? ([...chatQueryKeys.lists(), "infinite", filters] as const)
      : ([...chatQueryKeys.lists(), "infinite"] as const),
  // Under lists(), not a sibling of it: invalidating chatQueryKeys.lists()
  // (rename/pin/delete/send — every list-affecting mutation) must also
  // invalidate any live search results, or a search result can go stale
  // right after the same data it's showing changes.
  search: (filters: ChatSearchFilters) =>
    [...chatQueryKeys.lists(), "search", filters] as const,
  detail: (chatId: string) => [...chatQueryKeys.all, chatId] as const,
  messages: (chatId: string) =>
    [...chatQueryKeys.detail(chatId), "messages"] as const,
  targetMessages: (chatId: string, targetSeq: number) =>
    [...chatQueryKeys.messages(chatId), "target", targetSeq] as const,
};

type ChatMessagesQueryKey =
  | ReturnType<typeof chatQueryKeys.messages>
  | ReturnType<typeof chatQueryKeys.targetMessages>;

type ChatMessagesQueryOptions = {
  recoverSentDraft?: boolean;
};

const SENT_DRAFT_RECOVERY_RETRY_COUNT = 2;

// Both shapes chatQueryKeys.infinite() produces (with/without the trailing
// filters object) are assignable to this optional-element tuple.
type ChatsInfiniteQueryKey = readonly [
  "chats",
  "list",
  "infinite",
  ChatListFilters?,
];

// Reads its filters from the query key (QueryFunctionContext), per the
// repo convention — the key is the single source of the request variables.
export const fetchChats = (
  context?: QueryFunctionContext<ChatsInfiniteQueryKey>,
) => {
  const filters = context?.queryKey[3];
  const params: ListChatsParams = {};
  if (filters?.projectId !== undefined) {
    params.projectId = filters.projectId;
  }
  if (filters?.pinned !== undefined) {
    params.pinned = filters.pinned;
  }
  if (filters?.archived !== undefined) {
    params.archived = filters.archived;
  }
  return listChats(
    Object.keys(params).length > 0 ? params : undefined,
    context?.signal === undefined ? undefined : { signal: context.signal },
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
};

// The cursor for one history page: `null` = the newest window (no
// `beforeSeq`), a number = strictly-older-than-that-seq. `null` rather than
// `undefined` so the SSR-seeded page param survives dehydration verbatim.
type ChatMessagesPageParam = number | null;
const INITIAL_MESSAGES_PAGE_PARAM: ChatMessagesPageParam = null;

// One page of history, newest window first. Compaction (#57) arrives
// EMBEDDED in the messages response (#136 — folded from a separate
// GET :id/compaction call into this one), so there's a single fetch, not two
// independently-failing ones.
const fetchChatMessagesPage = async ({
  queryKey: [, chatId, , mode, targetSeq],
  pageParam,
  signal,
}: QueryFunctionContext<
  ChatMessagesQueryKey,
  ChatMessagesPageParam
>): Promise<ChatMessagesResponse> => {
  const params: GetChatMessagesParams = { limit: CHAT_HISTORY_PAGE_SIZE };
  if (pageParam !== null) {
    params.beforeSeq = pageParam;
  } else if (mode === "target" && targetSeq !== undefined) {
    params.targetSeq = targetSeq;
  }
  return normalizeChatMessagesResponse(
    await getChatMessages(
      encodeURIComponent(chatId),
      params,
      { signal },
      createAuthenticatedBrowserFetch(globalThis.fetch),
    ),
  );
};

/**
 * The `beforeSeq` cursor for the page after `lastPage`, or `undefined` when
 * the walk is done. Mirrors the guards the old eager walk had
 * (paginate-messages.ts): a short page means the chat start was reached, and
 * a non-advancing cursor (a server that ignored `beforeSeq`) must stop the
 * walk — under the scroll-driven loader it would otherwise refetch the same
 * page forever. `seq` starts at 1, so a page whose oldest row is seq 1
 * already holds the chat's first message.
 */
export function olderPageParam(
  lastPage: { messages: Array<{ seq: number }> },
  lastPageParam: ChatMessagesPageParam,
): number | undefined {
  if (lastPage.messages.length < CHAT_HISTORY_PAGE_SIZE) return undefined;
  const cursor = lastPage.messages[0]?.seq;
  if (cursor === undefined || cursor <= 1) return undefined;
  if (lastPageParam !== null && cursor >= lastPageParam) return undefined;
  return cursor;
}

/**
 * Flatten the paginated cache into the oldest→newest shape `ChatPage`
 * renders from. `pages[0]` is the newest window and each later page is
 * strictly older, so the display order is the page order reversed. Every
 * page carries the identical "latest compaction" snapshot (it's not
 * paginated itself); the newest page's copy is the freshest after a refetch.
 *
 * Pages that fail to advance are truncated here, at the merge point:
 * TanStack commits a fetched page to the cache BEFORE `getNextPageParam`
 * can reject it, so a server that ignored `beforeSeq` would otherwise
 * flatten into overlapping seq/id rows (and duplicate React keys). The old
 * eager walk rejected such a page outright (paginate-messages.ts); this
 * restores that property for the windowed cache.
 */
export function toChatHistory(
  data: InfiniteData<ChatMessagesResponse, ChatMessagesPageParam>,
): ChatHistory {
  const pages: Array<ChatMessagesResponse["messages"]> = [];
  for (const page of data.pages) {
    const previousOldest = pages.at(-1)?.[0]?.seq;
    const pageNewest = page.messages.at(-1)?.seq;
    if (
      previousOldest !== undefined &&
      pageNewest !== undefined &&
      pageNewest >= previousOldest
    ) {
      break;
    }
    pages.push(page.messages);
  }
  const messages = pages.reverse().flat();
  return {
    messages: toChatUiMessages({ messages }),
    compaction: data.pages[0]?.compaction ?? null,
  };
}

export function seedChatMessagesQueryData(
  queryClient: QueryClient,
  chatId: string,
  firstPage: ChatMessagesResponse,
) {
  queryClient.setQueryData<
    InfiniteData<ChatMessagesResponse, ChatMessagesPageParam>
  >(chatQueryKeys.messages(chatId), {
    pages: [firstPage],
    pageParams: [null],
  });
}

export function chatMessagesQueryOptions(
  chatId: string,
  {
    recoverSentDraft = false,
    targetSeq,
  }: ChatMessagesQueryOptions & { targetSeq?: number } = {},
) {
  const queryKey =
    targetSeq === undefined
      ? chatQueryKeys.messages(chatId)
      : chatQueryKeys.targetMessages(chatId, targetSeq);

  // A `retry: undefined` key (instead of omitting it) still shadows the
  // QueryClient's own `retry` default: TanStack merges defaults and
  // per-query options with a plain object spread, and an explicit
  // `undefined` value is a present key, so it wins over the default and
  // falls through to the library's OWN retry default (3 attempts) rather
  // than the client's. Building two separate calls below (instead of one
  // object literal with a conditional `retry` key, or a shared variable —
  // which would lose `infiniteQueryOptions`'s contextual parameter
  // inference) is what actually omits the key when this isn't a draft
  // recovery, letting the QueryClient's configured default apply.
  if (recoverSentDraft) {
    return infiniteQueryOptions({
      queryKey,
      queryFn: fetchChatMessagesPage,
      initialPageParam: INITIAL_MESSAGES_PAGE_PARAM,
      getNextPageParam: (lastPage, _allPages, lastPageParam) =>
        olderPageParam(lastPage, lastPageParam),
      select: toChatHistory,
      // `error: Error` (not `unknown`) matches TanStack's own `DefaultError`
      // generic — the type both branches must agree on so this function's
      // two `infiniteQueryOptions` calls unify into one consistent return
      // type instead of an unusable union.
      retry: (failureCount: number, error: Error) =>
        failureCount < SENT_DRAFT_RECOVERY_RETRY_COUNT &&
        isChatHistoryMissing(error),
    });
  }
  return infiniteQueryOptions({
    queryKey,
    queryFn: fetchChatMessagesPage,
    initialPageParam: INITIAL_MESSAGES_PAGE_PARAM,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      olderPageParam(lastPage, lastPageParam),
    select: toChatHistory,
  });
}

/**
 * Windowed chat history (#187): the initial fetch is ONE page (the newest
 * `CHAT_HISTORY_PAGE_SIZE` messages) instead of the old eager 20-page walk,
 * and `fetchNextPage` loads strictly-older pages on demand as the reader
 * scrolls toward the top. Invalidation (after a completed turn) refetches
 * only the pages already loaded, re-deriving each cursor from the fresh
 * previous page — TanStack's sequential infinite refetch — so a slid window
 * cannot leave a seq gap between pages.
 *
 * TODO(#187): that refetch walks EVERY loaded page, so a reader deep in
 * history pays N sequential round trips per completed turn. Fine for the
 * common 1-page case and never worse than the old always-20-page walk;
 * TanStack's `maxPages` would cap it but drops the NEWEST page on backward
 * fetches, which breaks the seq-based adoption's coverage comparison —
 * revisit only if deep-history sessions show up in practice.
 */
export function useChatMessagesQuery({
  chatId,
  enabled = true,
  recoverSentDraft = false,
  targetSeq,
}: {
  chatId: string;
  enabled?: boolean;
  recoverSentDraft?: boolean;
  targetSeq?: number;
}) {
  return useInfiniteQuery({
    ...chatMessagesQueryOptions(chatId, { recoverSentDraft, targetSeq }),
    enabled,
  });
}

export function isChatHistoryMissing(error: unknown): boolean {
  return getApiErrorStatus(error) === 404;
}

/**
 * Owner chat card by id. Key is `chatQueryKeys.detail(id)` with `exact`
 * invalidation — sibling `…/messages` must not ride along.
 */
export function useChatQuery(chatId: string, enabled = true) {
  return useQuery({
    queryKey: chatQueryKeys.detail(chatId),
    queryFn: async ({ signal }): Promise<ApiChatResponse> =>
      getChat(
        chatId,
        signal === undefined ? undefined : { signal },
        createAuthenticatedBrowserFetch(globalThis.fetch),
      ),
    enabled: enabled && chatId.length > 0,
  });
}

export function useChatsQuery(filters?: ChatListFilters) {
  const query = useInfiniteQuery({
    queryKey: chatQueryKeys.infinite(filters),
    queryFn: fetchChats,
    initialPageParam: undefined,
    getNextPageParam: () => undefined,
  });

  return {
    ...query,
    hasData: query.data?.pages.every((page) => page.length > 0) ?? false,
  };
}

export enum ChatGroupPeriod {
  TODAY = "today",
  YESTERDAY = "yesterday",
  LAST_WEEK = "last-week",
  LAST_MONTH = "last-month",
  OLDER = "older",
}

type GroupedChats = {
  [key in ChatGroupPeriod]?: Array<ChatResponse>;
};

/**
 * The All query (?pinned=exclude) never contains pinned chats — the Pinned
 * section is a separate server query — so this function only groups by time
 * period.
 */
export function groupChatsByTimePeriod(
  chats: Array<ChatResponse>,
): GroupedChats {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);
  const initialGroups: GroupedChats = {};

  return chats.reduce((groups, chat) => {
    const chatDate = new Date(chat.updatedAt);

    if (isToday(chatDate)) {
      if (!groups[ChatGroupPeriod.TODAY]) groups[ChatGroupPeriod.TODAY] = [];
      groups[ChatGroupPeriod.TODAY].push(chat);
    } else if (isYesterday(chatDate)) {
      if (!groups[ChatGroupPeriod.YESTERDAY])
        groups[ChatGroupPeriod.YESTERDAY] = [];
      groups[ChatGroupPeriod.YESTERDAY].push(chat);
    } else if (chatDate > oneWeekAgo) {
      if (!groups[ChatGroupPeriod.LAST_WEEK])
        groups[ChatGroupPeriod.LAST_WEEK] = [];
      groups[ChatGroupPeriod.LAST_WEEK].push(chat);
    } else if (chatDate > oneMonthAgo) {
      if (!groups[ChatGroupPeriod.LAST_MONTH])
        groups[ChatGroupPeriod.LAST_MONTH] = [];
      groups[ChatGroupPeriod.LAST_MONTH].push(chat);
    } else {
      if (!groups[ChatGroupPeriod.OLDER]) groups[ChatGroupPeriod.OLDER] = [];
      groups[ChatGroupPeriod.OLDER].push(chat);
    }

    return groups;
  }, initialGroups);
}
