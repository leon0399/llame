// @vitest-environment jsdom

/**
 * Container exception: this suite exercises the real ChatPage, React Query,
 * and chat history cache together while mocking the router, streaming hook,
 * model catalog, and generated HTTP boundary. The target hydration contract
 * cannot be proved by testing those pieces in isolation: the ordinary SSR
 * cache must coexist with a client-only target request without mounting the
 * ordinary ChatSession first.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  getChat: vi.fn(),
  getChatMessages: vi.fn(),
  listChats: vi.fn(),
  useChatCalls: [] as Array<{ messages?: UIMessage[]; resume?: boolean }>,
  modelsState: {
    data: {
      defaultModelId: "system:openai:gpt-5.4-mini",
      models: [
        {
          id: "system:openai:gpt-5.4-mini",
          source: "system" as const,
          name: "GPT-5.4 mini",
        },
      ],
    },
    isPending: false,
    isError: false,
    isSuccess: true,
  },
}));

const routerMock = { push: vi.fn(), replace: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/lib/api/generated/chats/chats", () => ({
  getChat: mocks.getChat,
  getChatMessages: mocks.getChatMessages,
  listChats: mocks.listChats,
}));

vi.mock("@/lib/api/fetch", () => ({
  authAwareFetch: vi.fn(),
  buildApiUrl: (path: string) => `https://api.example.com${path}`,
  createAuthenticatedBrowserFetch: () => vi.fn(),
}));

vi.mock("@/lib/services/models/queries", () => ({
  hasModelId: (models: Array<{ id: string }>, modelId: string): boolean =>
    models.some((model) => model.id === modelId),
  modelDisplayName: (
    modelId: string,
    models?: Array<{ id: string; name?: string }>,
  ): string => models?.find((model) => model.id === modelId)?.name ?? modelId,
  useModelsQuery: () => mocks.modelsState,
}));

vi.mock("@workspace/ui/components/ai-elements/message-response", () => ({
  MessageResponse: ({ children }: { children: string }) => children,
}));

vi.mock("@/contexts/active-runs-context", () => ({
  useActiveRuns: () => ({
    completedChats: new Set<string>(),
    markChatSeen: vi.fn(),
    registerViewedChat: vi.fn(() => () => {}),
    trackRun: vi.fn(),
    untrackChat: vi.fn(),
  }),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { messages?: UIMessage[]; resume?: boolean }) => {
    mocks.useChatCalls.push(options);
    return {
      error: undefined,
      messages: options.messages ?? [],
      resumeStream: vi.fn(),
      sendMessage: vi.fn(),
      setMessages: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    };
  },
}));

import { ChatProvider } from "@/contexts/chat-context";
import { rawChatMessage } from "@/lib/services/chat/message-fixtures";
import { seedChatMessagesQueryData } from "@/lib/services/chat/queries";
import type { ChatMessagesResponse } from "@/lib/services/chat/history";

import { ChatPage } from "./chat-page";

const CHAT_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";

function page(
  rows: Array<{ id: string; seq: number; text: string }>,
): ChatMessagesResponse {
  return {
    compaction: null,
    messages: rows.map(({ id, seq, text }) =>
      rawChatMessage({
        chatId: CHAT_ID,
        id,
        parts: [{ type: "text", text }],
        role: "assistant",
        seq,
      }),
    ),
  };
}

function renderChat(ordinaryPage: ChatMessagesResponse) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  seedChatMessagesQueryData(queryClient, CHAT_ID, ordinaryPage);

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ChatProvider>
          <ChatPage
            chatId={CHAT_ID}
            initialChatExists
            initialDraftPhase={null}
          />
        </ChatProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
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

beforeEach(() => {
  mocks.getChatMessages.mockReset();
  mocks.useChatCalls.length = 0;
  window.history.replaceState(window.history.state, "", `/chat/${CHAT_ID}`);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ChatPage target hydration", () => {
  it("does not mount ordinary history before resolving a targeted hash", async () => {
    const ordinaryPage = page([{ id: "newest", seq: 990, text: "newest" }]);
    const targetPage = page([
      { id: "older", seq: 701, text: "older target context" },
      { id: "target", seq: 900, text: "target answer" },
    ]);
    mocks.getChatMessages.mockImplementation(
      async (_chatId: string, params: { targetSeq?: number }) => {
        if (params.targetSeq !== 900) {
          throw new Error("ordinary history must not be fetched");
        }
        return targetPage;
      },
    );
    window.history.replaceState(
      window.history.state,
      "",
      `/chat/${CHAT_ID}#msg-900`,
    );
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});

    renderChat(ordinaryPage);

    await waitFor(() => {
      expect(mocks.getChatMessages).toHaveBeenCalledWith(
        CHAT_ID,
        { limit: 100, targetSeq: 900 },
        expect.anything(),
        expect.any(Function),
      );
      expect(screen.getByText("target answer")).toBeTruthy();
    });

    expect(mocks.getChatMessages).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("newest")).toBeNull();
    expect(
      mocks.useChatCalls.some((call) =>
        call.messages?.some((message) => message.id === "newest"),
      ),
    ).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("resolves no hash to ordinary history instead of staying blank", async () => {
    const ordinaryPage = page([{ id: "newest", seq: 990, text: "newest" }]);
    renderChat(ordinaryPage);

    await waitFor(() => expect(screen.getByText("newest")).toBeTruthy());
    expect(
      mocks.getChatMessages.mock.calls.every(
        ([, params]) => params?.targetSeq === undefined,
      ),
    ).toBe(true);
    expect(
      mocks.useChatCalls.some((call) =>
        call.messages?.some((message) => message.id === "newest"),
      ),
    ).toBe(true);
  });
});
