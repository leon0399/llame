import { useInfiniteQuery } from "@tanstack/react-query";
import { isToday, isYesterday, subMonths, subWeeks } from 'date-fns';
import ky from "ky";
import React from "react";

type ChatResponse = {
  id: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
}

export const fetchChats = () => ky.get<{ data: ChatResponse[]; }>("/api/v1/chats")

export function useChatsQuery() {
  const query = useInfiniteQuery({
    queryKey: ["infinite-chats"],
    queryFn: async () => (await fetchChats().json()).data,
    initialPageParam: undefined,
    getNextPageParam: (lastPage, allPages) => undefined,
  });

  return {
    ...query,
    hasData: query.data?.pages.every((page) => page.length > 0),
  }
}

type ChatsQueryResult = ReturnType<typeof useChatsQuery>;

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

type GroupedChatsQueryResult = Omit<ChatsQueryResult, "data"> & {
  data: GroupedChats | undefined;
};

export function groupChatsByTimePeriod(chats: ChatResponse[]): GroupedChats {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce(
    (groups, chat) => {
      const chatDate = new Date(chat.lastMessageAt);

      if (isToday(chatDate)) {
        if (!groups[ChatGroupPeriod.TODAY]) groups[ChatGroupPeriod.TODAY] = [];
        groups[ChatGroupPeriod.TODAY].push(chat);
      } else if (isYesterday(chatDate)) {
        if (!groups[ChatGroupPeriod.YESTERDAY]) groups[ChatGroupPeriod.YESTERDAY] = [];
        groups[ChatGroupPeriod.YESTERDAY].push(chat);
      } else if (chatDate > oneWeekAgo) {
        if (!groups[ChatGroupPeriod.LAST_WEEK]) groups[ChatGroupPeriod.LAST_WEEK] = [];
        groups[ChatGroupPeriod.LAST_WEEK].push(chat);
      } else if (chatDate > oneMonthAgo) {
        if (!groups[ChatGroupPeriod.LAST_MONTH]) groups[ChatGroupPeriod.LAST_MONTH] = [];
        groups[ChatGroupPeriod.LAST_MONTH].push(chat);
      } else {
        if (!groups[ChatGroupPeriod.OLDER]) groups[ChatGroupPeriod.OLDER] = [];
        groups[ChatGroupPeriod.OLDER].push(chat);
      }

      return groups;
    },
    {} as GroupedChats,
  );
}

// group chats by time period
export function useGroupedChatsQuery() {
  const { data, ...rest } = useChatsQuery();
  const allChats = React.useMemo(() => data?.pages.flat() || [], [data]);

  const groupedChats: GroupedChats = React.useMemo(() => groupChatsByTimePeriod(allChats), [allChats]);
  return {
    ...rest,
    data: groupedChats,
  }
}