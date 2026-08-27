// @vitest-environment jsdom

/**
 * Renders the ACTUAL ChatPage against a pre-seeded QueryClient (mirroring
 * what SSR hydration provides on a real reload) with a real
 * useChatMessagesQuery. The AI SDK's useChat, next/navigation, and the
 * deferred markdown renderer are mocked to isolate the render wiring without
 * needing a live network/transport or loading the renderer's plugin graph.
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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

const routerMock = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));
vi.mock("@workspace/ui/components/ai-elements/message-response", () => ({
  MessageResponse: ({ children }: { children: string }) => children,
}));
// ChatSessionContent reads trackRun/untrackChat/markChatSeen from this
// context; stub it out so this render-focused suite doesn't need a real
// ActiveRunsProvider (its own polling/fetch effects are out of scope here).
vi.mock("@/contexts/active-runs-context", () => ({
  useActiveRuns: () => ({
    trackRun: vi.fn(),
    untrackChat: vi.fn(),
    registerViewedChat: vi.fn(() => () => {}),
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
let capturedResume: boolean | undefined;

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: {
    onFinish?: (arg: OnFinishArg) => void;
    resume?: boolean;
  }) => {
    capturedOnFinish = options.onFinish;
    capturedResume = options.resume;
    return {
      messages: useChatMessages,
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
      error: undefined,
      // ChatPage drives resume itself (guarded against Strict Mode's double
      // mount effect — see its useChat call), so the stub must provide it.
      resumeStream: vi.fn(),
    };
  },
}));

import { ChatProvider } from "@/contexts/chat-context";
import { rawChatMessage } from "@/lib/services/chat/message-fixtures";
import {
  chatQueryKeys,
  seedChatMessagesQueryData,
} from "@/lib/services/chat/queries";
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
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverStub {
        constructor(_callback: ResizeObserverCallback) {}
        observe(_target: Element, _options?: ResizeObserverOptions): void {}
        unobserve(_target: Element): void {}
        disconnect(): void {}
      },
    );
  }
});

afterEach(() => {
  useChatMessages = [];
  capturedOnFinish = undefined;
  capturedResume = undefined;
  cleanup();
});

function renderChatPage(
  chatId: string,
  seed: { messages: typeof useChatMessages; compaction: Compaction | null },
  targetSeq?: number,
  historyMessages = seed.messages,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Seed the SAME cache entry SSR hydration provides on a real reload —
  // BEFORE the component (and its query observer) ever mounts, same timing
  // as HydrationBoundary. The entry is the paginated raw-page shape (#187:
  // one seeded newest page; compaction embedded per #136), routed through
  // the one seeding helper the real page.tsx uses, so this test cannot
  // drift from the production cache shape.
  const page = {
    messages: historyMessages.map((message, index) =>
      rawChatMessage({
        id: message.id,
        chatId,
        seq: message.metadata?.seq ?? index + 1,
        role: message.role,
        parts: message.parts as ChatMessageResponse["parts"],
        usage: (message.metadata?.usage ??
          null) as ChatMessageResponse["usage"],
      }),
    ),
    compaction: seed.compaction,
  };
  seedChatMessagesQueryData(queryClient, chatId, page);
  if (targetSeq !== undefined) {
    queryClient.setQueryData(chatQueryKeys.targetMessages(chatId, targetSeq), {
      pages: [page],
      pageParams: [null],
    });
  }
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
          <ChatPage
            chatId={chatId}
            initialChatExists
            initialDraftPhase={null}
          />
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
  it("places the trusted switch boundary immediately before its triggering user message", async () => {
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
            type: "data-context",
            data: {
              v: 1,
              producer: "effective-context-change",
              form: "notice",
              runId,
              payload: {
                cause: "model",
                fromModelId: "model-a",
                toModelId: "model-b",
              },
              text: '<system-reminder producer="effective-context-change" form="notice">model changed</system-reminder>',
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
    const userText = await screen.findByText("Triggering request");
    expect(
      switchTrigger.compareDocumentPosition(userText) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.queryByText(/unsupported part type/i)).toBeNull();
  });

  // Server-authored context parts are persisted on the user message and come
  // back through the messages API, so the transcript sees every one of them.
  // A part type with no case falls through to the "unsupported part type"
  // span — literal debug text in the owner's chat. Every producer now shares
  // one part type, so one branch covers the whole family INCLUDING a producer
  // this build does not know about, which is what the last case pins.
  it("renders no visible content for server-authored context parts", () => {
    const chatId = "chat-server-parts";
    const runId = "11111111-2222-4333-8444-555555555555";
    // These sit in the useChat copy, which is what the TRANSCRIPT renders —
    // not only in the authoritative copy, which feeds the separate boundary
    // component. On a page reload the persisted parts arrive exactly here.
    const serverParts = [
      {
        type: "data-context",
        data: {
          v: 1,
          producer: "effective-context-change",
          form: "notice",
          runId,
          payload: {
            cause: "model",
            fromModelId: "model-a",
            toModelId: "model-b",
          },
          text: '<system-reminder producer="effective-context-change" form="notice">model changed</system-reminder>',
        },
      },
      {
        type: "data-context",
        data: {
          v: 1,
          producer: "tool-availability",
          form: "notice",
          runId,
          payload: { kind: "delta", added: [], removed: [] },
          text: '<system-reminder producer="tool-availability" form="notice">tools changed</system-reminder>',
        },
      },
      {
        type: "data-context",
        data: {
          v: 1,
          producer: "recency-digest",
          form: "notice",
          runId,
          payload: {
            entries: [
              {
                title: "Another chat",
                date: "2026-08-13",
                messageCount: 2,
                pinned: false,
              },
            ],
            pinChanges: [],
          },
          text: '<system-reminder producer="recency-digest" form="notice">another chat exists</system-reminder>',
        },
      },
      // A producer this build does not recognize. Under the old per-type
      // branches this is exactly what would have printed debug text into the
      // owner's transcript; one branch on the shared type covers it.
      {
        type: "data-context",
        data: {
          v: 1,
          producer: "from-a-newer-api",
          form: "notice",
          runId,
          payload: { anything: true },
          text: '<system-reminder producer="from-a-newer-api" form="notice">future context</system-reminder>',
        },
      },
    ];
    useChatMessages = [
      {
        id: "m1",
        role: "user",
        parts: [...serverParts, { type: "text", text: "Owner question" }],
        metadata: { seq: 1 },
      },
    ];

    renderChatPage(chatId, {
      messages: useChatMessages,
      compaction: null,
    });

    expect(screen.getByText("Owner question")).toBeTruthy();
    expect(screen.queryByText(/unsupported part type/i)).toBeNull();
    // The digest's own content is prompt-side only; it must never surface as
    // chat content the owner reads back.
    expect(screen.queryByText(/Another chat/)).toBeNull();
    expect(
      screen.queryByText(/tools changed|another chat exists|future context/i),
    ).toBeNull();
    expect(screen.queryByText(/<system-reminder/)).toBeNull();
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

  it("anchors sparse durable sequences and scrolls to a target exactly once", async () => {
    const chatId = "chat-message-target";
    const targetSeq = 900;
    const durableMessages: typeof useChatMessages = [
      {
        id: "m701",
        role: "user",
        parts: [{ type: "text", text: "older" }],
        metadata: { seq: 701 },
      },
      {
        id: "m900",
        role: "assistant",
        parts: [{ type: "text", text: "target" }],
        metadata: { seq: targetSeq },
      },
    ];
    useChatMessages = [
      ...durableMessages,
      {
        id: "live-assistant",
        role: "assistant",
        parts: [{ type: "text", text: "live" }],
      },
    ];
    window.history.replaceState(
      window.history.state,
      "",
      `/chat/${chatId}#msg-${targetSeq}`,
    );
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});

    const { queryClient } = renderChatPage(
      chatId,
      { messages: durableMessages, compaction: null },
      targetSeq,
      durableMessages,
    );

    await waitFor(() => {
      const target = document.getElementById(`msg-${targetSeq}`);
      expect(target).not.toBeNull();
      expect(target?.getAttribute("data-message-key")).toBe("assistant:m900");
    });
    expect(capturedResume).toBe(false);
    const liveMessage = document.querySelector<HTMLElement>(
      '[data-message-key="assistant:live-assistant"]',
    );
    expect(liveMessage).not.toBeNull();
    expect(liveMessage?.id).toBe("");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });

    queryClient.setQueryData(chatQueryKeys.targetMessages(chatId, targetSeq), {
      pages: [
        {
          ...queryClient.getQueryData<{
            pages: Array<{ messages: ChatMessageResponse[] }>;
          }>(chatQueryKeys.targetMessages(chatId, targetSeq))!.pages[0]!,
        },
      ],
      pageParams: [null],
    });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });
});
