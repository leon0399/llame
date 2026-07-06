// @vitest-environment jsdom

/**
 * Reproduction for the owner-reported bug: a real compaction exists
 * (server logs it, GET /chats/:id/compaction returns it) but the Checkpoint
 * never renders on a real chat page. Renders the ACTUAL ChatPage against a
 * pre-seeded QueryClient (mirroring what SSR hydration provides on a real
 * reload) with real useChatMessagesQuery/useChatCompactionQuery — only the
 * AI SDK's useChat and next/navigation are mocked, to isolate the render
 * wiring without needing a live network/transport.
 *
 * Could not reproduce a render failure this way against the current merged
 * code (three boundary-position cases below all pass) — the render pipeline
 * is correct GIVEN a properly hydrated cache. Two real, independently-found
 * issues were fixed anyway and are pinned here: (1) the compaction query's
 * `enabled` flag was derived from useChat's OWN `messages` snapshot, which
 * the AI SDK only re-syncs from the `messages` prop at construction (verified
 * against the installed @ai-sdk/react source — `useRef(new Chat(options))`,
 * `shouldRecreateChat` only trips on an `id` change) — a fragile dependency
 * now replaced with the authoritative `resume` prop; (2) the compaction
 * query never invalidated after a turn completes, so a compaction landing
 * mid-conversation stayed invisible until a full reload.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

const routerMock = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

let useChatMessages: Array<{
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
  metadata?: { seq?: number };
}> = [];

type OnFinishArg = {
  isAbort?: boolean;
  isDisconnect?: boolean;
  isError?: boolean;
};
let capturedOnFinish: ((arg: OnFinishArg) => void) | undefined;

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { onFinish?: (arg: OnFinishArg) => void }) => {
    capturedOnFinish = options.onFinish;
    return {
      messages: useChatMessages,
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
      error: undefined,
    };
  },
}));

vi.mock("@/lib/services/chat/compaction", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/chat/compaction")>();
  return {
    ...actual,
    useChatCompactionQuery: vi.fn(actual.useChatCompactionQuery),
  };
});

import { ChatProvider } from "@/contexts/chat-context";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import { useChatCompactionQuery } from "@/lib/services/chat/compaction";

import { ChatPage } from "./chat-page";

const useChatCompactionQuerySpy = vi.mocked(useChatCompactionQuery);

beforeAll(() => {
  // jsdom doesn't implement the Pointer Events capture API Radix's Dialog
  // relies on for open/close + focus handling (CompactionBoundary's modal).
  for (const method of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        value: () => false,
        writable: true,
      });
    }
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // jsdom doesn't implement ResizeObserver, which the chat container's
  // use-stick-to-bottom scroll tracking relies on.
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (
      globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
    ).ResizeObserver = ResizeObserverStub;
  }
});

afterEach(() => {
  useChatMessages = [];
  capturedOnFinish = undefined;
  useChatCompactionQuerySpy.mockClear();
  cleanup();
});

function renderChatPage(
  chatId: string,
  seed: { messages: typeof useChatMessages; compaction: unknown },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Seed the caches the way SSR hydration + a settled compaction query would
  // — BEFORE the component (and its useQuery observers) ever mounts, same
  // timing as HydrationBoundary providing SSR data on a real page reload.
  queryClient.setQueryData(chatQueryKeys.messages(chatId), seed.messages);
  queryClient.setQueryData(chatQueryKeys.compaction(chatId), seed.compaction);

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ChatProvider>
          <ChatPage chatId={chatId} />
        </ChatProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("ChatPage — compaction checkpoint render (bug repro)", () => {
  it("renders the checkpoint when the chat history + compaction are both already cached (mirrors a real SSR-hydrated reload)", () => {
    const chatId = "chat-bbc4f06e";
    useChatMessages = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
        metadata: { seq: 1 },
      },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
        metadata: { seq: 2 },
      },
      {
        id: "m3",
        role: "user",
        parts: [{ type: "text", text: "more" }],
        metadata: { seq: 3 },
      },
    ];

    renderChatPage(chatId, {
      messages: useChatMessages,
      compaction: {
        uptoSeq: 2,
        summary: "The user said hi, assistant replied hello.",
        createdAt: "2026-07-06T00:00:00.000Z",
      },
    });

    expect(
      screen.getByRole("button", {
        name: /earlier messages summarized for context/i,
      }),
    ).toBeTruthy();
  });

  it("renders the checkpoint at the TOP when the loaded window is entirely post-boundary", () => {
    const chatId = "chat-top-case";
    useChatMessages = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
        metadata: { seq: 50 },
      },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
        metadata: { seq: 51 },
      },
    ];

    renderChatPage(chatId, {
      messages: useChatMessages,
      compaction: {
        uptoSeq: 10,
        summary: "Old turns summarized.",
        createdAt: "2026-07-06T00:00:00.000Z",
      },
    });

    expect(
      screen.getByRole("button", {
        name: /earlier messages summarized for context/i,
      }),
    ).toBeTruthy();
  });

  it("renders the checkpoint at the BOTTOM when every loaded message is within the summarized span (Leo's reported scenario: uptoSeq near the end of a long history)", () => {
    const chatId = "chat-bbc4f06e";
    useChatMessages = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "turn 200" }],
        metadata: { seq: 200 },
      },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "turn 201" }],
        metadata: { seq: 201 },
      },
      {
        id: "m3",
        role: "user",
        parts: [{ type: "text", text: "turn 202" }],
        metadata: { seq: 202 },
      },
    ];

    renderChatPage(chatId, {
      messages: useChatMessages,
      compaction: {
        uptoSeq: 202,
        summary: "Compacted up to seq 202.",
        createdAt: "2026-07-06T00:00:00.000Z",
      },
    });

    expect(
      screen.getByRole("button", {
        name: /earlier messages summarized for context/i,
      }),
    ).toBeTruthy();
  });

  it("keeps the compaction query enabled off the authoritative `resume` prop, not useChat's own (possibly stale) messages snapshot", () => {
    const chatId = "chat-not-yet-synced";
    // Simulate useChat's internal messages NOT yet reflecting the loaded
    // history (the AI SDK only re-syncs its `messages` snapshot from the
    // `messages` prop at construction or on an `id` change — see the file
    // header). Under the old `displayMessages.length > 0` gate, this alone
    // would have permanently disabled the compaction fetch for this chat.
    useChatMessages = [];

    renderChatPage(chatId, {
      messages: [],
      compaction: {
        uptoSeq: 5,
        summary: "Old turns summarized.",
        createdAt: "2026-07-06T00:00:00.000Z",
      },
    });

    expect(useChatCompactionQuerySpy).toHaveBeenCalledWith(chatId, true);
  });

  it("invalidates the compaction query on every finished turn, so a compaction landing mid-conversation doesn't require a reload", async () => {
    const chatId = "chat-mid-session-compaction";
    useChatMessages = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
        metadata: { seq: 1 },
      },
    ];

    const { queryClient } = renderChatPage(chatId, {
      messages: useChatMessages,
      compaction: null,
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    expect(capturedOnFinish).toBeDefined();
    capturedOnFinish?.({});

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: chatQueryKeys.compaction(chatId) }),
    );
  });
});
