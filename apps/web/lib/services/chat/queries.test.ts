import { describe, expect, it } from "vitest";
import {
  chatMessagesQueryOptions,
  chatQueryKeys,
  ChatGroupPeriod,
  groupChatsByTimePeriod,
} from "./queries";

describe("groupChatsByTimePeriod", () => {
  it("groups chats by updatedAt from the api response shape", () => {
    const today = new Date();
    const oldCreatedAt = new Date(today);
    oldCreatedAt.setMonth(today.getMonth() - 2);

    const grouped = groupChatsByTimePeriod([
      {
        id: "chat-1",
        title: "Updated today",
        visibility: "private",
        createdAt: oldCreatedAt.toISOString(),
        updatedAt: today.toISOString(),
      },
    ]);

    expect(grouped[ChatGroupPeriod.TODAY]?.map((chat) => chat.id)).toEqual([
      "chat-1",
    ]);
  });
});

describe("chat message query options", () => {
  it("routes chat message history through a chat-scoped React Query key", () => {
    const options = chatMessagesQueryOptions("chat-1");

    expect(options.queryKey).toEqual(chatQueryKeys.messages("chat-1"));
  });
});
