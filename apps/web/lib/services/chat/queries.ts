import {
  type QueryClient,
  queryOptions,
  type QueryFunctionContext,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import { api, buildApiUrl } from "../../api/client";
import {
  buildChatMessagesHistoryUrl,
  type ChatHistory,
  type ChatMessagesResponse,
  type Compaction,
  toChatUiMessages,
} from "./history";
import {
  CHAT_HISTORY_PAGE_SIZE,
  paginateAllMessages,
} from "./paginate-messages";

export type ChatResponse = {
  id: string;
  // null = untitled (server-side generation pending); render a localized placeholder.
  title: string | null;
  visibility: "private" | "public";
  createdAt: string;
  updatedAt: string;
  // Text-only excerpt of the latest message, truncated server-side; empty for
  // tool-only turns, null for a chat without messages. List reads only.
  lastMessage: string | null;
  // Project the chat is filed into (projects-foundation); null = unfiled.
  projectId: string | null;
  // Archive state (chat-project-archive); null = not archived.
  archivedAt: string | null;
};

// NOTE: no pinnedAt field here. Pin state lives only in the pins subsystem
// (rework-item-pinning, design D5) — this resource carries no pin field, and
// grouping by pin status is derived on the client from GET /pins, not from a
// field on the chat (see groupChatsByTimePeriod below).

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
// filed into that project (the /projects page's list).
export type ChatListFilters = {
  projectId?: string;
  archived?: "only";
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
    (filters.projectId !== undefined || filters.archived !== undefined)
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
};

type ChatMessagesQueryKey = ReturnType<typeof chatQueryKeys.messages>;

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
  const searchParams: Record<string, string> = {};
  if (filters?.projectId !== undefined)
    searchParams.projectId = filters.projectId;
  if (filters?.archived !== undefined) searchParams.archived = filters.archived;
  const sp =
    Object.keys(searchParams).length > 0 ? { searchParams } : undefined;
  return api.get(buildApiUrl("/api/v1/chats"), sp).json<ChatResponse[]>();
};

// Compaction (#57) arrives EMBEDDED in the messages response (#136 — folded
// from a separate GET :id/compaction call into this one), so there's a
// single fetch, not two independently-failing ones. `paginateAllMessages`
// only returns the merged message array across pages; every page in one
// fetch carries the identical "latest compaction" snapshot (it's not
// paginated itself), so capturing it from whichever page's response lands
// last is equivalent to reading it from the first — same pattern
// `app/shared/[id]/page.tsx` already uses to pull `title` out of each page.
export const fetchChatMessages = async ({
  queryKey: [, chatId],
  signal,
}: QueryFunctionContext<ChatMessagesQueryKey>): Promise<ChatHistory> => {
  let compaction: Compaction | null = null;
  const messages = await paginateAllMessages((beforeSeq) =>
    api
      .get(
        buildChatMessagesHistoryUrl(chatId, {
          limit: CHAT_HISTORY_PAGE_SIZE,
          ...(beforeSeq !== undefined ? { beforeSeq } : {}),
        }),
        { signal },
      )
      .json<ChatMessagesResponse>()
      .then((page) => {
        compaction = page.compaction;
        return page;
      }),
  );
  return { messages: toChatUiMessages({ messages }), compaction };
};

export function seedChatMessagesQueryData(
  queryClient: QueryClient,
  chatId: string,
  history: ChatHistory,
) {
  queryClient.setQueryData(chatQueryKeys.messages(chatId), history);
}

export function chatMessagesQueryOptions(chatId: string) {
  return queryOptions({
    queryKey: chatQueryKeys.messages(chatId),
    queryFn: fetchChatMessages,
  });
}

export function useChatMessagesQuery({
  chatId,
  enabled = true,
  initialMessages,
}: {
  chatId: string;
  enabled?: boolean;
  initialMessages?: ChatHistory;
}) {
  return useQuery({
    ...chatMessagesQueryOptions(chatId),
    enabled,
    ...(initialMessages === undefined ? {} : { initialData: initialMessages }),
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
  PINNED = "pinned",
  TODAY = "today",
  YESTERDAY = "yesterday",
  LAST_WEEK = "last-week",
  LAST_MONTH = "last-month",
  OLDER = "older",
}

type GroupedChats = {
  [key in ChatGroupPeriod]?: ChatResponse[];
};

/**
 * @param pinnedAtByChatId Chat id -> pinnedAt, from the caller's pins
 * (`selectPinnedChatMap` in `../pins/queries`). Pins is the sole source of
 * pin state (design D5) — a chat carries no pin field of its own, so
 * membership here is what routes it to the Pinned group instead of its time
 * group, and the group is ordered by this map's value (pin recency), not by
 * the chat's own updatedAt.
 */
export function groupChatsByTimePeriod(
  chats: ChatResponse[],
  pinnedAtByChatId: ReadonlyMap<string, string> = new Map(),
): GroupedChats {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  const groups = chats.reduce((groups, chat) => {
    // Pinned chats live in their own section at the top, regardless of
    // recency — and NOT also under a time group.
    if (pinnedAtByChatId.has(chat.id)) {
      if (!groups[ChatGroupPeriod.PINNED]) groups[ChatGroupPeriod.PINNED] = [];
      groups[ChatGroupPeriod.PINNED].push(chat);
      return groups;
    }

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
  }, {} as GroupedChats);

  // Pin recency, not chat recency: the reduce above preserves `chats`' own
  // order (updatedAt desc), so the Pinned bucket needs its own sort by the
  // caller's pin timestamps.
  const pinnedGroup = groups[ChatGroupPeriod.PINNED];
  if (pinnedGroup) {
    // pinnedAt is ISO-8601 UTC — lexicographically ordered == chronological,
    // so compare the strings directly (no Date allocation per comparison).
    pinnedGroup.sort((a, b) => {
      const aAt = pinnedAtByChatId.get(a.id) ?? "";
      const bAt = pinnedAtByChatId.get(b.id) ?? "";
      return bAt.localeCompare(aAt);
    });
  }

  return groups;
}
