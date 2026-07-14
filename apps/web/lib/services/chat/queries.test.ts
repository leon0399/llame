import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatHistory } from "./history";
import {
  type ChatResponse,
  chatMessagesQueryOptions,
  chatQueryKeys,
  ChatGroupPeriod,
  groupChatsByTimePeriod,
  seedChatMessagesQueryData,
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
        lastMessage: null,
        projectId: null,
        archivedAt: null,
      },
    ]);

    expect(grouped[ChatGroupPeriod.TODAY]?.map((chat) => chat.id)).toEqual([
      "chat-1",
    ]);
  });

  it("routes chats in the caller's pinned set to the Pinned group, not their time group", () => {
    const today = new Date();
    const grouped = groupChatsByTimePeriod(
      [
        {
          id: "pinned-today",
          title: "Pinned",
          visibility: "private",
          createdAt: today.toISOString(),
          updatedAt: today.toISOString(),
          lastMessage: null,
          projectId: null,
          archivedAt: null,
        },
        {
          id: "plain-today",
          title: "Plain",
          visibility: "private",
          createdAt: today.toISOString(),
          updatedAt: today.toISOString(),
          lastMessage: null,
          projectId: null,
          archivedAt: null,
        },
      ],
      // Pins is the sole source of pin state (design D5) — membership here,
      // not a field on the chat, routes it into the Pinned group.
      new Map([["pinned-today", today.toISOString()]]),
    );

    expect(grouped[ChatGroupPeriod.PINNED]?.map((c) => c.id)).toEqual([
      "pinned-today",
    ]);
    // The pinned chat must NOT also appear under Today.
    expect(grouped[ChatGroupPeriod.TODAY]?.map((c) => c.id)).toEqual([
      "plain-today",
    ]);
  });

  it("orders the Pinned group by pin recency, not by the chats' own updatedAt order", () => {
    const now = new Date();
    const older = new Date(now.getTime() - 60_000);
    const chat = (id: string, updatedAt: Date): ChatResponse => ({
      id,
      title: id,
      visibility: "private",
      createdAt: updatedAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      lastMessage: null,
      projectId: null,
      archivedAt: null,
    });

    // "recently-updated" has the NEWER updatedAt but was pinned LONGER ago
    // than "stale-but-just-pinned" — the Pinned group must order by pin
    // time, not chat recency.
    const grouped = groupChatsByTimePeriod(
      [chat("recently-updated", now), chat("stale-but-just-pinned", older)],
      new Map([
        ["recently-updated", older.toISOString()],
        ["stale-but-just-pinned", now.toISOString()],
      ]),
    );

    expect(grouped[ChatGroupPeriod.PINNED]?.map((c) => c.id)).toEqual([
      "stale-but-just-pinned",
      "recently-updated",
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
      return new Response(JSON.stringify({ messages: [], compaction: null }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const options = chatMessagesQueryOptions("closed-over-chat");
    const queryFn = options.queryFn as (context: {
      queryKey: ReturnType<typeof chatQueryKeys.messages>;
      signal?: AbortSignal;
    }) => Promise<ChatHistory>;
    const abortController = new AbortController();

    await queryFn({
      queryKey: chatQueryKeys.messages("query-key-chat"),
      signal: abortController.signal,
    });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();

    const [request, init] = firstCall!;
    const requestUrl =
      request instanceof Request ? request.url : String(request);
    const requestSignal =
      request instanceof Request ? request.signal : init?.signal;

    expect(requestUrl).toBe(
      "http://localhost:3001/api/v1/chats/query-key-chat/messages?limit=100",
    );
    expect(requestSignal?.aborted).toBe(false);

    abortController.abort();

    expect(requestSignal?.aborted).toBe(true);
  });

  it("overwrites stale chat message cache with SSR-provided messages", () => {
    const queryClient = new QueryClient();
    const staleHistory = {
      messages: [
        {
          id: "stale",
          role: "assistant",
          parts: [{ type: "text", text: "old" }],
        },
      ],
      compaction: null,
    } satisfies ChatHistory;
    const serverHistory = {
      messages: [
        {
          id: "server",
          role: "assistant",
          parts: [{ type: "text", text: "fresh" }],
        },
      ],
      compaction: null,
    } satisfies ChatHistory;

    queryClient.setQueryData(chatQueryKeys.messages("chat-1"), staleHistory);

    seedChatMessagesQueryData(queryClient, "chat-1", serverHistory);

    expect(queryClient.getQueryData(chatQueryKeys.messages("chat-1"))).toEqual(
      serverHistory,
    );
  });
});
