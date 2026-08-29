import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messageSeqFromMetadata, type ChatMessagesResponse } from "./history";
import { rawChatMessage } from "./message-fixtures";

const { getChatMessages, listChats } = vi.hoisted(() => ({
  getChatMessages: vi.fn(),
  listChats: vi.fn(),
}));

vi.mock("../../api/generated/chats/chats", () => ({
  getChatMessages,
  listChats,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: () => vi.fn(),
}));

import {
  type ChatResponse,
  chatMessagesQueryOptions,
  chatQueryKeys,
  ChatGroupPeriod,
  groupChatsByTimePeriod,
  isChatHistoryMissing,
  olderPageParam,
  seedChatMessagesQueryData,
  toChatHistory,
} from "./queries";

function generatedApiError(
  status: number,
): Error & { status: number; info: unknown } {
  const error = new Error(`HTTP ${status}`) as Error & {
    status: number;
    info: unknown;
  };
  error.status = status;
  error.info = {};
  return error;
}

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

  it("groups chats by time period even when they have the same updatedAt", () => {
    const now = new Date();
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

    const grouped = groupChatsByTimePeriod([
      // 5 days ago falls into LAST_WEEK (between 1 and 7 days ago)
      chat("older", new Date(now.getTime() - 60_000 * 60 * 24 * 5)),
      chat("recent", now),
    ]);

    expect(grouped[ChatGroupPeriod.TODAY]?.map((c) => c.id)).toEqual([
      "recent",
    ]);
    expect(grouped[ChatGroupPeriod.LAST_WEEK]?.map((c) => c.id)).toEqual([
      "older",
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
    expect(chatQueryKeys.targetMessages("chat-1", 9007199254740991)).toEqual([
      "chats",
      "chat-1",
      "messages",
      "target",
      9007199254740991,
    ]);
    expect(JSON.stringify(chatQueryKeys.targetMessages("chat-1", 42))).toBe(
      '["chats","chat-1","messages","target",42]',
    );
  });

  it("keeps target history in a distinct cache identity", () => {
    const queryClient = new QueryClient();
    const ordinary = {
      pages: [messagesPage([{ id: "new", seq: 900, text: "new" }])],
      pageParams: [null],
    };
    const target = {
      pages: [messagesPage([{ id: "old", seq: 42, text: "old" }])],
      pageParams: [null],
    };

    queryClient.setQueryData(chatQueryKeys.messages("chat-1"), ordinary);
    queryClient.setQueryData(
      chatQueryKeys.targetMessages("chat-1", 42),
      target,
    );

    expect(chatQueryKeys.targetMessages("chat-1", 42)).not.toEqual(
      chatQueryKeys.messages("chat-1"),
    );
    expect(queryClient.getQueryData(chatQueryKeys.messages("chat-1"))).toBe(
      ordinary,
    );
    expect(
      queryClient.getQueryData(chatQueryKeys.targetMessages("chat-1", 42)),
    ).toBe(target);
  });

  it("routes chat message history through a chat-scoped React Query key", () => {
    const options = chatMessagesQueryOptions("chat-1");

    expect(options.queryKey).toEqual(chatQueryKeys.messages("chat-1"));
    expect(
      chatMessagesQueryOptions("chat-1", { targetSeq: 42 }).queryKey,
    ).toEqual(chatQueryKeys.targetMessages("chat-1", 42));
  });

  it("leaves ordinary message queries on TanStack's default retry behavior", () => {
    const options = chatMessagesQueryOptions("chat-1");

    expect(options.retry).toBeUndefined();
  });

  it("retries only owner-scoped 404 history failures within a bounded budget", () => {
    const options = chatMessagesQueryOptions("chat-1", {
      recoverSentDraft: true,
    });

    const retry = options.retry;
    if (typeof retry !== "function") {
      throw new Error("sent-draft recovery must expose a retry predicate");
    }

    const missing = generatedApiError(404);
    expect(retry(0, missing)).toBe(true);
    expect(retry(1, missing)).toBe(true);
    expect(retry(2, missing)).toBe(false);
    expect(retry(0, generatedApiError(401))).toBe(false);
    expect(retry(0, generatedApiError(500))).toBe(false);
    expect(retry(0, new Error("network failure"))).toBe(false);
    expect(options).not.toHaveProperty("retryDelay");
    expect(options).not.toHaveProperty("refetchInterval");
  });

  it.each([
    [404, true],
    [401, false],
    [500, false],
  ])(
    "classifies generated HTTP status %s as history absence: %s",
    (status, expected) => {
      expect(isChatHistoryMissing(generatedApiError(status))).toBe(expected);
    },
  );

  it.each([new Error("network failure"), undefined, null, "not an error", {}])(
    "does not classify non-HTTP errors as history absence: %s",
    (error) => {
      expect(isChatHistoryMissing(error)).toBe(false);
    },
  );

  it("derives the chat message request from the query function context", async () => {
    getChatMessages.mockResolvedValue({ messages: [], compaction: null });

    const options = chatMessagesQueryOptions("closed-over-chat");
    const queryFn = options.queryFn as (context: {
      queryKey: ReturnType<typeof chatQueryKeys.messages>;
      pageParam: number | null;
      signal?: AbortSignal;
    }) => Promise<ChatMessagesResponse>;
    const abortController = new AbortController();

    await queryFn({
      queryKey: chatQueryKeys.messages("query-key-chat"),
      pageParam: null,
      signal: abortController.signal,
    });

    expect(getChatMessages).toHaveBeenCalledWith(
      "query-key-chat",
      { limit: 100 },
      { signal: abortController.signal },
      expect.any(Function),
    );

    await queryFn({
      queryKey: chatQueryKeys.messages("query-key-chat"),
      pageParam: 250,
      signal: abortController.signal,
    });

    expect(getChatMessages).toHaveBeenLastCalledWith(
      "query-key-chat",
      { limit: 100, beforeSeq: 250 },
      { signal: abortController.signal },
      expect.any(Function),
    );
  });

  it("requests a target window on page zero and uses only beforeSeq afterwards", async () => {
    getChatMessages.mockResolvedValue({ messages: [], compaction: null });

    const options = chatMessagesQueryOptions("closed-over-chat", {
      targetSeq: 700,
    });
    const queryFn = options.queryFn as (context: {
      queryKey: ReturnType<typeof chatQueryKeys.targetMessages>;
      pageParam: number | null;
      signal?: AbortSignal;
    }) => Promise<ChatMessagesResponse>;
    const abortController = new AbortController();

    await queryFn({
      queryKey: chatQueryKeys.targetMessages("query-key-chat", 900),
      pageParam: null,
      signal: abortController.signal,
    });

    expect(getChatMessages).toHaveBeenCalledWith(
      "query-key-chat",
      { limit: 100, targetSeq: 900 },
      { signal: abortController.signal },
      expect.any(Function),
    );

    await queryFn({
      queryKey: chatQueryKeys.targetMessages("query-key-chat", 900),
      pageParam: 701,
      signal: abortController.signal,
    });

    expect(getChatMessages).toHaveBeenLastCalledWith(
      "query-key-chat",
      { limit: 100, beforeSeq: 701 },
      { signal: abortController.signal },
      expect.any(Function),
    );
  });

  it("overwrites stale chat message cache with the SSR-provided newest page", () => {
    const queryClient = new QueryClient();
    const stalePage = messagesPage([{ id: "stale", seq: 1, text: "old" }]);
    const serverPage = messagesPage([{ id: "server", seq: 2, text: "fresh" }]);

    queryClient.setQueryData(chatQueryKeys.messages("chat-1"), {
      pages: [stalePage],
      pageParams: [null],
    });

    seedChatMessagesQueryData(queryClient, "chat-1", serverPage);

    expect(queryClient.getQueryData(chatQueryKeys.messages("chat-1"))).toEqual({
      pages: [serverPage],
      pageParams: [null],
    });
  });
});

function messagesPage(
  rows: { id: string; seq: number; text: string }[],
): ChatMessagesResponse {
  return {
    messages: rows.map(({ id, seq, text }) =>
      rawChatMessage({ id, seq, parts: [{ type: "text" as const, text }] }),
    ),
    compaction: null,
  };
}

describe("olderPageParam", () => {
  const fullPage = (oldestSeq: number) => ({
    messages: Array.from({ length: 100 }, (_, index) => ({
      seq: oldestSeq + index,
    })),
  });

  it("follows the page's oldest seq as the next beforeSeq cursor", () => {
    expect(olderPageParam(fullPage(101), null)).toBe(101);
    expect(olderPageParam(fullPage(101), 201)).toBe(101);
  });

  it("stops at a short page — the chat start was reached", () => {
    expect(olderPageParam({ messages: [{ seq: 5 }] }, null)).toBeUndefined();
    expect(olderPageParam({ messages: [] }, null)).toBeUndefined();
  });

  it("stops when the page already holds the chat's first message", () => {
    expect(olderPageParam(fullPage(1), 101)).toBeUndefined();
  });

  it("stops on a non-advancing cursor instead of refetching forever", () => {
    expect(olderPageParam(fullPage(101), 101)).toBeUndefined();
    expect(olderPageParam(fullPage(101), 42)).toBeUndefined();
  });
});

describe("toChatHistory", () => {
  it("flattens pages oldest-first and reads compaction from the newest page", () => {
    const newest = {
      ...messagesPage([
        { id: "m3", seq: 3, text: "three" },
        { id: "m4", seq: 4, text: "four" },
      ]),
      compaction: {
        uptoSeq: 2,
        summary: "earlier turns",
        createdAt: "2026-01-01T00:00:00.000Z",
        stats: {
          absorbedMessageCount: null,
          beforeTokens: null,
          afterTokens: null,
          modelId: null,
        },
      },
    };
    const older = messagesPage([
      { id: "m1", seq: 1, text: "one" },
      { id: "m2", seq: 2, text: "two" },
    ]);

    const history = toChatHistory({
      pages: [newest, older],
      pageParams: [null, 3],
    });

    expect(history.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(history.compaction).toBe(newest.compaction);
  });

  it("truncates at a page that failed to advance instead of flattening duplicates", () => {
    // TanStack commits a fetched page before getNextPageParam can reject it;
    // a server that ignored beforeSeq must not surface overlapping rows.
    const newest = messagesPage([
      { id: "m3", seq: 3, text: "three" },
      { id: "m4", seq: 4, text: "four" },
    ]);
    const overlapping = messagesPage([
      { id: "m3", seq: 3, text: "three" },
      { id: "m4", seq: 4, text: "four" },
    ]);

    const history = toChatHistory({
      pages: [newest, overlapping],
      pageParams: [null, 3],
    });

    expect(history.messages.map((message) => message.id)).toEqual(["m3", "m4"]);
  });

  it("keeps a target-ended page chronological and uses its compaction snapshot", () => {
    const targetPage = {
      ...messagesPage([
        { id: "m701", seq: 701, text: "older" },
        { id: "m900", seq: 900, text: "target" },
      ]),
      compaction: {
        uptoSeq: 700,
        summary: "before target",
        createdAt: "2026-01-01T00:00:00.000Z",
        stats: {
          absorbedMessageCount: null,
          beforeTokens: null,
          afterTokens: null,
          modelId: null,
        },
      },
    };

    const history = toChatHistory({
      pages: [targetPage],
      pageParams: [null],
    });

    expect(
      history.messages.map((message) =>
        messageSeqFromMetadata(message.metadata),
      ),
    ).toEqual([701, 900]);
    expect(history.compaction).toBe(targetPage.compaction);
  });
});
