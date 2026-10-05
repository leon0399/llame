// @vitest-environment jsdom

/**
 * The real ChatPage, React Query, ChatProvider, and permission-mode selector
 * stay mounted together here. Only the router and streaming hook are mocked at
 * their external boundaries, so the tests cover the page's per-chat context
 * state and the engine's send-error recovery path.
 */

import type { ChatTransport, UIMessage } from "ai";
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
import { rawChatMessage } from "@/lib/services/chat/message-fixtures";

type SendMessageInput = {
  text: string;
};

type ChatUseOptions = {
  id: string;
  onError?: (error: unknown) => void;
  transport: ChatTransport<UIMessage>;
};

type SentChatRequestBody = {
  permissionMode?: string;
};

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
  useChat: (options: ChatUseOptions) => {
    mocks.capturedOnError = options.onError;
    return {
      error: undefined,
      messages: [],
      resumeStream: vi.fn(),
      sendMessage: (message: SendMessageInput) => {
        mocks.sendMessage(message);
        void options.transport
          .sendMessages({
            abortSignal: undefined,
            chatId: options.id,
            messageId: undefined,
            messages: [
              {
                id: "test-message",
                parts: [{ type: "text", text: message.text }],
                role: "user",
              },
            ],
            trigger: "submit-message",
          })
          .catch(() => undefined);
      },
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
import {
  resolveLastTurnModelEffort,
  resolveRestoredPermissionMode,
} from "./use-chat-engine";

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
let permissionModesResponse: PermissionModesResponse;

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

/** A persisted chat whose latest turn recorded telemetry with a permission mode
 *  (`metadata.usage.permissionMode`), the path the last-turn restore runs on. */
function chatPageTreeWithHistory(
  queryClient: QueryClient,
  chatId: string,
  usage: { modelId?: string; status: "completed"; permissionMode?: "bypass" },
) {
  const history: ChatMessagesResponse = {
    compaction: null,
    messages: [
      rawChatMessage({
        chatId,
        id: "msg-1",
        seq: 1,
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
        usage,
      }),
    ],
  };
  window.history.replaceState(window.history.state, "", `/chat/${chatId}`);
  seedChatMessagesQueryData(queryClient, chatId, history);

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
  permissionModesResponse = PERMISSION_MODES_RESPONSE;
  fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    if (pathname === "/api/v1/models") return jsonResponse(MODELS_RESPONSE);
    if (pathname === "/api/v1/permission-modes") {
      return jsonResponse(permissionModesResponse);
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
  it("restores bypass from the last message when the mode is still offered", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
    render(
      chatPageTreeWithHistory(queryClient, CHAT_ONE, {
        modelId: "system:openai:gpt-5.4-mini",
        status: "completed",
        permissionMode: "bypass",
      }),
    );

    await screen.findByRole("button", { name: "Permission mode, Bypass" });
  });

  it("restores bypass when the listing resolves after history and models", async () => {
    // Defer only the permission-modes route: model catalog and history settle
    // first, so a naive "pending listing == withdrawn" latch would pin the
    // mode to default and never recover `bypass` once the listing offers it.
    let resolveModes!: (value: PermissionModesResponse) => void;
    const modesGate = new Promise<PermissionModesResponse>((resolve) => {
      resolveModes = resolve;
    });
    const originalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      if (new URL(request.url).pathname === "/api/v1/permission-modes") {
        return jsonResponse(await modesGate);
      }
      return originalFetch(input);
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
    render(
      chatPageTreeWithHistory(queryClient, CHAT_ONE, {
        modelId: "system:openai:gpt-5.4-mini",
        status: "completed",
        permissionMode: "bypass",
      }),
    );

    // History and models have resolved, but the listing is still pending — the
    // restore must not have pinned the mode to `default` yet.
    await screen.findByRole("textbox");
    resolveModes(PERMISSION_MODES_RESPONSE);

    await screen.findByRole("button", { name: "Permission mode, Bypass" });
  });

  it("restores bypass while the model catalog is still pending", async () => {
    // Defer only the /api/v1/models route: history and the permission listing
    // settle first. A permission latch that also waited on the catalog would
    // stay closed here and pin the mode to default, so this pins the catalog
    // independence of the permission restore.
    let resolveModels!: (value: ModelsResponse) => void;
    const modelsGate = new Promise<ModelsResponse>((resolve) => {
      resolveModels = resolve;
    });
    const originalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      if (new URL(request.url).pathname === "/api/v1/models") {
        return jsonResponse(await modelsGate);
      }
      return originalFetch(input);
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
    render(
      chatPageTreeWithHistory(queryClient, CHAT_ONE, {
        modelId: "system:openai:gpt-5.4-mini",
        status: "completed",
        permissionMode: "bypass",
      }),
    );

    // History and the listing have settled while the catalog stays pending —
    // the model selector renders its loading label, but the permission mode
    // must already have restored `bypass`.
    await screen.findByRole("button", { name: "Permission mode, Bypass" });
    expect(screen.getByRole("combobox").getAttribute("aria-label")).toBe(
      "Select model",
    );

    resolveModels(MODELS_RESPONSE);
  });

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

  it("reconciles a stored mode withdrawn from the listing", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
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

    permissionModesResponse = { modes: [{ value: "default" }] };
    await queryClient.invalidateQueries({ queryKey: permissionModesQueryKey });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Permission mode, Bypass" }),
      ).toBeNull();
    });

    permissionModesResponse = PERMISSION_MODES_RESPONSE;
    await queryClient.invalidateQueries({ queryKey: permissionModesQueryKey });
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
    const sendButton = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => {
      // SAFETY: the composer's send control is a native <button>; reading
      // `.disabled` confirms the send path is enabled before the click.
      expect((sendButton as HTMLButtonElement).disabled).toBe(false);
    });
    await user.type(input, "follow-up");
    await user.click(sendButton);
    await waitFor(async () => {
      const messageRequest = fetchMock.mock.calls
        .map(([input]) =>
          input instanceof Request ? input : new Request(input),
        )
        .find(
          (request) =>
            request.method === "POST" &&
            new URL(request.url).pathname.endsWith("/messages"),
        );
      if (!messageRequest) {
        throw new Error("chat send request was not emitted");
      }
      // SAFETY: the transport emits this JSON envelope; this narrowed type
      // reads only the optional permission mode field under test.
      const body = (await messageRequest.clone().json()) as SentChatRequestBody;
      expect(body.permissionMode).toBe("bypass");
    });
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

describe("resolveLastTurnModelEffort", () => {
  const data: ModelsResponse = {
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
  const turn = {
    modelId: "system:openai:gpt-5.4-mini" as const,
    effort: undefined,
    permissionMode: "bypass" as const,
  };

  it("restores the recorded model by default", () => {
    expect(resolveLastTurnModelEffort(data, turn)).toEqual({
      modelId: "system:openai:gpt-5.4-mini",
      effort: undefined,
    });
  });
});

describe("resolveRestoredPermissionMode", () => {
  const turn = {
    modelId: "system:openai:gpt-5.4-mini" as const,
    effort: undefined,
    permissionMode: "bypass" as const,
  };

  it("restores bypass only when the operator still lists it", () => {
    const modes: PermissionModesResponse["modes"] = [
      { value: "default" },
      { value: "bypass" },
    ];
    expect(resolveRestoredPermissionMode(modes, turn)).toBe("bypass");
  });

  it("falls back to default when the last turn's bypass is withdrawn", () => {
    const modes: PermissionModesResponse["modes"] = [{ value: "default" }];
    expect(resolveRestoredPermissionMode(modes, turn)).toBe("default");
  });

  it("treats a missing listing as withdrawn rather than restoring bypass", () => {
    expect(resolveRestoredPermissionMode([], turn)).toBe("default");
  });
});
