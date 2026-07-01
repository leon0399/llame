import { useInfiniteQuery } from "@tanstack/react-query";
import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import React from "react";
import { api, buildApiUrl } from "../../api/client";

export type ChatResponse = {
  id: string;
  title: string;
  visibility: "private" | "public";
  createdAt: string;
  updatedAt: string;
};

export const chatQueryKeys = {
  infinite: ["infinite-chats"] as const,
};

export const fetchChats = () =>
  api.get(buildApiUrl("/api/v1/chats")).json<ChatResponse[]>();

export function useChatsQuery() {
  const query = useInfiniteQuery({
    queryKey: chatQueryKeys.infinite,
    queryFn: fetchChats,
    initialPageParam: undefined,
    getNextPageParam: () => undefined,
  });

  return {
    ...query,
    hasData: query.data?.pages.every((page) => page.length > 0),
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
