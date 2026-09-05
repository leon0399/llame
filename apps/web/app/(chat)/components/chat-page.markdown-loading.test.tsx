// @vitest-environment jsdom

/**
 * ChatSessionContent holds the transcript until Streamdown components are
 * real handles from ChatMarkdownProvider. This suite pins the loading shell
 * and the handoff via setChatMarkdownLoadForTests (no vi.mock — mocking the
 * module leaked into sibling chat-page suites in the same vitest run).
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

const routerMock = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

let useChatMessages: Array<{
  id: string;
  role: "user" | "assistant";
  parts: Array<unknown>;
  metadata?: { seq?: number };
}> = [];

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: useChatMessages,
    sendMessage: vi.fn(),
    status: "ready",
    stop: vi.fn(),
    error: undefined,
    resumeStream: vi.fn(),
  }),
}));

import { ActiveRunsProvider } from "@/contexts/active-runs-context";
import { ChatProvider } from "@/contexts/chat-context";
import { rawChatMessage } from "@/lib/services/chat/message-fixtures";
import { seedChatMessagesQueryData } from "@/lib/services/chat/queries";
import { modelQueryKeys } from "@/lib/services/models/queries";
import {
  toChatUiMessages,
  type ChatMessageResponse,
} from "@/lib/services/chat/history";

import { ChatPage } from "./chat-page";
import {
  setChatMarkdownLoadForTests,
  type ChatMarkdownRenderers,
} from "./use-chat-markdown-ready";

const CHAT_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";

const STUB_RENDERERS: ChatMarkdownRenderers = {
  MessageResponse: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ReasoningContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
};

let resolveRenderers: ((renderers: ChatMarkdownRenderers) => void) | null =
  null;

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
  resolveRenderers = null;
  setChatMarkdownLoadForTests(
    () =>
      new Promise<ChatMarkdownRenderers>((resolve) => {
        resolveRenderers = resolve;
      }),
  );
  useChatMessages = [];
  window.history.replaceState(window.history.state, "", `/chat/${CHAT_ID}`);
  const fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    if (pathname === "/api/v1/models") {
      return jsonResponse({
        defaultModelId: "system:openai:gpt-5.4-mini",
        models: [
          {
            id: "system:openai:gpt-5.4-mini",
            source: "system",
            name: "GPT-5.4 mini",
            contextWindowTokens: 400_000,
          },
        ],
      });
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
});

afterEach(() => {
  cleanup();
  setChatMarkdownLoadForTests(null);
});

function unlockRenderers() {
  resolveRenderers?.(STUB_RENDERERS);
}

function renderSeededChat(messages: Array<ChatMessageResponse>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  seedChatMessagesQueryData(queryClient, CHAT_ID, {
    messages,
    compaction: null,
  });
  queryClient.setQueryData(modelQueryKeys.all, {
    defaultModelId: "system:openai:gpt-5.4-mini",
    models: [
      {
        id: "system:openai:gpt-5.4-mini",
        source: "system",
        name: "GPT-5.4 mini",
        contextWindowTokens: 400_000,
      },
    ],
  });
  useChatMessages = toChatUiMessages({ messages });

  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveRunsProvider>
        <ChatProvider>
          <ChatPage
            chatId={CHAT_ID}
            initialChatExists={true}
            initialDraftPhase={null}
          />
        </ChatProvider>
      </ActiveRunsProvider>
    </QueryClientProvider>,
  );
}

describe("ChatPage markdown loading shell", () => {
  it("shows a centered spinner and disables the composer while markdown chunks load", async () => {
    renderSeededChat([
      rawChatMessage({
        id: "m1",
        role: "user",
        seq: 1,
        parts: [{ type: "text", text: "Hello from history" }],
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    });
    expect(screen.queryByText("Hello from history")).toBeNull();
    expect(screen.queryByRole("log")).toBeNull();

    const input = screen.getByPlaceholderText("What would you like to know?");
    // SAFETY: placeholder uniquely identifies the composer textarea.
    expect((input as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("places message bodies once markdown is ready without an empty-bubble phase", async () => {
    renderSeededChat([
      rawChatMessage({
        id: "m1",
        role: "user",
        seq: 1,
        parts: [{ type: "text", text: "Hello from history" }],
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    });
    unlockRenderers();

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
      expect(screen.getByText("Hello from history")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("What would you like to know?");
    // SAFETY: placeholder uniquely identifies the composer textarea.
    expect((input as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("shows the spinner for an empty draft until markdown chunks load", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(modelQueryKeys.all, {
      defaultModelId: "system:openai:gpt-5.4-mini",
      models: [
        {
          id: "system:openai:gpt-5.4-mini",
          source: "system",
          name: "GPT-5.4 mini",
          contextWindowTokens: 400_000,
        },
      ],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ActiveRunsProvider>
          <ChatProvider>
            <ChatPage
              chatId={CHAT_ID}
              initialChatExists={false}
              initialDraftPhase="fresh"
            />
          </ChatProvider>
        </ActiveRunsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    });
    const input = screen.getByPlaceholderText("What would you like to know?");
    // SAFETY: placeholder uniquely identifies the composer textarea.
    expect((input as HTMLTextAreaElement).disabled).toBe(true);

    unlockRenderers();

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
    });
    // SAFETY: placeholder uniquely identifies the remounted unlocked textarea.
    expect(
      (
        screen.getByPlaceholderText(
          "What would you like to know?",
        ) as HTMLTextAreaElement
      ).disabled,
    ).toBe(false);
  });
});
