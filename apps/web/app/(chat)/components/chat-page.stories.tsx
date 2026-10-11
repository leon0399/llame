import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MessageResponse } from "@workspace/ui/components/ai-elements/message-response";
import { ReasoningContent } from "@workspace/ui/components/ai-elements/reasoning-content";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { ChatProvider } from "@/contexts/chat-context";
import type { ChatMessageResponse } from "@/lib/services/chat/history";
import { rawChatMessage } from "@/lib/services/chat/message-fixtures";
import { seedChatMessagesQueryData } from "@/lib/services/chat/queries";
// Import via the REAL specifiers: sb.mock (preview.tsx) redirects them to the
// __mocks__ modules, so these are the SAME hook instances the page reads.
import * as modelQueries from "@/lib/services/models/queries";
import type { AvailableModel } from "@/lib/services/models/queries";
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
const SEND_ROUTE = `POST /api/v1/chats/${CHAT_ID}/messages`;
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

const GPT_5_4_MINI: AvailableModel = {
  id: "system:openai:gpt-5.4-mini",
  source: "system",
  name: "GPT-5.4 mini",
  contextWindowTokens: 400_000,
};
const GPT_5_4: AvailableModel = {
  id: "system:openai:gpt-5.4",
  source: "system",
  name: "GPT-5.4",
  contextWindowTokens: 400_000,
};

/** A one-turn history whose assistant reply recorded `usage`. */
function historyWithUsage(
  usage: ChatMessageResponse["usage"],
): Array<ChatMessageResponse> {
  return [
    rawChatMessage({
      id: "m1",
      chatId: CHAT_ID,
      role: "assistant",
      seq: 1,
      parts: [{ type: "text", text: "Reply from history" }],
      usage,
    }),
  ];
}

/** Story parameters: the opened chat's history (default `HISTORY`). */
type ChatPageParameters = { history?: Array<ChatMessageResponse> };

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
// a stubbed fetch, answering as the api does for a chat with no active run. A
// send is held unanswered: the stories assert only what it carries. Any other
// request is recorded and the meta's afterEach fails the story on it: the throw
// alone only becomes a query error.
let fetchMock: Mock<typeof fetch>;
let unrouted: Array<string> = [];

function routeOpenChat(history: Array<ChatMessageResponse>) {
  fetchMock = stubFetch();
  unrouted = [];
  fetchMock.mockImplementation((input) => {
    const request = input instanceof Request ? input : new Request(input);
    const key = `${request.method} ${new URL(request.url).pathname}`;
    if (key === HISTORY_ROUTE) {
      return Promise.resolve(jsonResponse({ messages: history }));
    }
    if (key === RESUME_ROUTE) return Promise.resolve(emptyResponse());
    if (key === SEND_ROUTE) return new Promise<Response>(() => {});
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

/** The JSON body of the first request sent to `route`. */
async function sentBody(route: string) {
  const index = sentRoutes().indexOf(route);
  const input = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) {
    throw new Error(`expected a Request for ${route}`);
  }
  return input.clone().json();
}

// A per-story client seeded the way the server page seeds it
// (app/(chat)/chat/[id]/page.tsx), with the app's own 60 s staleTime, so the
// history is in place on the page's first render.
let queryClient: QueryClient;

function seedHistory(chatExists: boolean, history: Array<ChatMessageResponse>) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60 * 1000 } },
  });
  if (chatExists) {
    seedChatMessagesQueryData(queryClient, CHAT_ID, {
      messages: history,
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
  beforeEach: ({ args, parameters }) => {
    const { history = HISTORY }: ChatPageParameters = parameters;
    seedHistory(args.initialChatExists, history);
    // isSuccess too: the page enables Send only on a successful catalog.
    useModelsQuery.mockReturnValue({
      data: { defaultModelId: GPT_5_4_MINI.id, models: [GPT_5_4_MINI] },
      isError: false,
      isPending: false,
      isSuccess: true,
    });
    usePermissionModesQuery.mockReturnValue({
      data: { modes: [{ value: "default" }] },
      isError: false,
      isPending: false,
    });
    const restoreFetch = routeOpenChat(history);
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

/** Loads the markdown chunks and waits for the composer they unlock. */
async function readyComposer(canvasElement: HTMLElement) {
  (await chunkLoad(1)).resolve(RENDERERS);
  await waitFor(() => expect(composer(canvasElement)).toBeEnabled());
  return composer(canvasElement);
}

/**
 * While the model catalog loads, a fresh draft's composer still takes typing,
 * but Send stays disabled and Enter sends nothing: the typed text stays put.
 *
 * @summary typing works but nothing sends while models load
 */
export const ModelsLoading: Story = {
  args: { initialChatExists: false, initialDraftPhase: "fresh" },
  tags: ["ai-generated"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
      isSuccess: false,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await readyComposer(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Send message" }),
    ).toBeDisabled();

    await userEvent.type(input, "Hello{Enter}");

    await expect(composer(canvasElement)).toHaveValue("Hello");
    await expect(
      canvas.getByRole("button", { name: "Send message" }),
    ).toBeDisabled();
    await expect(sentRoutes()).toEqual([]);
  },
};

/**
 * Once the catalog loads, a fresh draft selects the api's default model and
 * Send enables; the first message goes out with that model.
 *
 * @summary the api default is selected and the message sends with it
 */
export const SendsWithDefaultModel: Story = {
  args: { initialChatExists: false, initialDraftPhase: "fresh" },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await readyComposer(canvasElement);
    await expect(
      canvas.getByRole("combobox", { name: "Select model, GPT-5.4 mini" }),
    ).toBeVisible();

    await userEvent.type(input, "Hello");
    const send = canvas.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);

    await waitFor(() => expect(sentRoutes()).toEqual([SEND_ROUTE]));
    await expect(await sentBody(SEND_ROUTE)).toMatchObject({
      modelId: GPT_5_4_MINI.id,
      message: { parts: [{ type: "text", text: "Hello" }] },
    });
  },
};

/** Serves a two-model catalog whose default is GPT-5.4 mini. */
function serveTwoModelCatalog(gpt54: AvailableModel = GPT_5_4) {
  useModelsQuery.mockReturnValue({
    data: { defaultModelId: GPT_5_4_MINI.id, models: [GPT_5_4_MINI, gpt54] },
    isError: false,
    isPending: false,
    isSuccess: true,
  });
}

/** Waits until the opened chat's history shows and the page's requests
 *  settle, then returns the model selector. */
async function settledModelSelector(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await readyComposer(canvasElement);
  await waitFor(() =>
    expect(
      within(canvas.getByRole("log")).getByText("Reply from history"),
    ).toBeVisible(),
  );
  await waitFor(() => expect(sentRoutes()).toEqual(OPEN_CHAT_ROUTES));
  return canvas.getByRole("combobox", { name: /^Select model/ });
}

/**
 * Opening a chat selects the model its last reply used, not the default.
 *
 * @summary the last reply's model is selected
 */
export const RestoresLastModel: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: historyWithUsage({
      modelId: GPT_5_4.id,
      status: "completed",
    }),
  } satisfies ChatPageParameters,
  beforeEach: () => serveTwoModelCatalog(),
  play: async ({ canvasElement }) => {
    const selector = await settledModelSelector(canvasElement);
    await expect(selector).toHaveAccessibleName("Select model, GPT-5.4");
  },
};

/**
 * A chat whose last reply used a model no longer in the catalog opens on the
 * default model. The selection's catalog check would repair a retired id on
 * its own, so this documents the outcome; the last-turn fallback rule itself
 * is pinned by resolveLastTurnModelEffort's unit test.
 *
 * @summary a chat whose last model was retired opens on the default
 */
export const RetiredModelFallsBack: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: historyWithUsage({
      modelId: "system:openai:retired-model",
      status: "completed",
    }),
  } satisfies ChatPageParameters,
  beforeEach: () => serveTwoModelCatalog(),
  play: async ({ canvasElement }) => {
    const selector = await settledModelSelector(canvasElement);
    await expect(selector).toHaveAccessibleName("Select model, GPT-5.4 mini");
  },
};

/**
 * A chat whose last reply recorded no model (a legacy turn) opens on the
 * default model, the same outcome as a chat with no reply; like the retired
 * case, this documents the outcome rather than the fallback rule.
 *
 * @summary a chat whose last reply recorded no model opens on the default
 */
export const UnrecordedModelKeepsDefault: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: historyWithUsage({ status: "completed" }),
  } satisfies ChatPageParameters,
  beforeEach: () => serveTwoModelCatalog(),
  play: async ({ canvasElement }) => {
    const selector = await settledModelSelector(canvasElement);
    await expect(selector).toHaveAccessibleName("Select model, GPT-5.4 mini");
  },
};

/**
 * Opening a chat also restores the reasoning effort its last reply used,
 * rather than the model's default effort.
 *
 * @summary the last reply's reasoning effort is restored
 */
export const RestoresLastEffort: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: historyWithUsage({
      modelId: GPT_5_4.id,
      status: "completed",
      effort: "high",
    }),
  } satisfies ChatPageParameters,
  beforeEach: () =>
    serveTwoModelCatalog({
      ...GPT_5_4,
      reasoning: {
        effortLevels: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
        defaultEffort: "low",
        cacheInvalidatedByEffortChange: false,
      },
    }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selector = await settledModelSelector(canvasElement);
    await expect(selector).toHaveAccessibleName("Select model, GPT-5.4");
    await expect(
      canvas.getByRole("button", { name: "Reasoning effort, High" }),
    ).toBeVisible();
  },
};
