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
 * is correct GIVEN a properly hydrated cache and a settled (non-errored)
 * compaction query. Two things were fixed anyway: (1) the compaction query
 * never invalidated after a turn completed, so a compaction landing
 * mid-conversation stayed invisible until a full reload — scoped to the
 * genuine-completion path only, NOT the abort/disconnect/error teardown path
 * also driven through onFinish, since an aborted/errored turn is not "a turn
 * completed" and compaction can't have fired from it (an earlier attempt
 * that also fired it on that path landed on a CI run where a sibling
 * resume-race e2e failed — the identical failure also occurs on `master`
 * itself, run 28795533447, predating this branch, so it's a pre-existing
 * AI SDK resume flake, NOT something this coupling caused; the scoping is
 * kept anyway because it's the semantically correct behavior regardless);
 * (2) `useChatCompactionQuery`'s `data` was destructured without `error` —
 * a fetch that ERRORS (network blip, transient 5xx, a race with auth) left
 * `compaction` silently undefined, indistinguishable from "no compaction
 * exists" and logged nowhere. That silent-failure path remains the leading
 * but UNCONFIRMED explanation for the original report (a 204-message chat
 * has `displayMessages.length > 0` regardless, so the query was already
 * enabled) — this doesn't fix it, but it stops it from being invisible.
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
        name: /context compacted/i,
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
        name: /context compacted/i,
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
        name: /context compacted/i,
      }),
    ).toBeTruthy();
  });

  it("gates the compaction fetch on there being loaded messages to show it against", () => {
    const chatId = "chat-no-messages-yet";
    useChatMessages = [];

    renderChatPage(chatId, {
      messages: [],
      compaction: {
        uptoSeq: 5,
        summary: "Old turns summarized.",
        createdAt: "2026-07-06T00:00:00.000Z",
      },
    });

    expect(useChatCompactionQuerySpy).toHaveBeenCalledWith(chatId, false);
  });

  it("invalidates the compaction query only on a genuinely completed turn — NOT on the abort/disconnect/error teardown path a reload takes (an aborted turn isn't a completed one; compaction can't have fired from it)", () => {
    const chatId = "chat-mid-session-compaction-abort";
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
    capturedOnFinish?.({ isAbort: true });

    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: chatQueryKeys.compaction(chatId) }),
    );
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
