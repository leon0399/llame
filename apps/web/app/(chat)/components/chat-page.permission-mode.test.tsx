// @vitest-environment jsdom

/**
 * The real ChatPage, React Query, ChatProvider, and permission-mode selector
 * stay mounted together here. Only the router and streaming hook are mocked at
 * their external boundaries, so the tests cover the page's per-chat context
 * state and the engine's send-error recovery path.
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
import {
  permissionModesQueryKey,
  type PermissionModesResponse,
} from "@/lib/services/permission-modes/queries";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { seedChatMessagesQueryData } from "@/lib/services/chat/queries";
import type { ChatMessagesResponse } from "@/lib/services/chat/history";

const mocks = vi.hoisted(() => ({
  // SAFETY: widening the initial `undefined` into the captured-callback slot;
  // the send path assigns the real handler before any test reads it.
  capturedOnError: undefined as ((error: unknown) => void) | undefined,
  sendMessage: vi.fn(),
}));

const routerMock = { push: vi.fn(), replace: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: {
    messages?: Array<unknown>;
    onError?: (error: unknown) => void;
  }) => {
    mocks.capturedOnError = options.onError;
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

import { ChatPage } from "./chat-page";
import { ensureChatMarkdownRenderersLoaded } from "./use-chat-markdown-ready";

const CHAT_ONE = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";
const CHAT_TWO = "b6ed346f-2ef9-4bbe-95f9-f1f358c7b246";

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

const PERMISSION_MODES_RESPONSE: PermissionModesResponse = {
  modes: [{ value: "default" }, { value: "bypass" }],
};

const EMPTY_HISTORY: ChatMessagesResponse = {
  compaction: null,
  messages: [],
};

let fetchMock: Mock<typeof fetch>;

function chatPageTree(queryClient: QueryClient, chatId: string) {
  window.history.replaceState(window.history.state, "", `/chat/${chatId}`);
  seedChatMessagesQueryData(queryClient, chatId, EMPTY_HISTORY);

  return (
    <QueryClientProvider client={queryClient}>
      <ActiveRunsProvider>
        <ChatProvider>
          <ChatPage
            chatId={chatId}
            initialChatExists
            initialDraftPhase={null}
          />
        </ChatProvider>
      </ActiveRunsProvider>
    </QueryClientProvider>
  );
}

beforeAll(async () => {
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
});

beforeEach(() => {
  fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    if (pathname === "/api/v1/models") return jsonResponse(MODELS_RESPONSE);
    if (pathname === "/api/v1/permission-modes") {
      return jsonResponse(PERMISSION_MODES_RESPONSE);
    }
    if (pathname.endsWith("/messages")) return jsonResponse(EMPTY_HISTORY);
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
  mocks.capturedOnError = undefined;
  mocks.sendMessage.mockReset();
  window.history.replaceState(window.history.state, "", `/chat/${CHAT_ONE}`);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ChatPage permission mode state", () => {
  it("keeps bypass isolated to the chat that selected it", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
    const view = render(chatPageTree(queryClient, CHAT_ONE));

    const firstTrigger = await screen.findByRole("button", {
      name: "Permission mode, Default",
    });
    await user.click(firstTrigger);
    await user.click(
      await screen.findByRole("menuitemradio", { name: /Bypass/ }),
    );
    await screen.findByRole("button", {
      name: "Permission mode, Bypass",
    });

    view.rerender(chatPageTree(queryClient, CHAT_TWO));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Permission mode, Default" }),
      ).toBeTruthy();
    });
  });

  it("resets an unavailable mode and refetches the mode listing", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    render(chatPageTree(queryClient, CHAT_ONE));

    const trigger = await screen.findByRole("button", {
      name: "Permission mode, Default",
    });
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitemradio", { name: /Bypass/ }),
    );
    await screen.findByRole("button", {
      name: "Permission mode, Bypass",
    });

    const input = screen.getByPlaceholderText("What would you like to know?");
    await user.type(input, "follow-up");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const requestsBeforeError = fetchMock.mock.calls.filter(([input]) => {
      const request = input instanceof Request ? input : new Request(input);
      return new URL(request.url).pathname === "/api/v1/permission-modes";
    }).length;
    act(() => {
      mocks.capturedOnError?.(
        new Error(
          JSON.stringify({
            statusCode: 422,
            error: "Unprocessable Entity",
            message: "Permission mode is no longer available",
            code: "permission_mode_not_available",
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Permission mode, Default" }),
      ).toBeTruthy();
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: permissionModesQueryKey,
    });
    await waitFor(() => {
      const permissionModeRequests = fetchMock.mock.calls.filter(([input]) => {
        const request = input instanceof Request ? input : new Request(input);
        return new URL(request.url).pathname === "/api/v1/permission-modes";
      });
      expect(permissionModeRequests.length).toBeGreaterThan(
        requestsBeforeError,
      );
    });
  });
});
