// @vitest-environment jsdom

/**
 * Renders the ACTUAL ChatPage against a pre-seeded QueryClient (mirroring
 * what SSR hydration provides on a real reload) with a real
 * useChatMessagesQuery, the real markdown renderer, and the real
 * ActiveRunsProvider (its GET /me/runs rehydration hits a stubbed
 * globalThis.fetch that always answers with no active runs — this suite's
 * focus is render wiring, not run polling, which contexts/active-runs-context.test.tsx
 * already covers). The AI SDK's useChat and next/navigation are mocked —
 * neither has an in-process seam.
 * Checkpoint rows are part of the SAME `chatQueryKeys.messages(chatId)`
 * cache entry as the conversation rows. `normalizeChatMessagesResponse`
 * extracts the owner checkpoint boundary before `toChatUiMessages` drops
 * non-conversation rows. This suite's reload seed mirrors that one-fetch
 * shape.
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
  metadata?: { seq?: number; usage?: ChatMessageResponse["usage"] };
}> = [];
let useChatStatus: "ready" | "submitted" | "streaming" = "ready";
let prepareQueryClient: ((queryClient: QueryClient) => void) | undefined;

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
      setMessages: vi.fn(),
      status: useChatStatus,
      stop: vi.fn(),
      error: undefined,
      // ChatPage drives resume itself (guarded against Strict Mode's double
      // mount effect — see its useChat call), so the stub must provide it.
      resumeStream: vi.fn(),
    };
  },
}));

import { ActiveRunsProvider } from "@/contexts/active-runs-context";
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
} from "@/lib/services/chat/history";

import { ChatPage } from "./chat-page";
import { ensureChatMarkdownRenderersLoaded } from "./use-chat-markdown-ready";

const NO_STATS: Compaction["stats"] = {
  beforeTokens: null,
  afterTokens: null,
  modelId: null,
};

beforeAll(async () => {
  await ensureChatMarkdownRenderersLoaded();
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

beforeEach(() => {
  // The real ActiveRunsProvider's mount rehydration (GET /me/runs) always
  // reports no active runs here — this suite's own coverage is render
  // wiring, not run polling (see contexts/active-runs-context.test.tsx).
  stubFetch().mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
});

afterEach(() => {
  useChatMessages = [];
  prepareQueryClient = undefined;
  capturedOnFinish = undefined;
  capturedResume = undefined;
  useChatStatus = "ready";
  // NOT vi.unstubAllGlobals() here — beforeAll's ResizeObserver stub (above)
  // must survive across tests in this file; each test's own fetch stub is
  // already replaced fresh by the next beforeEach's stubFetch() call.
  cleanup();
});

function renderChatPage(
  chatId: string,
  seed: {
    messages: typeof useChatMessages;
    compaction: Compaction | null;
  },
  targetSeq?: number,
  historyMessages = seed.messages,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Seed the SAME cache entry SSR hydration provides on a real reload —
  // BEFORE the component (and its query observer) ever mounts, same timing
  // as HydrationBoundary. The entry is the normalized cache shape: the seed's
  // `compaction` stands in for what `normalizeChatMessagesResponse` derives
  // from the newest checkpoint row, and its conversation rows are what
  // `toChatUiMessages` keeps. history.test.ts covers both derivations; this
  // suite pins how the page renders the result.
  const page = {
    messages: historyMessages.map((message, index) =>
      rawChatMessage({
        id: message.id,
        chatId,
        seq: message.metadata?.seq ?? index + 1,
        role: message.role,
        // SAFETY: `useChatMessages` fixtures in this suite always seed AI
        // SDK text/tool parts, matching `ChatMessageResponse["parts"]`'s
        // shape even though the local fixture type keeps `parts: unknown[]`.
        parts: message.parts as ChatMessageResponse["parts"],
        usage: message.metadata?.usage ?? null,
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

  const tree = () => (
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
  prepareQueryClient?.(queryClient);
  const rendered = render(tree());
  return {
    queryClient,
    ...rendered,
    rerenderChatPage: () => rendered.rerender(tree()),
  };
}

function seedWorkspaceCaches(queryClient: QueryClient, chatId: string) {
  const listKey = chatQueryKeys.infinite({ pinned: "exclude" });
  const detailKey = chatQueryKeys.detail(chatId);
  queryClient.setQueryData(listKey, {
    pages: [[{ id: chatId, workspaceRoot: "/home/operator/projects/llame" }]],
    pageParams: [undefined],
  });
  queryClient.setQueryData(detailKey, {
    id: chatId,
    workspaceRoot: "/home/operator/projects/llame",
  });
  return { listKey, detailKey };
}

describe("ChatPage — compaction checkpoint render", () => {
  it("renders the checkpoint when the chat history + compaction are both already cached (mirrors a real SSR-hydrated reload)", async () => {
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
        absorbedThroughSeq: 2,
        summary: "The user said hi, assistant replied hello.",
        createdAt: "2026-07-06T00:00:00.000Z",
        absorbedMessageCount: 2,
        stats: NO_STATS,
      },
    });

    const boundary = await screen.findByRole("button", {
      name: /context compacted/i,
    });
    expect(boundary.textContent).toContain("2 messages");
    const triggeringUser = screen.getByText("more");
    expect(
      boundary.compareDocumentPosition(triggeringUser) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the checkpoint at the TOP when the loaded window is entirely post-boundary", async () => {
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
        absorbedThroughSeq: 10,
        summary: "Old turns summarized.",
        createdAt: "2026-07-06T00:00:00.000Z",
        absorbedMessageCount: 1,
        stats: NO_STATS,
      },
    });

    expect(
      await screen.findByRole("button", {
        name: /context compacted/i,
      }),
    ).toBeTruthy();
  });

  it("renders the checkpoint at the BOTTOM when every loaded message is within the summarized span (absorbedThroughSeq near the end of a long history)", async () => {
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
        absorbedThroughSeq: 202,
        summary: "Compacted up to seq 202.",
        createdAt: "2026-07-06T00:00:00.000Z",
        absorbedMessageCount: 1,
        stats: NO_STATS,
      },
    });

    expect(
      await screen.findByRole("button", {
        name: /context compacted/i,
      }),
    ).toBeTruthy();
  });

  it("reload parity: conversation rows mapped by the real toChatUiMessages (not a hand-shaped fixture) plus a seeded compaction still render the boundary through the same cache seeding a real reload uses", async () => {
    const chatId = "chat-reload-parity";
    const rawMessages: Array<ChatMessageResponse> = [
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
      // SAFETY: `rawMessages` above only seeds "user"/"assistant" roles, and
      // `toChatUiMessages` is role-preserving, so `m.role` can't be anything
      // else here even though its own return type is the wider UI role set.
      role: m.role as "user" | "assistant",
      parts: m.parts,
      // SAFETY: `rawMessages` never sets a `seq`-bearing metadata shape
      // beyond `{ seq?: number }`; `toChatUiMessages` doesn't add other keys.
      metadata: m.metadata as { seq?: number } | undefined,
    }));

    renderChatPage(chatId, {
      messages: useChatMessages,
      compaction: {
        absorbedThroughSeq: 1,
        summary: "Absorbed the first turn.",
        createdAt: "2026-07-06T00:00:00.000Z",
        absorbedMessageCount: 1,
        stats: NO_STATS,
      },
    });

    expect(
      await screen.findByRole("button", { name: /context compacted/i }),
    ).toBeTruthy();
  });

  it("invalidates the chat messages query (which now carries compaction embedded) on a finished turn, so a compaction landing mid-conversation doesn't require a reload", async () => {
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

  it("refreshes chat binding caches when a live Workspace transition succeeds", async () => {
    const chatId = "chat-live-workspace-transition";
    const initialMessage = {
      id: "m1",
      role: "user" as const,
      parts: [{ type: "text", text: "enter the project" }],
      metadata: { seq: 1 },
    };
    const { queryClient, rerenderChatPage } = renderChatPage(chatId, {
      messages: [initialMessage],
      compaction: null,
    });
    const { listKey, detailKey } = seedWorkspaceCaches(queryClient, chatId);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    useChatMessages = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "enter the project" }],
        metadata: { seq: 1 },
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "tool-enter_workspace",
            toolCallId: "workspace-entry-1",
            state: "output-available",
            input: { path: "/home/operator/projects/llame" },
            output: {
              status: "success",
              root: "/home/operator/projects/llame",
            },
          },
        ],
        metadata: { seq: 2 },
      },
    ];
    useChatStatus = "streaming";
    rerenderChatPage();
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: chatQueryKeys.lists() }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: chatQueryKeys.detail(chatId),
        exact: true,
      });
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    });

    const transitionCallCount = invalidateSpy.mock.calls.length;
    useChatMessages = [
      ...useChatMessages,
      {
        id: "m3",
        role: "assistant",
        parts: [{ type: "text", text: "Workspace is ready." }],
        metadata: { seq: 3 },
      },
    ];
    rerenderChatPage();
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledTimes(transitionCallCount),
    );
  });

  it("refreshes binding caches when the live assistant stream starts", async () => {
    const chatId = "chat-live-workspace-preparation";
    const { queryClient, rerenderChatPage } = renderChatPage(chatId, {
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "continue the project" }],
          metadata: { seq: 1 },
        },
      ],
      compaction: null,
    });
    const { listKey, detailKey } = seedWorkspaceCaches(queryClient, chatId);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    useChatStatus = "streaming";
    rerenderChatPage();

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: chatQueryKeys.lists() }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: chatQueryKeys.detail(chatId),
        exact: true,
      });
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    });
  });

  it("refreshes binding caches at the start of each streamed Run", async () => {
    const chatId = "chat-live-workspace-two-runs";
    const { queryClient, rerenderChatPage } = renderChatPage(chatId, {
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "continue the project" }],
          metadata: { seq: 1 },
        },
      ],
      compaction: null,
    });
    const { listKey, detailKey } = seedWorkspaceCaches(queryClient, chatId);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    useChatStatus = "streaming";
    rerenderChatPage();
    await waitFor(() => {
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    });
    const firstRunCallCount = invalidateSpy.mock.calls.length;

    queryClient.setQueryData(listKey, {
      pages: [[{ id: chatId, workspaceRoot: "/home/operator/projects/next" }]],
      pageParams: [undefined],
    });
    queryClient.setQueryData(detailKey, {
      id: chatId,
      workspaceRoot: "/home/operator/projects/next",
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);

    useChatStatus = "ready";
    rerenderChatPage();
    useChatStatus = "streaming";
    rerenderChatPage();

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledTimes(firstRunCallCount + 2);
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    });
  });

  it("does not refresh binding caches for a historical transition on chat open", async () => {
    const chatId = "chat-historical-workspace-transition";
    useChatMessages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-enter_workspace",
            toolCallId: "workspace-history-1",
            state: "output-available",
            input: { path: "/home/operator/projects/llame" },
            output: {
              status: "success",
              root: "/home/operator/projects/llame",
            },
          },
        ],
        metadata: { seq: 1 },
      },
    ];
    const listKey = chatQueryKeys.infinite({ pinned: "exclude" });
    const detailKey = chatQueryKeys.detail(chatId);
    prepareQueryClient = (client) => {
      seedWorkspaceCaches(client, chatId);
    };
    const { queryClient } = renderChatPage(chatId, {
      messages: useChatMessages,
      compaction: null,
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: chatQueryKeys.lists() }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: chatQueryKeys.detail(chatId),
      exact: true,
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
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

    const switchTrigger = await screen.findByRole("button", {
      name: "Model changed from model-a to model-b",
    });
    // Body text waits on ChatMarkdownProvider the same way.
    const userText = await screen.findByText(
      "Triggering request",
      {},
      { timeout: 5000 },
    );
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
  it("renders no visible content for server-authored context parts", async () => {
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

    // Bodies are immediate once beforeAll warmed ChatMarkdownProvider.
    expect(await screen.findByText("Owner question")).toBeTruthy();
    expect(screen.queryByText(/unsupported part type/i)).toBeNull();
    // The digest's own content is prompt-side only; it must never surface as
    // chat content the owner reads back.
    expect(screen.queryByText(/Another chat/)).toBeNull();
    expect(
      screen.queryByText(/tools changed|another chat exists|future context/i),
    ).toBeNull();
    expect(screen.queryByText(/<system-reminder/)).toBeNull();
  });

  it("shows a run receipt action on a same-model assistant turn without inventing a switch boundary", async () => {
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
      await screen.findByRole("button", { name: "System prompt" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /model changed from/i }),
    ).toBeNull();
  });

  it("anchors a loaded Chat-local target and scrolls exactly once", async () => {
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
            pages: Array<{ messages: Array<ChatMessageResponse> }>;
          }>(chatQueryKeys.targetMessages(chatId, targetSeq))!.pages[0]!,
        },
      ],
      pageParams: [null],
    });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });
});
