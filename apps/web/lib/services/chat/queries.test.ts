import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses resource-path query keys for chat lists and messages", () => {
    expect(chatQueryKeys.all).toEqual(["chats"]);
    expect(chatQueryKeys.lists()).toEqual(["chats", "list"]);
    expect(chatQueryKeys.infinite()).toEqual(["chats", "list", "infinite"]);
    expect(chatQueryKeys.detail("chat-1")).toEqual(["chats", "chat-1"]);
    expect(chatQueryKeys.messages("chat-1")).toEqual([
      "chats",
      "chat-1",
      "messages",
    ]);
  });

  it("routes chat message history through a chat-scoped React Query key", () => {
    const options = chatMessagesQueryOptions("chat-1");

    expect(options.queryKey).toEqual(chatQueryKeys.messages("chat-1"));
  });

  it("derives the chat message request from the query function context", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ messages: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const options = chatMessagesQueryOptions("closed-over-chat");
    const queryFn = options.queryFn as (context: {
      queryKey: ReturnType<typeof chatQueryKeys.messages>;
    }) => Promise<unknown[]>;

    await queryFn({ queryKey: chatQueryKeys.messages("query-key-chat") });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();

    const [request] = firstCall!;
    const requestUrl =
      request instanceof Request ? request.url : String(request);

    expect(requestUrl).toBe(
      "http://localhost:3001/api/v1/chats/query-key-chat/messages",
    );
  });
});
