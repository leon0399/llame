import {
  type QueryClient,
  queryOptions,
  type QueryFunctionContext,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import React from "react";
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
  // Set when the owner pinned the chat to the top of the sidebar; null = unpinned.
  pinnedAt: string | null;
};

// The chat-search list's variable criteria, kept as one structured object —
// per TkDodo's "Effective React Query Keys" (https://tkdodo.eu/blog/effective-react-query-keys),
// filters belong in an object at the end of the key, not as bare positional
// values. `q` today; a future filter (status, project, date range, …) is an
// added field here, not a new array position — existing keys/invalidations/
// `predicate` matches on `filters.q` keep working unchanged.
export type ChatSearchFilters = {
  q: string;
};

export const chatQueryKeys = {
  all: ["chats"] as const,
  lists: () => [...chatQueryKeys.all, "list"] as const,
  infinite: () => [...chatQueryKeys.lists(), "infinite"] as const,
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

export const fetchChats = () =>
  api.get(buildApiUrl("/api/v1/chats")).json<ChatResponse[]>();

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

export function useChatsQuery() {
  const query = useInfiniteQuery({
    queryKey: chatQueryKeys.infinite(),
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

export function groupChatsByTimePeriod(chats: ChatResponse[]): GroupedChats {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce((groups, chat) => {
    // Pinned chats live in their own section at the top, regardless of recency —
    // and NOT also under a time group (the API already returns them pinned-first).
    if (chat.pinnedAt) {
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
}

// group chats by time period
export function useGroupedChatsQuery() {
  const { data, ...rest } = useChatsQuery();
  const allChats = React.useMemo(() => data?.pages.flat() || [], [data]);

  const groupedChats: GroupedChats = React.useMemo(
    () => groupChatsByTimePeriod(allChats),
    [allChats],
  );
  return {
    ...rest,
    data: groupedChats,
  };
}
