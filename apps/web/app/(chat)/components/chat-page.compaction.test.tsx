// @vitest-environment jsdom

/**
 * Renders the ACTUAL ChatPage against a pre-seeded QueryClient (mirroring
 * what SSR hydration provides on a real reload) with a real
 * useChatMessagesQuery — only the AI SDK's useChat and next/navigation are
 * mocked, to isolate the render wiring without needing a live
 * network/transport.
 *
 * #136 read-side merge: compaction is no longer a separate query/cache
 * entry — it arrives embedded in the SAME `chatQueryKeys.messages(chatId)`
 * cache entry as `{ messages, compaction }` (`ChatHistory`, history.ts).
 * This also closes the "silent second-fetch failure" gap from the earlier
 * owner-reported render bug: there is now exactly one fetch, so "the fetch
 * failed" and "no compaction exists" can no longer be confused with each
 * other the way a separate, independently-erroring query could.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

const routerMock = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));
// ChatSessionContent reads trackRun/untrackChat/markChatSeen from this
// context; stub it out so this render-focused suite doesn't need a real
// ActiveRunsProvider (its own polling/fetch effects are out of scope here).
vi.mock("@/contexts/active-runs-context", () => ({
  useActiveRuns: () => ({
    trackRun: vi.fn(),
    untrackChat: vi.fn(),
    completedChats: new Set<string>(),
    markChatSeen: vi.fn(),
  }),
}));

let useChatMessages: Array<{
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
  metadata?: { seq?: number; usage?: Record<string, unknown> };
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

import { ChatProvider } from "@/contexts/chat-context";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import { modelQueryKeys } from "@/lib/services/models/queries";
import {
  toChatUiMessages,
  type ChatMessageResponse,
  type Compaction,
  type CompactionStats,
} from "@/lib/services/chat/history";

import { ChatPage } from "./chat-page";

const NO_STATS: CompactionStats = {
  absorbedMessageCount: null,
  beforeTokens: null,
  afterTokens: null,
  modelId: null,
};

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
  cleanup();
});

function renderChatPage(
  chatId: string,
  seed: { messages: typeof useChatMessages; compaction: Compaction | null },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Seed the SAME combined cache entry SSR hydration provides on a real
  // reload (#136: one entry, `{ messages, compaction }`, not two) — BEFORE
  // the component (and its useQuery observer) ever mounts, same timing as
  // HydrationBoundary.
  queryClient.setQueryData(chatQueryKeys.messages(chatId), {
    messages: seed.messages,
    compaction: seed.compaction,
  });
  queryClient.setQueryData(modelQueryKeys.all, {
    defaultModelId: "system:openai:gpt-5.4-mini",
    models: [
      {
        id: "system:openai:gpt-5.4-mini",
        source: "system",
        name: "GPT-5.4 mini",
      },
    ],
  });

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

describe("ChatPage — compaction checkpoint render", () => {
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
        stats: NO_STATS,
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
        stats: NO_STATS,
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
        stats: NO_STATS,
      },
    });

    expect(
      screen.getByRole("button", {
        name: /context compacted/i,
      }),
    ).toBeTruthy();
  });

  it("reload parity: a compaction present in the RAW api-shaped messages payload (the real toChatUiMessages mapping, not a hand-shaped fixture) still renders after being routed through the same cache seeding a real reload uses", () => {
    const chatId = "chat-reload-parity";
    const rawMessages: ChatMessageResponse[] = [
      {
        id: "m1",
        chatId,
        seq: 1,
        role: "user",
        senderUserId: "user-1",
        parts: [{ type: "text", text: "hi" }],
        attachments: [],
        usage: null,
        inReplyTo: null,
        createdAt: "2026-07-06T00:00:00.000Z",
      },
      {
        id: "m2",
        chatId,
        seq: 2,
        role: "assistant",
        senderUserId: null,
        parts: [{ type: "text", text: "hello" }],
        attachments: [],
        usage: null,
        inReplyTo: "m1",
        createdAt: "2026-07-06T00:00:01.000Z",
      },
    ];
    const mappedMessages = toChatUiMessages({ messages: rawMessages });
    useChatMessages = mappedMessages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      parts: m.parts,
      metadata: m.metadata as { seq?: number } | undefined,
    }));

    renderChatPage(chatId, {
      messages: useChatMessages,
      compaction: {
        uptoSeq: 1,
        summary: "Absorbed the first turn.",
        createdAt: "2026-07-06T00:00:00.000Z",
        stats: NO_STATS,
      },
    });

    expect(
      screen.getByRole("button", { name: /context compacted/i }),
    ).toBeTruthy();
  });

  it("invalidates the chat messages query (which now carries compaction embedded) on a finished turn, so a compaction landing mid-conversation doesn't require a reload", () => {
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
      expect.objectContaining({ queryKey: chatQueryKeys.messages(chatId) }),
    );
  });
});

describe("ChatPage — model context transparency", () => {
  it("places the trusted switch boundary immediately before its triggering user message", () => {
    const chatId = "chat-model-switch";
    const runId = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";
    useChatMessages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Earlier answer" }],
        metadata: { seq: 1 },
      },
      {
        id: "m2",
        role: "user",
        // The live useChat copy does not contain server-authored metadata.
        parts: [{ type: "text", text: "Triggering request" }],
        metadata: { seq: 2 },
      },
    ];
    const authoritativeMessages = [
      useChatMessages[0]!,
      {
        ...useChatMessages[1]!,
        parts: [
          {
            type: "data-model-context",
            data: {
              kind: "model_switch",
              fromModelId: "model-a",
              toModelId: "model-b",
              runId,
            },
          },
          { type: "text", text: "Triggering request" },
        ],
      },
    ];

    renderChatPage(chatId, {
      messages: authoritativeMessages,
      compaction: null,
    });

    const switchTrigger = screen.getByRole("button", {
      name: "Model changed from model-a to model-b",
    });
    const userText = screen.getByText("Triggering request");
    expect(
      switchTrigger.compareDocumentPosition(userText) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.queryByText(/unsupported part type/i)).toBeNull();
  });

  it("shows a run receipt action on a same-model assistant turn without inventing a switch boundary", () => {
    const chatId = "chat-same-model";
    useChatMessages = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "Same model request" }],
        metadata: { seq: 1 },
      },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "Same model answer" }],
        metadata: {
          seq: 2,
          usage: { runId: "a5dc235e-1de8-4aad-84d8-e0e247b6a135" },
        },
      },
    ];

    renderChatPage(chatId, {
      messages: useChatMessages,
      compaction: null,
    });

    expect(
      screen.getByRole("button", { name: "Effective context" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /model changed from/i }),
    ).toBeNull();
  });
});
