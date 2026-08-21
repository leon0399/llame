import {
  type QueryClient,
  queryOptions,
  type QueryFunctionContext,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import { getChatMessages, listChats } from "../../api/generated/chats/chats";
import type {
  ChatListItemResponse,
  ListChatsParams,
} from "../../api/generated/models";
import { getApiErrorStatus } from "../../api/errors";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import {
  type ChatHistory,
  type Compaction,
  normalizeChatMessagesResponse,
  toChatUiMessages,
} from "./history";
import {
  CHAT_HISTORY_PAGE_SIZE,
  paginateAllMessages,
} from "./paginate-messages";

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
};

type ChatMessagesQueryKey = ReturnType<typeof chatQueryKeys.messages>;

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
  const searchParams: Record<string, string> = {};
  if (filters?.projectId !== undefined)
    searchParams.projectId = filters.projectId;
  if (filters?.pinned !== undefined) searchParams.pinned = filters.pinned;
  if (filters?.archived !== undefined) searchParams.archived = filters.archived;
  const params: ListChatsParams | undefined =
    Object.keys(searchParams).length > 0
      ? {
          ...(searchParams.projectId
            ? { projectId: searchParams.projectId }
            : {}),
          ...(searchParams.pinned
            ? { pinned: searchParams.pinned as ListChatsParams["pinned"] }
            : {}),
          ...(searchParams.archived
            ? {
                archived: searchParams.archived as ListChatsParams["archived"],
              }
            : {}),
        }
      : undefined;
  return listChats(
    params,
    context?.signal === undefined ? undefined : { signal: context.signal },
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
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
    getChatMessages(
      encodeURIComponent(chatId),
      {
        limit: CHAT_HISTORY_PAGE_SIZE,
        ...(beforeSeq !== undefined ? { beforeSeq } : {}),
      },
      { signal },
      createAuthenticatedBrowserFetch(globalThis.fetch),
    ).then((page) => {
      const normalized = normalizeChatMessagesResponse(page);
      compaction = normalized.compaction;
      return normalized;
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

export function chatMessagesQueryOptions(
  chatId: string,
  { recoverSentDraft = false }: ChatMessagesQueryOptions = {},
) {
  return queryOptions({
    queryKey: chatQueryKeys.messages(chatId),
    queryFn: fetchChatMessages,
    ...(recoverSentDraft
      ? {
          retry: (failureCount: number, error: unknown) =>
            failureCount < SENT_DRAFT_RECOVERY_RETRY_COUNT &&
            isChatHistoryMissing(error),
        }
      : {}),
  });
}

export function useChatMessagesQuery({
  chatId,
  enabled = true,
  initialMessages,
  recoverSentDraft = false,
}: {
  chatId: string;
  enabled?: boolean;
  initialMessages?: ChatHistory;
  recoverSentDraft?: boolean;
}) {
  return useQuery({
    ...chatMessagesQueryOptions(chatId, { recoverSentDraft }),
    enabled,
    ...(initialMessages === undefined ? {} : { initialData: initialMessages }),
  });
}

export function isChatHistoryMissing(error: unknown): boolean {
  return getApiErrorStatus(error) === 404;
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
  [key in ChatGroupPeriod]?: ChatResponse[];
};

/**
 * The All query (?pinned=exclude) never contains pinned chats — the Pinned
 * section is a separate server query — so this function only groups by time
 * period.
 */
export function groupChatsByTimePeriod(chats: ChatResponse[]): GroupedChats {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

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
  }, {} as GroupedChats);
}
