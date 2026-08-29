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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { useRef } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type FinishArgs = {
  isAbort?: boolean;
  isDisconnect?: boolean;
  isError?: boolean;
};

const mocks = vi.hoisted(() => ({
  getChat: vi.fn(),
  getChatMessages: vi.fn(),
  listChats: vi.fn(),
  sendMessage: vi.fn(),
  resumeStream: vi.fn(),
  capturedOnError: undefined as (() => void) | undefined,
  capturedOnFinish: undefined as ((args: FinishArgs) => void) | undefined,
  useChatCalls: [] as Array<{ messages?: UIMessage[]; resume?: boolean }>,
  chatInstanceIds: [] as number[],
  nextChatInstanceId: 0,
  trackRun: vi.fn(),
  untrackChat: vi.fn(),
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
    trackRun: mocks.trackRun,
    untrackChat: mocks.untrackChat,
  }),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: {
    messages?: UIMessage[];
    onError?: () => void;
    onFinish?: (args: FinishArgs) => void;
    resume?: boolean;
  }) => {
    const instanceId = useRef<number | null>(null);
    if (instanceId.current === null) {
      instanceId.current = ++mocks.nextChatInstanceId;
      mocks.chatInstanceIds.push(instanceId.current);
    }
    mocks.useChatCalls.push(options);
    mocks.capturedOnError = options.onError;
    mocks.capturedOnFinish = options.onFinish;
    return {
      error: undefined,
      messages: options.messages ?? [],
      resumeStream: mocks.resumeStream,
      sendMessage: mocks.sendMessage,
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

function renderChat(
  ordinaryPage: ChatMessagesResponse,
  options: {
    initialChatExists?: boolean;
    initialDraftPhase?: "fresh" | "sent" | null;
  } = {},
) {
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
            initialChatExists={options.initialChatExists ?? true}
            initialDraftPhase={options.initialDraftPhase ?? null}
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
  mocks.sendMessage.mockReset();
  mocks.resumeStream.mockReset();
  mocks.capturedOnError = undefined;
  mocks.capturedOnFinish = undefined;
  mocks.useChatCalls.length = 0;
  mocks.chatInstanceIds.length = 0;
  mocks.nextChatInstanceId = 0;
  mocks.trackRun.mockReset();
  mocks.untrackChat.mockReset();
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

  it.each([404, 500])(
    "shows a closed target state and no composer for terminal HTTP %s errors",
    async (status) => {
      const error = Object.assign(new Error(`HTTP ${status}`), { status });
      mocks.getChatMessages.mockRejectedValue(error);
      window.history.replaceState(
        window.history.state,
        "",
        `/chat/${CHAT_ID}#msg-900`,
      );

      renderChat(page([{ id: "newest", seq: 990, text: "newest" }]));

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "Message unavailable",
        ),
      );
      expect(mocks.getChatMessages).toHaveBeenCalledWith(
        CHAT_ID,
        { limit: 100, targetSeq: 900 },
        expect.anything(),
        expect.any(Function),
      );
      expect(
        screen.queryByPlaceholderText("What would you like to know?"),
      ).toBe(null);
      expect(mocks.useChatCalls).toHaveLength(0);
      expect(screen.queryByText("newest")).toBeNull();
    },
  );

  it("keeps a valid target route closed for a nonexistent chat instead of opening a fresh draft", async () => {
    const error = Object.assign(new Error("HTTP 404"), { status: 404 });
    mocks.getChatMessages.mockRejectedValue(error);
    window.history.replaceState(
      window.history.state,
      "",
      `/chat/${CHAT_ID}#msg-900`,
    );

    renderChat(page([{ id: "newest", seq: 990, text: "newest" }]), {
      initialChatExists: false,
      initialDraftPhase: "fresh",
    });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Message unavailable",
      ),
    );
    expect(screen.queryByPlaceholderText("What would you like to know?")).toBe(
      null,
    );
    expect(mocks.useChatCalls).toHaveLength(0);
  });

  it("returns to ordinary history when the target hash is cleared after an error", async () => {
    const error = Object.assign(new Error("HTTP 404"), { status: 404 });
    mocks.getChatMessages.mockRejectedValue(error);
    window.history.replaceState(
      window.history.state,
      "",
      `/chat/${CHAT_ID}#msg-900`,
    );

    renderChat(page([{ id: "newest", seq: 990, text: "newest" }]));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    window.history.replaceState(window.history.state, "", `/chat/${CHAT_ID}`);
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() => expect(screen.getByText("newest")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("keeps the target session mounted while a target send is in flight", async () => {
    const user = userEvent.setup();
    const targetPage = page([
      { id: "older", seq: 701, text: "older target context" },
      { id: "target", seq: 900, text: "target answer" },
    ]);
    mocks.getChatMessages.mockResolvedValue(targetPage);
    mocks.sendMessage.mockReturnValue(new Promise<void>(() => {}));
    window.history.replaceState(
      window.history.state,
      "",
      `/chat/${CHAT_ID}#msg-900`,
    );

    renderChat(page([{ id: "newest", seq: 990, text: "newest" }]));
    await waitFor(() => expect(screen.getByText("target answer")).toBeTruthy());

    const targetSessionCount = mocks.chatInstanceIds.length;
    const input = screen.getByPlaceholderText("What would you like to know?");
    const send = screen.getByRole("button", { name: "Send message" });
    await user.type(input, "follow-up");
    await user.click(send);

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({ text: "follow-up" }),
    );
    expect(window.location.pathname).toBe(`/chat/${CHAT_ID}`);
    expect(window.location.search).toBe("?draft=sent");
    expect(window.location.hash).toBe("");
    expect(mocks.chatInstanceIds).toHaveLength(targetSessionCount);
  });

  it("switches from target mode to latest only after a successful finish", async () => {
    const user = userEvent.setup();
    const targetPage = page([
      { id: "older", seq: 701, text: "older target context" },
      { id: "target", seq: 900, text: "target answer" },
    ]);
    const latestPage = page([
      { id: "target", seq: 900, text: "target answer" },
      { id: "latest", seq: 1000, text: "latest durable answer" },
    ]);
    mocks.getChatMessages.mockImplementation(
      async (_chatId: string, params: { targetSeq?: number }) =>
        params.targetSeq === 900 ? targetPage : latestPage,
    );
    mocks.sendMessage.mockResolvedValue(undefined);
    window.history.replaceState(
      window.history.state,
      "",
      `/chat/${CHAT_ID}#msg-900`,
    );

    renderChat(page([{ id: "newest", seq: 990, text: "newest" }]));
    await waitFor(() => expect(screen.getByText("target answer")).toBeTruthy());
    const targetSessionCount = mocks.chatInstanceIds.length;
    const input = screen.getByPlaceholderText("What would you like to know?");
    await user.type(input, "follow-up");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.search).toBe("?draft=sent");

    act(() => {
      mocks.capturedOnFinish?.({});
    });

    await waitFor(() =>
      expect(screen.getByText("latest durable answer")).toBeTruthy(),
    );
    expect(window.location.pathname).toBe(`/chat/${CHAT_ID}`);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(mocks.chatInstanceIds.length).toBeGreaterThan(targetSessionCount);
    expect(
      mocks.getChatMessages.mock.calls.some(
        ([, params]) => params?.targetSeq === undefined,
      ),
    ).toBe(true);
  });

  it("restores the target hash and input when a target send fails", async () => {
    const user = userEvent.setup();
    const targetPage = page([
      { id: "older", seq: 701, text: "older target context" },
      { id: "target", seq: 900, text: "target answer" },
    ]);
    mocks.getChatMessages.mockResolvedValue(targetPage);
    mocks.sendMessage.mockRejectedValue(new Error("send failed"));
    window.history.replaceState(
      window.history.state,
      "",
      `/chat/${CHAT_ID}#msg-900`,
    );

    renderChat(page([{ id: "newest", seq: 990, text: "newest" }]));
    await waitFor(() => expect(screen.getByText("target answer")).toBeTruthy());
    const targetSessionCount = mocks.chatInstanceIds.length;
    const input = screen.getByPlaceholderText("What would you like to know?");
    await user.type(input, "follow-up");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect((input as HTMLTextAreaElement).value).toBe("follow-up"),
    );
    expect(window.location.pathname).toBe(`/chat/${CHAT_ID}`);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#msg-900");
    expect(mocks.chatInstanceIds).toHaveLength(targetSessionCount);
  });

  it("keeps a hashless sent recovery route when the SDK reports an interruption", async () => {
    const user = userEvent.setup();
    const targetPage = page([
      { id: "older", seq: 701, text: "older target context" },
      { id: "target", seq: 900, text: "target answer" },
    ]);
    const latestPage = page([
      { id: "target", seq: 900, text: "target answer" },
      { id: "latest", seq: 1000, text: "latest after interruption" },
    ]);
    mocks.getChatMessages.mockImplementation(
      async (_chatId: string, params: { targetSeq?: number }) =>
        params.targetSeq === 900 ? targetPage : latestPage,
    );
    mocks.sendMessage.mockReturnValue(new Promise<void>(() => {}));
    window.history.replaceState(
      window.history.state,
      "",
      `/chat/${CHAT_ID}#msg-900`,
    );

    renderChat(page([{ id: "newest", seq: 990, text: "newest" }]));
    await waitFor(() => expect(screen.getByText("target answer")).toBeTruthy());
    const targetSessionCount = mocks.chatInstanceIds.length;
    const input = screen.getByPlaceholderText("What would you like to know?");
    await user.type(input, "follow-up");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.search).toBe("?draft=sent");

    act(() => {
      mocks.capturedOnError?.();
    });

    await waitFor(() =>
      expect(screen.getByText("latest after interruption")).toBeTruthy(),
    );
    expect(window.location.pathname).toBe(`/chat/${CHAT_ID}`);
    expect(window.location.search).toBe("?draft=sent");
    expect(window.location.hash).toBe("");
    expect(mocks.chatInstanceIds.length).toBeGreaterThan(targetSessionCount);
    expect(mocks.resumeStream).toHaveBeenCalled();
    expect(mocks.untrackChat).not.toHaveBeenCalled();
  });

  it.each([
    ["abort", { isAbort: true }],
    ["disconnect", { isDisconnect: true }],
  ] as const)(
    "keeps hashless sent recovery after an SDK %s finish",
    async (_label, finishArgs) => {
      const user = userEvent.setup();
      const targetPage = page([
        { id: "older", seq: 701, text: "older target context" },
        { id: "target", seq: 900, text: "target answer" },
      ]);
      const latestPage = page([
        { id: "target", seq: 900, text: "target answer" },
        { id: "latest", seq: 1000, text: "latest after finish" },
      ]);
      mocks.getChatMessages.mockImplementation(
        async (_chatId: string, params: { targetSeq?: number }) =>
          params.targetSeq === 900 ? targetPage : latestPage,
      );
      mocks.sendMessage.mockReturnValue(new Promise<void>(() => {}));
      window.history.replaceState(
        window.history.state,
        "",
        `/chat/${CHAT_ID}#msg-900`,
      );

      renderChat(page([{ id: "newest", seq: 990, text: "newest" }]));
      await waitFor(() =>
        expect(screen.getByText("target answer")).toBeTruthy(),
      );
      const targetSessionCount = mocks.chatInstanceIds.length;
      const input = screen.getByPlaceholderText("What would you like to know?");
      await user.type(input, "follow-up");
      await user.click(screen.getByRole("button", { name: "Send message" }));
      await waitFor(() => expect(window.location.hash).toBe(""));

      act(() => {
        mocks.capturedOnFinish?.(finishArgs);
      });

      await waitFor(() =>
        expect(screen.getByText("latest after finish")).toBeTruthy(),
      );
      expect(window.location.search).toBe("?draft=sent");
      expect(window.location.hash).toBe("");
      expect(mocks.chatInstanceIds.length).toBeGreaterThan(targetSessionCount);
      expect(mocks.untrackChat).not.toHaveBeenCalled();
    },
  );
});
