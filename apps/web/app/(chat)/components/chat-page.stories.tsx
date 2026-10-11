import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MessageResponse } from "@workspace/ui/components/ai-elements/message-response";
import { ReasoningContent } from "@workspace/ui/components/ai-elements/reasoning-content";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { ChatProvider } from "@/contexts/chat-context";
import { rawChatMessage } from "@/lib/services/chat/message-fixtures";
import { seedChatMessagesQueryData } from "@/lib/services/chat/queries";
// Import via the REAL specifiers: sb.mock (preview.tsx) redirects them to the
// __mocks__ modules, so these are the SAME hook instances the page reads.
import * as modelQueries from "@/lib/services/models/queries";
import * as permissionModeQueries from "@/lib/services/permission-modes/queries";
import {
  emptyResponse,
  jsonResponse,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import { ChatPage } from "./chat-page";
import {
  setChatMarkdownLoadForTests,
  type ChatMarkdownRenderers,
} from "./use-chat-markdown-ready";

const useModelsQuery = vi.mocked(modelQueries.useModelsQuery, {
  partial: true,
});
const usePermissionModesQuery = vi.mocked(
  permissionModeQueries.usePermissionModesQuery,
  { partial: true },
);

const CHAT_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";
const HISTORY_ROUTE = `GET /api/v1/chats/${CHAT_ID}/messages`;
const RESUME_ROUTE = `GET /api/v1/chats/${CHAT_ID}/stream`;
// The server page seeds an opened chat's history into the query cache, so the
// browser only probes for a run to resume (204: none) and re-reads history
// once the probe settles.
const OPEN_CHAT_ROUTES = [RESUME_ROUTE, HISTORY_ROUTE];

const HISTORY = [
  rawChatMessage({
    id: "m1",
    chatId: CHAT_ID,
    role: "user",
    seq: 1,
    parts: [{ type: "text", text: "Hello from history" }],
  }),
];

const RENDERERS: ChatMarkdownRenderers = { MessageResponse, ReasoningContent };

type ChunkLoad = {
  resolve: (renderers: ChatMarkdownRenderers) => void;
  reject: (error: unknown) => void;
};

// Each renderer chunk import the page starts, held until the story settles it.
// Executor form: apps/web's TypeScript lib predates Promise.withResolvers.
let chunkLoads: Array<ChunkLoad> = [];

function holdMarkdownChunks() {
  chunkLoads = [];
  setChatMarkdownLoadForTests(
    () =>
      new Promise<ChatMarkdownRenderers>((resolve, reject) => {
        chunkLoads.push({ resolve, reject });
      }),
  );
  return () => setChatMarkdownLoadForTests(null);
}

/** Settles the `attempt`-th chunk import (1-based) once the page starts it. */
async function chunkLoad(attempt: number) {
  await waitFor(() => expect(chunkLoads).toHaveLength(attempt));
  const load = chunkLoads[attempt - 1];
  if (load === undefined) throw new Error(`no chunk import ${attempt}`);
  return load;
}

// The resume probe and the history re-read run through the REAL hooks against
// a stubbed fetch, answering as the api does for a chat with no active run.
// Any other request is recorded and the meta's afterEach fails the story on it:
// the throw alone only becomes a query error.
let fetchMock: Mock<typeof fetch>;
let unrouted: Array<string> = [];

function routeOpenChat() {
  fetchMock = stubFetch();
  unrouted = [];
  fetchMock.mockImplementation((input) => {
    const request = input instanceof Request ? input : new Request(input);
    const key = `${request.method} ${new URL(request.url).pathname}`;
    if (key === HISTORY_ROUTE) {
      return Promise.resolve(jsonResponse({ messages: HISTORY }));
    }
    if (key === RESUME_ROUTE) return Promise.resolve(emptyResponse());
    unrouted.push(key);
    throw new Error(`unrouted fetch in story: ${key}`);
  });
  return () => {
    vi.unstubAllGlobals();
  };
}

/** "METHOD /path" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => {
    const request = input instanceof Request ? input : new Request(input);
    return `${request.method} ${new URL(request.url).pathname}`;
  });
}

// A per-story client seeded the way the server page seeds it
// (app/(chat)/chat/[id]/page.tsx), with the app's own 60 s staleTime, so the
// history is in place on the page's first render.
let queryClient: QueryClient;

function seedHistory(chatExists: boolean) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60 * 1000 } },
  });
  if (chatExists) {
    seedChatMessagesQueryData(queryClient, CHAT_ID, {
      messages: HISTORY,
      compaction: null,
    });
  }
}

function composer(canvasElement: HTMLElement) {
  return within(canvasElement).getByPlaceholderText(
    "What would you like to know?",
  );
}

const meta = {
  component: ChatPage,
  args: { chatId: CHAT_ID, initialChatExists: true, initialDraftPhase: null },
  beforeEach: ({ args }) => {
    seedHistory(args.initialChatExists);
    useModelsQuery.mockReturnValue({
      data: {
        defaultModelId: "system:openai:gpt-5.4-mini",
        models: [
          {
            id: "system:openai:gpt-5.4-mini",
            source: "system",
            name: "GPT-5.4 mini",
            contextWindowTokens: 400_000,
          },
        ],
      },
      isError: false,
      isPending: false,
    });
    usePermissionModesQuery.mockReturnValue({
      data: { modes: [{ value: "default" }] },
      isError: false,
      isPending: false,
    });
    const restoreFetch = routeOpenChat();
    const restoreChunks = holdMarkdownChunks();
    return () => {
      restoreChunks();
      restoreFetch();
    };
  },
  afterEach: async () => {
    await expect(unrouted).toEqual([]);
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <ChatProvider>
          <div className="flex h-150 flex-col">
            <Story />
          </div>
        </ChatProvider>
      </QueryClientProvider>
    ),
  ],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ChatPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * While the markdown renderer chunks load, an opened chat shows a centered
 * spinner in place of its transcript and keeps the composer disabled — even
 * with its history already fetched, no message bubble is painted yet.
 *
 * @summary spinner and a disabled composer while markdown chunks load
 */
export const MarkdownLoading: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("status", { name: "Loading" }),
    ).toBeVisible();
    await waitFor(() => expect(sentRoutes()).toEqual(OPEN_CHAT_ROUTES));

    await expect(canvas.queryByText("Hello from history")).toBeNull();
    await expect(canvas.queryByRole("log")).toBeNull();
    await expect(composer(canvasElement)).toBeDisabled();
  },
};

/**
 * Once the chunks load, the spinner gives way to the transcript with the
 * message bodies already in place, and the composer unlocks.
 *
 * @summary history and an enabled composer once markdown is ready
 */
export const MarkdownReady: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("status", { name: "Loading" }),
    ).toBeVisible();
    await waitFor(() => expect(sentRoutes()).toEqual(OPEN_CHAT_ROUTES));

    (await chunkLoad(1)).resolve(RENDERERS);

    await waitFor(() =>
      expect(
        within(canvas.getByRole("log")).getByText("Hello from history"),
      ).toBeVisible(),
    );
    await expect(canvas.queryByRole("status", { name: "Loading" })).toBeNull();
    await expect(composer(canvasElement)).toBeEnabled();
  },
};

/**
 * A failed chunk import replaces the spinner with a "Messages unavailable"
 * alert; Try again starts a fresh import behind the spinner, and its success
 * shows the history.
 *
 * @summary unavailable after a chunk failure, then recovered by Try again
 */
export const MarkdownUnavailable: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    (await chunkLoad(1)).reject(new Error("chunk failed"));

    await expect(await canvas.findByText("Messages unavailable")).toBeVisible();
    await waitFor(() => expect(sentRoutes()).toEqual(OPEN_CHAT_ROUTES));
    await expect(canvas.queryByRole("status", { name: "Loading" })).toBeNull();
    await expect(canvas.queryByText("Hello from history")).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(
      await canvas.findByRole("status", { name: "Loading" }),
    ).toBeVisible();
    await expect(canvas.queryByText("Messages unavailable")).toBeNull();

    (await chunkLoad(2)).resolve(RENDERERS);
    await waitFor(() =>
      expect(canvas.getByText("Hello from history")).toBeVisible(),
    );
    await expect(canvas.queryByText("Messages unavailable")).toBeNull();
  },
};

/**
 * A fresh draft has no history to wait for, yet still holds the composer
 * behind the spinner until the chunks load, so its first message never lands
 * in an empty bubble. Nothing is requested from the api.
 *
 * @summary a fresh draft's composer unlocks only once markdown is ready
 */
export const DraftMarkdownLoading: Story = {
  args: { initialChatExists: false, initialDraftPhase: "fresh" },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("status", { name: "Loading" }),
    ).toBeVisible();
    await expect(composer(canvasElement)).toBeDisabled();

    (await chunkLoad(1)).resolve(RENDERERS);

    await waitFor(() =>
      expect(canvas.queryByRole("status", { name: "Loading" })).toBeNull(),
    );
    await expect(composer(canvasElement)).toBeEnabled();
    await expect(sentRoutes()).toEqual([]);
  },
};
