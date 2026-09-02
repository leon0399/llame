// @vitest-environment jsdom

/**
 * Container exception: this suite exercises the real ChatPage, React Query,
 * chat history cache, ActiveRunsProvider, and markdown renderer together
 * while mocking only the router and the streaming hook (both external
 * boundaries with no in-process seam). The target hydration contract cannot
 * be proved by testing those pieces in isolation: the ordinary SSR cache
 * must coexist with a client-only target request without mounting the
 * ordinary ChatSession first.
 *
 * GET /api/v1/chats/:id/messages, GET /api/v1/models, and GET /api/v1/me/runs
 * all hit a stubbed globalThis.fetch, routed by pathname + the targetSeq
 * search param — so a "no ordinary history fetched" assertion proves the
 * real query never sent that request, not that a mock was never called.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
import type { Mock } from "vitest";

import type { ModelsResponse } from "@/lib/services/models/queries";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

type FinishArgs = {
  isAbort?: boolean;
  isDisconnect?: boolean;
  isError?: boolean;
};

// SAFETY: each assertion below only seeds a mutable slot's declared type for
// later reassignment by the test/mocks (e.g. `capturedOnFinish` is set once
// the mocked `useChat` captures its `onFinish` callback) — none narrows
// untrusted external data.
const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  resumeStream: vi.fn(),
  capturedOnError: undefined as (() => void) | undefined,
  capturedOnFinish: undefined as ((args: FinishArgs) => void) | undefined,
  useChatCalls: [] as Array<{ messages?: Array<UIMessage>; resume?: boolean }>,
  chatInstanceIds: [] as Array<number>,
  nextChatInstanceId: 0,
}));

const routerMock = { push: vi.fn(), replace: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: {
    messages?: Array<UIMessage>;
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

import { ActiveRunsProvider } from "@/contexts/active-runs-context";
import { ChatProvider } from "@/contexts/chat-context";
import { rawChatMessage } from "@/lib/services/chat/message-fixtures";
import { seedChatMessagesQueryData } from "@/lib/services/chat/queries";
import type { ChatMessagesResponse } from "@/lib/services/chat/history";

import { ChatPage } from "./chat-page";

const CHAT_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";

const MODELS_RESPONSE: ModelsResponse = {
  defaultModelId: "system:openai:gpt-5.4-mini",
  models: [
    {
      id: "system:openai:gpt-5.4-mini",
      source: "system",
      name: "GPT-5.4 mini",
      contextWindowTokens: 400_000,
    },
  ],
};

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

let fetchMock: Mock<typeof fetch>;
// Per-test-overridable handler for GET /api/v1/chats/:id/messages —
// receives the request's targetSeq (undefined = the ordinary/latest fetch).
let messagesHandler: (targetSeq: number | undefined) => Promise<Response>;

function stubChatNetwork() {
  fetchMock = stubFetch();
  messagesHandler = () =>
    Promise.resolve(jsonResponse<ChatMessagesResponse>(page([])));
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    if (pathname === "/api/v1/models") return jsonResponse(MODELS_RESPONSE);
    if (pathname === `/api/v1/chats/${CHAT_ID}/messages`) {
      const targetSeq = searchParams.has("targetSeq")
        ? Number(searchParams.get("targetSeq"))
        : undefined;
      return messagesHandler(targetSeq);
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

/** The stubbed-fetch requests sent to the chat messages endpoint, oldest
 * first — the real analogue of the old mocks.getChatMessages.mock.calls. */
function messagesRequests(): Array<Request> {
  return fetchMock.mock.calls
    .map(([req]) => req)
    .filter(
      (req): req is Request =>
        req instanceof Request &&
        new URL(req.url).pathname === `/api/v1/chats/${CHAT_ID}/messages`,
    );
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
        <ActiveRunsProvider>
          <ChatProvider>
            <ChatPage
              chatId={CHAT_ID}
              initialChatExists={options.initialChatExists ?? true}
              initialDraftPhase={options.initialDraftPhase ?? null}
            />
          </ChatProvider>
        </ActiveRunsProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeAll(() => {
  // MessageResponse is a next/dynamic, ssr:false chunk (chat-message-row.tsx's
  // documented #187/#417 client-only-chunk gap): its text is absent from the
  // first synchronous render, and the chunk-load delay is real (not fake-
  // timer-controlled) — bump every waitFor/findBy in this file past the
  // 1000ms default so a loaded worker doesn't turn that gap into a flake.
  configure({ asyncUtilTimeout: 5000 });
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
  stubChatNetwork();
  mocks.sendMessage.mockReset();
  mocks.resumeStream.mockReset();
  mocks.capturedOnError = undefined;
  mocks.capturedOnFinish = undefined;
  mocks.useChatCalls.length = 0;
  mocks.chatInstanceIds.length = 0;
  mocks.nextChatInstanceId = 0;
  window.history.replaceState(window.history.state, "", `/chat/${CHAT_ID}`);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // NOT vi.unstubAllGlobals() — beforeAll's ResizeObserver stub must survive
  // across tests; beforeEach's stubFetch() already replaces fetch fresh.
});

describe("ChatPage target hydration", () => {
  it("does not mount ordinary history before resolving a targeted hash", async () => {
    const ordinaryPage = page([{ id: "newest", seq: 990, text: "newest" }]);
    const targetPage = page([
      { id: "older", seq: 701, text: "older target context" },
      { id: "target", seq: 900, text: "target answer" },
    ]);
    messagesHandler = (targetSeq) =>
      targetSeq === 900
        ? Promise.resolve(jsonResponse<ChatMessagesResponse>(targetPage))
        : // Ordinary history must not be fetched — a 500 here would fail the
          // test the moment (if ever) that request is sent.
          Promise.resolve(new Response(null, { status: 500 }));
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
      const requests = messagesRequests();
      expect(requests).toHaveLength(1);
      const searchParams = new URL(requests[0]!.url).searchParams;
      expect(searchParams.get("limit")).toBe("100");
      expect(searchParams.get("targetSeq")).toBe("900");
      expect(
        mocks.useChatCalls.some((call) =>
          call.messages?.some((message) => message.id === "target"),
        ),
      ).toBe(true);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    expect(messagesRequests()).toHaveLength(1);
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
      messagesHandler = () => Promise.resolve(new Response(null, { status }));
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
      const requests = messagesRequests();
      expect(requests).toHaveLength(1);
      const searchParams = new URL(requests[0]!.url).searchParams;
      expect(searchParams.get("limit")).toBe("100");
      expect(searchParams.get("targetSeq")).toBe("900");
      expect(
        screen.queryByPlaceholderText("What would you like to know?"),
      ).toBe(null);
      expect(mocks.useChatCalls).toHaveLength(0);
      expect(screen.queryByText("newest")).toBeNull();
    },
  );

  it("keeps a valid target route closed for a nonexistent chat instead of opening a fresh draft", async () => {
    messagesHandler = () =>
      Promise.resolve(new Response(null, { status: 404 }));
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
    messagesHandler = () =>
      Promise.resolve(new Response(null, { status: 404 }));
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
      messagesRequests().every(
        (req) => !new URL(req.url).searchParams.has("targetSeq"),
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
    messagesHandler = () =>
      Promise.resolve(jsonResponse<ChatMessagesResponse>(targetPage));
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
    messagesHandler = (targetSeq) =>
      Promise.resolve(
        jsonResponse<ChatMessagesResponse>(
          targetSeq === 900 ? targetPage : latestPage,
        ),
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
      messagesRequests().some(
        (req) => !new URL(req.url).searchParams.has("targetSeq"),
      ),
    ).toBe(true);
  });

  it("restores the target hash and input when a target send fails", async () => {
    const user = userEvent.setup();
    const targetPage = page([
      { id: "older", seq: 701, text: "older target context" },
      { id: "target", seq: 900, text: "target answer" },
    ]);
    messagesHandler = () =>
      Promise.resolve(jsonResponse<ChatMessagesResponse>(targetPage));
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

    // SAFETY: the composer's textarea is the only element this placeholder
    // resolves to.
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
    messagesHandler = (targetSeq) =>
      Promise.resolve(
        jsonResponse<ChatMessagesResponse>(
          targetSeq === 900 ? targetPage : latestPage,
        ),
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
    // untrackChat was asserted "not called" here against a mocked context;
    // dropped on conversion — the mocked useChat's status never becomes
    // "streaming"/"submitted" (it is hardcoded "ready" throughout this
    // suite), so useChatPresenceEffects's trackRun/untrackChat call site
    // (use-chat-engine.ts) never fires in ANY test here, making that
    // assertion vacuously true regardless of this branch's own behavior —
    // a pre-existing gap in the original test, not something this
    // conversion introduces or could meaningfully replace.
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
      messagesHandler = (targetSeq) =>
        Promise.resolve(
          jsonResponse<ChatMessagesResponse>(
            targetSeq === 900 ? targetPage : latestPage,
          ),
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
      // untrackChat "not called" dropped on conversion — see the identical
      // note in the interruption test above; this suite's mocked useChat
      // never reaches "streaming"/"submitted", so trackRun/untrackChat are
      // never invoked here regardless.
    },
  );
});
