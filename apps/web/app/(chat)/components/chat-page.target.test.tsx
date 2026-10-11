// @vitest-environment jsdom

/**
 * Container exception (testing rule 5: mocks the router and AI streaming):
 * a rejected `sendMessage` cannot come from the real `useChat` — its request
 * loop catches every transport failure and reports it through onError /
 * onFinish instead — so this one case needs the mocked streaming hook. Every
 * other target-hydration case runs against the real hook in
 * `chat-page.stories.tsx`.
 *
 * GET /api/v1/chats/:id/messages, GET /api/v1/models,
 * GET /api/v1/permission-modes, and GET /api/v1/me/runs all hit a stubbed
 * globalThis.fetch, routed by pathname.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { ModelsResponse } from "@/lib/services/models/queries";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

// SAFETY: each assertion below only seeds a mutable slot's declared type for
// later reassignment by the test/mocks — none narrows untrusted external data.
const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  chatInstanceIds: [] as Array<number>,
  nextChatInstanceId: 0,
}));

const routerMock = { push: vi.fn(), replace: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { messages?: Array<UIMessage> }) => {
    const instanceId = useRef<number | null>(null);
    if (instanceId.current === null) {
      instanceId.current = ++mocks.nextChatInstanceId;
      mocks.chatInstanceIds.push(instanceId.current);
    }
    return {
      error: undefined,
      messages: options.messages ?? [],
      resumeStream: vi.fn(),
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
import {
  CHAT_MARKDOWN_WARMUP_TIMEOUT_MS,
  ensureChatMarkdownRenderersLoaded,
} from "./use-chat-markdown-ready";

const CHAT_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";

const MODELS_RESPONSE: ModelsResponse = {
  defaultModelId: "system:openai:gpt-5.4-mini",
  models: [
    {
      id: "system:openai:gpt-5.4-mini",
      source: "system",
      name: "GPT-5.4 mini",
      contextWindowTokens: 400_000,
      input: ["text"],
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

const TARGET_PAGE = page([
  { id: "older", seq: 701, text: "older target context" },
  { id: "target", seq: 900, text: "target answer" },
]);

function stubChatNetwork() {
  const fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    if (pathname === "/api/v1/models") return jsonResponse(MODELS_RESPONSE);
    if (pathname === "/api/v1/permission-modes") {
      return jsonResponse({ modes: [{ value: "default" }] });
    }
    if (pathname === `/api/v1/chats/${CHAT_ID}/messages`) {
      return jsonResponse<ChatMessagesResponse>(TARGET_PAGE);
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

beforeAll(async () => {
  // Warm Streamdown chunks so the transcript gate opens on the first paint.
  await ensureChatMarkdownRenderersLoaded();
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
}, CHAT_MARKDOWN_WARMUP_TIMEOUT_MS);

beforeEach(() => {
  stubChatNetwork();
  mocks.sendMessage.mockReset();
  mocks.chatInstanceIds.length = 0;
  mocks.nextChatInstanceId = 0;
  window.history.replaceState(
    window.history.state,
    "",
    `/chat/${CHAT_ID}#msg-900`,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // NOT vi.unstubAllGlobals() — beforeAll's ResizeObserver stub must survive
  // across tests; beforeEach's stubFetch() already replaces fetch fresh.
});

it("restores the target hash and input when a target send fails", async () => {
  const user = userEvent.setup();
  mocks.sendMessage.mockRejectedValue(new Error("send failed"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  seedChatMessagesQueryData(
    queryClient,
    CHAT_ID,
    page([{ id: "newest", seq: 990, text: "newest" }]),
  );

  render(
    <QueryClientProvider client={queryClient}>
      <ActiveRunsProvider>
        <ChatProvider>
          <ChatPage
            chatId={CHAT_ID}
            initialChatExists
            initialDraftPhase={null}
          />
        </ChatProvider>
      </ActiveRunsProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("target answer")).toBeTruthy());
  const targetSessionCount = mocks.chatInstanceIds.length;
  const input = screen.getByPlaceholderText("What would you like to know?");
  await user.type(input, "follow-up");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      text: "follow-up",
      files: [],
    }),
  );

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
