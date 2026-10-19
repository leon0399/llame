import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MessageResponse } from "@workspace/ui/components/ai-elements/message-response";
import { ReasoningContent } from "@workspace/ui/components/ai-elements/reasoning-content";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useState, type ComponentProps } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { vi, type Mock } from "vitest";

import { ChatProvider } from "@/contexts/chat-context";
import { createAuthenticatedBrowserFetch } from "@/lib/api/fetch";
import type { ChatListItemResponse } from "@/lib/api/generated/models";
import { listPermissionModes } from "@/lib/api/generated/permission-modes/permission-modes";
import type {
  ChatMessageResponse,
  Compaction,
} from "@/lib/services/chat/history";
import { rawChatMessage } from "@/lib/services/chat/message-fixtures";
import {
  chatQueryKeys,
  seedChatMessagesQueryData,
} from "@/lib/services/chat/queries";
// Import via the REAL specifiers: sb.mock (preview.tsx) redirects them to the
// __mocks__ modules, so these are the SAME instances the page reads.
import * as runs from "@/lib/services/chat/runs";
import * as uploads from "@/lib/services/media/uploads";
import type { MediaDescriptor } from "@/lib/services/media/uploads";
import * as modelQueries from "@/lib/services/models/queries";
import type { AvailableModel } from "@/lib/services/models/queries";
import * as permissionModeQueries from "@/lib/services/permission-modes/queries";
import type { PermissionModesResponse } from "@/lib/services/permission-modes/queries";
import {
  emptyResponse,
  jsonResponse,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import { ChatHeader } from "./chat-header";
import { SessionDetailsProvider } from "./session-details/details-state";
import { SessionDetails } from "./session-details";
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
const runIdToCancel = vi.mocked(runs.runIdToCancel);
const cancelRun = vi.mocked(runs.cancelRun);

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
  input: ["text"],
};
const GPT_5_4: AvailableModel = {
  id: "system:openai:gpt-5.4",
  source: "system",
  name: "GPT-5.4",
  contextWindowTokens: 400_000,
  input: ["text"],
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

/** Story parameters: the opened chat's history (default `HISTORY`) and the
 *  URL fragment it opens at (default none). A `checkpointRow` in the history
 *  is what supplies the compaction boundary, as it does from the api. */
type ChatPageParameters = {
  history?: Array<ChatMessageResponse>;
  hash?: string;
};

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
// send is held unanswered: the stories assert only what it carries. A story
// can answer more routes with `routeAlso`. Any other request is recorded and
// the meta's afterEach fails the story on it: the throw alone only becomes a
// query error.
let fetchMock: Mock<typeof fetch>;
let unrouted: Array<string> = [];

/** The Request a fetch call carries. */
function requestOf(input: RequestInfo | URL) {
  return input instanceof Request ? input : new Request(input);
}

/** The "METHOD /path" a fetch call targets. */
function routeOf(input: RequestInfo | URL) {
  const request = requestOf(input);
  return `${request.method} ${new URL(request.url).pathname}`;
}

function routeOpenChat(history: Array<ChatMessageResponse>) {
  fetchMock = stubFetch();
  unrouted = [];
  fetchMock.mockImplementation((input) => {
    const key = routeOf(input);
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

/** Answers `routes` ahead of the opened chat's own routes. */
function routeAlso(
  routes: Record<string, (input: RequestInfo | URL) => Promise<Response>>,
) {
  const openChat = fetchMock.getMockImplementation();
  if (openChat === undefined) throw new Error("routeOpenChat must run first");
  fetchMock.mockImplementation((input, init) => {
    const answer = routes[routeOf(input)];
    return answer === undefined ? openChat(input, init) : answer(input);
  });
}

/** "METHOD /path" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
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
    // No seeded compaction: the opened chat's history re-read derives it from
    // a `checkpointRow` in `history`, the boundary's single source here.
    seedChatMessagesQueryData(queryClient, CHAT_ID, {
      messages: history,
      compaction: null,
    });
  }
}

function composer(canvasElement: HTMLElement) {
  return within(canvasElement).getByPlaceholderText(
    "Describe a task or ask a question",
  );
}

const meta = {
  component: ChatPage,
  args: { chatId: CHAT_ID, initialChatExists: true, initialDraftPhase: null },
  beforeEach: ({ args, parameters }) => {
    const { history = HISTORY, hash = "" }: ChatPageParameters = parameters;
    // The page reads and rewrites its URL (draft marker, #msg-N target), so
    // each story opens on its own chat route and leaves the URL as it was.
    const href = window.location.href;
    window.history.replaceState(
      window.history.state,
      "",
      `/chat/${CHAT_ID}${hash}`,
    );
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
      window.history.replaceState(window.history.state, "", href);
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

const uploadAttachment = vi.mocked(uploads.uploadAttachment);

const VISION: AvailableModel = {
  id: "system:openai:vision",
  source: "system",
  name: "Vision",
  contextWindowTokens: 400_000,
  input: ["text", "image"],
};

/** The stored descriptor of an uploaded `name`, under `id`. */
function uploaded(id: string, name: string): MediaDescriptor {
  return {
    id,
    locator: `media://${id}`,
    mediaType: "image/png",
    name,
    width: 4,
    height: 4,
    byteSize: 68,
    model: { mediaType: "image/png", width: 4, height: 4, byteSize: 68 },
  };
}

/**
 * On a vision model, two pasted images upload, and a message of images alone
 * goes out as their file parts, in paste order and without a text part; the
 * composer's attached row clears once it is sent.
 *
 * @summary an image-only message sends its file parts
 */
export const SendsImageOnlyMessage: Story = {
  args: { initialChatExists: false, initialDraftPhase: "fresh" },
  tags: ["ai-generated"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: { defaultModelId: VISION.id, models: [VISION] },
      isError: false,
      isPending: false,
      isSuccess: true,
    });
    const ids = [
      "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a01",
      "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a02",
    ];
    uploadAttachment.mockImplementation((file: File) => {
      const id = ids.shift();
      if (id === undefined) throw new Error("unexpected extra upload");
      return Promise.resolve(uploaded(id, file.name));
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await readyComposer(canvasElement);
    const send = canvas.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(send).toBeEnabled());

    const files = new DataTransfer();
    for (const name of ["a.png", "b.png"]) {
      files.items.add(new File(["png"], name, { type: "image/png" }));
    }
    await userEvent.click(input);
    await userEvent.paste(files);
    const form = input.closest("form");
    if (form === null) throw new Error("expected the composer form");
    const list = await within(form).findByRole("list", {
      name: "Attachments",
    });
    await waitFor(() =>
      expect(within(list).queryAllByRole("status")).toEqual([]),
    );
    await userEvent.click(send);

    await waitFor(() => expect(sentRoutes()).toEqual([SEND_ROUTE]));
    const body = await sentBody(SEND_ROUTE);
    await expect(body).toMatchObject({
      modelId: VISION.id,
      message: {
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            url: "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a01",
            filename: "a.png",
          },
          {
            type: "file",
            mediaType: "image/png",
            url: "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a02",
            filename: "b.png",
          },
        ],
      },
    });
    await expect(body.message.parts).toHaveLength(2);
    await waitFor(() =>
      expect(within(form).queryByRole("list", { name: "Attachments" })).toBe(
        null,
      ),
    );
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

/** Waits until the opened chat's history shows `text` and the page has sent
 *  exactly `routes` (default: the opened chat's own). */
async function settledChat(
  canvasElement: HTMLElement,
  routes: Array<string> = OPEN_CHAT_ROUTES,
  text = "Reply from history",
) {
  const canvas = within(canvasElement);
  await readyComposer(canvasElement);
  await waitFor(() =>
    expect(within(canvas.getByRole("log")).getByText(text)).toBeVisible(),
  );
  await waitFor(() => expect(sentRoutes()).toEqual(routes));
}

/** Waits for the settled chat, then returns the model selector. */
async function settledModelSelector(canvasElement: HTMLElement) {
  await settledChat(canvasElement);
  return within(canvasElement).getByRole("combobox", {
    name: /^Select model/,
  });
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

const MODES_ROUTE = "GET /api/v1/permission-modes";
const BOTH_MODES: PermissionModesResponse = {
  modes: [{ value: "default" }, { value: "bypass" }],
};
const DEFAULT_ONLY: PermissionModesResponse = { modes: [{ value: "default" }] };
const BYPASS_HISTORY = historyWithUsage({
  modelId: GPT_5_4_MINI.id,
  status: "completed",
  permissionMode: "bypass",
});
// #232 — the bypass trigger's destructive treatment falls below WCAG AA
// color-contrast until the token fix; every other a11y rule still runs.
const BYPASS_CHAT = {
  ...contrastKnownIssue232,
  history: BYPASS_HISTORY,
} satisfies ChatPageParameters;

/** Offers both permission modes from an already-loaded listing. */
function offerBothModes() {
  usePermissionModesQuery.mockReturnValue({
    data: BOTH_MODES,
    isError: false,
    isPending: false,
  });
}

/** The real hook's query — the preview sb.mocks the module that declares it —
 *  so a story can hold, change and refetch the listing the api serves. */
function useListedPermissionModes() {
  return useQuery({
    queryKey: permissionModeQueries.permissionModesQueryKey,
    queryFn: () =>
      listPermissionModes(
        undefined,
        createAuthenticatedBrowserFetch(globalThis.fetch),
      ),
    staleTime: 60_000,
  });
}

/** Fetches the listing from the api, which answers it with `answer`. */
function listModesFromApi(answer: () => Promise<Response>) {
  usePermissionModesQuery.mockImplementation(useListedPermissionModes);
  routeAlso({ [MODES_ROUTE]: answer });
}

/** Picks bypass from the composer's permission-mode menu. */
async function selectBypass(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(
    await canvas.findByRole("button", { name: "Permission mode, Default" }),
  );
  await userEvent.click(
    await within(document.body).findByRole("menuitemradio", {
      name: /Bypass/,
    }),
  );
  await waitFor(() =>
    expect(
      canvas.getByRole("button", { name: "Permission mode, Bypass" }),
    ).toBeVisible(),
  );
}

/**
 * Opening a chat whose last reply ran in bypass restores bypass while the
 * operator still offers it.
 *
 * @summary the last reply's bypass mode is restored
 */
export const RestoresBypass: Story = {
  tags: ["ai-generated"],
  parameters: BYPASS_CHAT,
  beforeEach: offerBothModes,
  play: async ({ canvasElement }) => {
    await settledChat(canvasElement);
    await expect(
      await within(canvasElement).findByRole("button", {
        name: "Permission mode, Bypass",
      }),
    ).toBeVisible();
  },
};

// The held permission-mode listing, answered by the story.
let answerModes: (response: Response) => void = () => {};

/**
 * When the mode listing arrives after the history and the model catalog, the
 * page shows no mode until it does, then restores bypass rather than having
 * settled on default meanwhile.
 *
 * @summary bypass is restored once a late mode listing arrives
 */
export const RestoresBypassAfterLateListing: Story = {
  tags: ["ai-generated"],
  parameters: BYPASS_CHAT,
  beforeEach: () =>
    listModesFromApi(
      () =>
        new Promise<Response>((resolve) => {
          answerModes = resolve;
        }),
    ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settledChat(canvasElement, [MODES_ROUTE, ...OPEN_CHAT_ROUTES]);
    await expect(
      canvas.queryByRole("button", { name: /^Permission mode/ }),
    ).toBeNull();

    answerModes(jsonResponse(BOTH_MODES));

    await expect(
      await canvas.findByRole("button", { name: "Permission mode, Bypass" }),
    ).toBeVisible();
  },
};

/**
 * The bypass restore does not wait for the model catalog: while models still
 * load, the chat already shows bypass next to the loading model selector.
 *
 * @summary bypass is restored while the model catalog loads
 */
export const RestoresBypassWhileModelsLoad: Story = {
  tags: ["ai-generated"],
  parameters: BYPASS_CHAT,
  beforeEach: () => {
    offerBothModes();
    useModelsQuery.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
      isSuccess: false,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settledChat(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Permission mode, Bypass" }),
    ).toBeVisible();
    await expect(canvas.getByRole("combobox")).toHaveAccessibleName(
      "Select model",
    );
  },
};

const OTHER_CHAT_ID = "b6ed346f-2ef9-4bbe-95f9-f1f358c7b246";
const OTHER_RESUME_ROUTE = `GET /api/v1/chats/${OTHER_CHAT_ID}/stream`;
const OTHER_HISTORY_ROUTE = `GET /api/v1/chats/${OTHER_CHAT_ID}/messages`;

/** The page plus a stand-in for the sidebar link to another chat, which
 *  re-renders the page under the same chat context with that chat's id. */
function ChatSwitcher(props: ComponentProps<typeof ChatPage>) {
  const [chatId, setChatId] = useState(props.chatId);
  return (
    <>
      <button type="button" onClick={() => setChatId(OTHER_CHAT_ID)}>
        Open another chat
      </button>
      <ChatPage {...props} chatId={chatId} />
    </>
  );
}

/**
 * Bypass picked in one chat stays with that chat: opening another chat shows
 * the default mode.
 *
 * @summary bypass does not follow the user into another chat
 */
export const BypassStaysWithItsChat: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: historyWithUsage({ status: "completed" }),
  } satisfies ChatPageParameters,
  render: (args) => <ChatSwitcher {...args} />,
  beforeEach: () => {
    offerBothModes();
    seedChatMessagesQueryData(queryClient, OTHER_CHAT_ID, {
      messages: [],
      compaction: null,
    });
    routeAlso({
      [OTHER_RESUME_ROUTE]: () => Promise.resolve(emptyResponse()),
      [OTHER_HISTORY_ROUTE]: () =>
        Promise.resolve(jsonResponse({ messages: [] })),
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settledChat(canvasElement);
    await selectBypass(canvasElement);

    await userEvent.click(
      canvas.getByRole("button", { name: "Open another chat" }),
    );

    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Permission mode, Default" }),
      ).toBeVisible(),
    );
    await waitFor(() =>
      expect(sentRoutes()).toEqual([
        ...OPEN_CHAT_ROUTES,
        OTHER_RESUME_ROUTE,
        OTHER_HISTORY_ROUTE,
      ]),
    );
  },
};

// The listing the api serves, changed by the story between refetches.
let listedModes = BOTH_MODES;

/**
 * When the operator withdraws bypass while a chat has it selected, the
 * selection resets: the control disappears with the withdrawn choice, and when
 * bypass is offered again the chat is back on default, not silently on bypass.
 *
 * @summary a withdrawn bypass selection resets to default
 */
export const WithdrawnBypassResets: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: historyWithUsage({ status: "completed" }),
  } satisfies ChatPageParameters,
  beforeEach: () => {
    listedModes = BOTH_MODES;
    listModesFromApi(() => Promise.resolve(jsonResponse(listedModes)));
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settledChat(canvasElement, [MODES_ROUTE, ...OPEN_CHAT_ROUTES]);
    await selectBypass(canvasElement);

    // A refetch (window focus, staleness) picks up the operator's change.
    listedModes = DEFAULT_ONLY;
    await queryClient.invalidateQueries({
      queryKey: permissionModeQueries.permissionModesQueryKey,
    });
    await waitFor(() =>
      expect(
        canvas.queryByRole("button", { name: /^Permission mode/ }),
      ).toBeNull(),
    );

    listedModes = BOTH_MODES;
    await queryClient.invalidateQueries({
      queryKey: permissionModeQueries.permissionModesQueryKey,
    });
    await expect(
      await canvas.findByRole("button", { name: "Permission mode, Default" }),
    ).toBeVisible();
  },
};

// The held send, answered by the story.
let answerSend: (response: Response) => void = () => {};

/**
 * A send carries the chat's bypass selection; when the api rejects it because
 * bypass is no longer available, the chat falls back to default and re-reads
 * the mode listing.
 *
 * @summary a rejected bypass send resets to default and refetches the modes
 */
export const UnavailableBypassResets: Story = {
  tags: ["ai-generated"],
  // #232 — the transcript's destructive error alert falls below WCAG AA
  // color-contrast until the token fix; every other a11y rule still runs.
  parameters: {
    ...contrastKnownIssue232,
    history: historyWithUsage({ status: "completed" }),
  } satisfies ChatPageParameters,
  beforeEach: () => {
    listModesFromApi(() => Promise.resolve(jsonResponse(BOTH_MODES)));
    routeAlso({
      [SEND_ROUTE]: () =>
        new Promise<Response>((resolve) => {
          answerSend = resolve;
        }),
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const opened = [MODES_ROUTE, ...OPEN_CHAT_ROUTES];
    await settledChat(canvasElement, opened);
    await selectBypass(canvasElement);

    await userEvent.type(composer(canvasElement), "follow-up");
    const send = canvas.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    await waitFor(() => expect(sentRoutes()).toEqual([...opened, SEND_ROUTE]));
    await expect(await sentBody(SEND_ROUTE)).toMatchObject({
      permissionMode: "bypass",
    });

    answerSend(
      jsonResponse(
        {
          statusCode: 422,
          error: "Unprocessable Entity",
          message: "Permission mode is no longer available",
          code: "permission_mode_not_available",
        },
        422,
      ),
    );

    await expect(
      await canvas.findByRole("button", { name: "Permission mode, Default" }),
    ).toBeVisible();
    // The rejection re-reads the listing, then the history — once for the
    // error and once for the errored finish.
    await waitFor(() =>
      expect(sentRoutes()).toEqual([
        ...opened,
        SEND_ROUTE,
        MODES_ROUTE,
        HISTORY_ROUTE,
        HISTORY_ROUTE,
      ]),
    );
  },
};

const TARGET_HASH = "#msg-900";
// Query strings of the history read for a #msg-900 target and of the ordinary
// newest-page read.
const TARGET_QUERY = "?limit=100&targetSeq=900";
const LATEST_QUERY = "?limit=100";

/** Assistant replies, each `[id, seq, text]`, as the history api returns them. */
function replies(
  ...rows: Array<[id: string, seq: number, text: string]>
): Array<ChatMessageResponse> {
  return rows.map(([id, seq, text]) =>
    rawChatMessage({
      id,
      chatId: CHAT_ID,
      role: "assistant",
      seq,
      parts: [{ type: "text", text }],
    }),
  );
}

// The server seeds the chat's newest page; the window around a #msg-N target
// is a read only the browser sends, since the server never sees the fragment.
const NEWEST = replies(["newest", 990, "newest"]);
const TARGET_WINDOW = replies(
  ["older", 701, "older target context"],
  ["target", 900, "target answer"],
);
const TARGET_CHAT = {
  hash: TARGET_HASH,
  history: NEWEST,
} satisfies ChatPageParameters;
// #232 — the destructive "Message unavailable" alert falls below WCAG AA
// color-contrast until the token fix; every other a11y rule still runs.
const UNAVAILABLE_TARGET_CHAT = {
  ...contrastKnownIssue232,
  ...TARGET_CHAT,
} satisfies ChatPageParameters;

/** Answers with `messages` as one history page. */
function historyPage(messages: Array<ChatMessageResponse>) {
  return () => Promise.resolve(jsonResponse({ messages }));
}

/** Answers history reads that carry `targetSeq` with `target`, and the
 *  ordinary newest-page read with `latest`. */
function routeHistory(
  target: () => Promise<Response>,
  latest: () => Promise<Response>,
) {
  routeAlso({
    [HISTORY_ROUTE]: (input) =>
      new URL(requestOf(input).url).searchParams.has("targetSeq")
        ? target()
        : latest(),
  });
}

/** The query string of every history read sent so far, in order. */
function sentHistoryQueries() {
  return fetchMock.mock.calls.flatMap(([input]) =>
    routeOf(input) === HISTORY_ROUTE
      ? [new URL(requestOf(input).url).search]
      : [],
  );
}

/** The page's URL past the origin: path, query and fragment. */
function pageUrl() {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

/** Waits until the transcript shows `text`. */
async function transcriptShows(canvasElement: HTMLElement, text: string) {
  await waitFor(() =>
    expect(
      within(within(canvasElement).getByRole("log")).getByText(text),
    ).toBeVisible(),
  );
}

/** Loads the markdown chunks and waits for the target window's answer. */
async function openedTarget(canvasElement: HTMLElement) {
  await readyComposer(canvasElement);
  await transcriptShows(canvasElement, "target answer");
}

/** Types a follow-up into the composer and sends it. */
async function sendFollowUp(canvasElement: HTMLElement) {
  await userEvent.type(composer(canvasElement), "follow-up");
  const send = within(canvasElement).getByRole("button", {
    name: "Send message",
  });
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.click(send);
}

/** A reply streamed the way the api streams it, encoded by the SDK's own
 *  UI-message stream; the stream ends once `ended` settles. */
function streamedReply(
  ended: Promise<void> = Promise.resolve(),
  messageId = "reply-1",
) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start", messageId });
        writer.write({ type: "text-start", id: "text-1" });
        writer.write({
          type: "text-delta",
          id: "text-1",
          delta: "streamed reply",
        });
        await ended;
        writer.write({ type: "text-end", id: "text-1" });
        // The api's terminal chunk carries the run's completion marker; the
        // client reads it to tell a finished turn from a cut stream (#1284).
        writer.write({ type: "finish", finishReason: "stop" });
      },
    }),
  });
}

/** The `#msg-N` link anchors in the transcript, in order. */
function messageAnchors(canvasElement: HTMLElement) {
  return [...canvasElement.querySelectorAll('[id^="msg-"]')].map(
    (element) => element.id,
  );
}

// The held #msg-900 window read, answered by the story.
let answerTarget: (response: Response) => void = () => {};

/**
 * Opening a chat at `#msg-900` mounts nothing until the window around that
 * message arrives — never the newest page the server seeded — then shows
 * that window.
 *
 * @summary a #msg-N link opens the target window, not the newest page
 */
export const OpensTargetMessage: Story = {
  tags: ["ai-generated"],
  parameters: TARGET_CHAT,
  beforeEach: () =>
    routeHistory(
      () =>
        new Promise<Response>((resolve) => {
          answerTarget = resolve;
        }),
      historyPage(NEWEST),
    ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(sentRoutes()).toEqual([HISTORY_ROUTE]));
    await expect(sentHistoryQueries()).toEqual([TARGET_QUERY]);
    await expect(canvas.queryByText("newest")).toBeNull();
    await expect(
      canvas.queryByPlaceholderText("Describe a task or ask a question"),
    ).toBeNull();

    answerTarget(jsonResponse({ messages: TARGET_WINDOW }));

    await openedTarget(canvasElement);
    await transcriptShows(canvasElement, "older target context");
    await expect(canvas.queryByText("newest")).toBeNull();
    await expect(sentRoutes()).toEqual([HISTORY_ROUTE]);
    // Each durable message carries its `#msg-N` link anchor.
    await expect(messageAnchors(canvasElement)).toEqual(["msg-701", "msg-900"]);
    await expect(canvasElement.querySelector("#msg-900")).toHaveTextContent(
      "target answer",
    );
  },
};

/** The closed "Message unavailable" state: no composer, no newest page, and
 *  only the one target read sent. */
async function closedTarget(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(
    within(await canvas.findByRole("alert")).getByText("Message unavailable"),
  ).toBeVisible();
  await expect(
    canvas.queryByPlaceholderText("Describe a task or ask a question"),
  ).toBeNull();
  await expect(canvas.queryByText("newest")).toBeNull();
  await expect(sentRoutes()).toEqual([HISTORY_ROUTE]);
  await expect(sentHistoryQueries()).toEqual([TARGET_QUERY]);
}

/** Answers the target read with the api's `status` error. */
function failTargetRead(status: 404 | 500) {
  routeHistory(
    () =>
      Promise.resolve(
        jsonResponse(
          {
            statusCode: status,
            error: status === 404 ? "Not Found" : "Internal Server Error",
            message: "Message not available",
          },
          status,
        ),
      ),
    historyPage(NEWEST),
  );
}

/**
 * A target the api no longer has (404) closes the page on a "Message
 * unavailable" alert, with no composer and no fallback to the newest page.
 *
 * @summary a missing target shows Message unavailable and no composer
 */
export const TargetNotFound: Story = {
  tags: ["ai-generated"],
  parameters: UNAVAILABLE_TARGET_CHAT,
  beforeEach: () => failTargetRead(404),
  play: async ({ canvasElement }) => closedTarget(canvasElement),
};

/**
 * A target read the api fails (500) closes the page the same way.
 *
 * @summary a failed target read shows Message unavailable and no composer
 */
export const TargetReadFails: Story = {
  tags: ["ai-generated"],
  parameters: UNAVAILABLE_TARGET_CHAT,
  beforeEach: () => failTargetRead(500),
  play: async ({ canvasElement }) => closedTarget(canvasElement),
};

/**
 * A `#msg-N` link into a chat that does not exist stays closed on the alert
 * rather than opening a fresh draft's composer.
 *
 * @summary a target in a missing chat does not open a fresh draft
 */
export const TargetInMissingChat: Story = {
  args: { initialChatExists: false, initialDraftPhase: "fresh" },
  tags: ["ai-generated"],
  parameters: UNAVAILABLE_TARGET_CHAT,
  beforeEach: () => failTargetRead(404),
  play: async ({ canvasElement }) => closedTarget(canvasElement),
};

/**
 * Leaving an unavailable target for the chat itself (the fragment cleared)
 * replaces the alert with the chat's newest page.
 *
 * @summary clearing the target after an error opens the newest page
 */
export const ClearedTargetOpensLatest: Story = {
  tags: ["ai-generated"],
  // The alert is gone by the end, so every a11y rule runs.
  parameters: TARGET_CHAT,
  beforeEach: () => failTargetRead(404),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await closedTarget(canvasElement);

    window.history.replaceState(window.history.state, "", `/chat/${CHAT_ID}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    await readyComposer(canvasElement);
    await transcriptShows(canvasElement, "newest");
    await expect(canvas.queryByRole("alert")).toBeNull();
    await waitFor(() =>
      expect(sentRoutes()).toEqual([HISTORY_ROUTE, ...OPEN_CHAT_ROUTES]),
    );
    await expect(sentHistoryQueries()).toEqual([TARGET_QUERY, LATEST_QUERY]);
  },
};

/**
 * Without a `#msg-N` fragment the chat opens on its newest page and never
 * asks for a target window.
 *
 * @summary no fragment opens the newest page
 */
export const OpensLatestWithoutTarget: Story = {
  tags: ["ai-generated"],
  parameters: { history: NEWEST } satisfies ChatPageParameters,
  play: async ({ canvasElement }) => {
    await readyComposer(canvasElement);
    await transcriptShows(canvasElement, "newest");
    await waitFor(() => expect(sentRoutes()).toEqual(OPEN_CHAT_ROUTES));
    await expect(sentHistoryQueries()).toEqual([LATEST_QUERY]);
  },
};

/**
 * Sending from a target window moves the URL to the hashless sent-draft
 * route at once, while the window itself stays on screen with the follow-up
 * as long as the reply is in flight.
 *
 * @summary a target send in flight keeps the window and drops the fragment
 */
export const TargetSendInFlight: Story = {
  tags: ["ai-generated"],
  parameters: TARGET_CHAT,
  beforeEach: () =>
    routeHistory(historyPage(TARGET_WINDOW), historyPage(NEWEST)),
  play: async ({ canvasElement }) => {
    await openedTarget(canvasElement);
    await sendFollowUp(canvasElement);

    await waitFor(() =>
      expect(sentRoutes()).toEqual([HISTORY_ROUTE, SEND_ROUTE]),
    );
    await expect(await sentBody(SEND_ROUTE)).toMatchObject({
      message: { parts: [{ type: "text", text: "follow-up" }] },
    });
    await expect(pageUrl()).toBe(`/chat/${CHAT_ID}?draft=sent`);
    await transcriptShows(canvasElement, "follow-up");
    await transcriptShows(canvasElement, "older target context");
    await transcriptShows(canvasElement, "target answer");
    // The live follow-up has no seq yet, so it carries no link anchor.
    await expect(messageAnchors(canvasElement)).toEqual(["msg-701", "msg-900"]);
  },
};

/**
 * Once the reply to a target send finishes, the page leaves the target
 * window for the chat's newest page, and the URL drops the draft marker.
 *
 * @summary a finished target send opens the newest page
 */
export const TargetSendFinishOpensLatest: Story = {
  tags: ["ai-generated"],
  parameters: TARGET_CHAT,
  beforeEach: () => {
    routeHistory(
      historyPage(TARGET_WINDOW),
      historyPage(
        replies(
          ["target", 900, "target answer"],
          ["latest", 1000, "latest durable answer"],
        ),
      ),
    );
    routeAlso({
      [SEND_ROUTE]: () =>
        new Promise<Response>((resolve) => {
          answerSend = resolve;
        }),
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openedTarget(canvasElement);
    await sendFollowUp(canvasElement);
    await waitFor(() => expect(pageUrl()).toBe(`/chat/${CHAT_ID}?draft=sent`));

    answerSend(streamedReply());

    await transcriptShows(canvasElement, "latest durable answer");
    await expect(canvas.queryByText("older target context")).toBeNull();
    await expect(pageUrl()).toBe(`/chat/${CHAT_ID}`);
    // The finish re-reads the target window; the newest page then opens: read,
    // probed for a run to resume (204: none), and re-read.
    await waitFor(() =>
      expect(sentRoutes()).toEqual([
        HISTORY_ROUTE,
        SEND_ROUTE,
        HISTORY_ROUTE,
        HISTORY_ROUTE,
        RESUME_ROUTE,
        HISTORY_ROUTE,
      ]),
    );
    await expect(sentHistoryQueries()).toEqual([
      TARGET_QUERY,
      TARGET_QUERY,
      LATEST_QUERY,
      LATEST_QUERY,
    ]);
  },
};

// Released by the story once the remounted page shows the pre-send snapshot.
let releaseLatest: () => void = () => {};

/**
 * #1084: after a target send finishes, the newest page can still be the
 * pre-send snapshot, whose last reply used another model and bypass. The
 * composer keeps the selections the send used — the defaults here — both
 * over that snapshot and once the post-send page arrives.
 *
 * @summary a finished target send keeps the selections it sent with
 */
export const TargetSendKeepsSentSelections: Story = {
  tags: ["ai-generated"],
  parameters: {
    hash: TARGET_HASH,
    history: [
      rawChatMessage({
        id: "newest",
        chatId: CHAT_ID,
        role: "assistant",
        seq: 990,
        parts: [{ type: "text", text: "newest" }],
        usage: {
          status: "completed",
          modelId: GPT_5_4.id,
          permissionMode: "bypass",
        },
      }),
    ],
  } satisfies ChatPageParameters,
  beforeEach: () => {
    serveTwoModelCatalog();
    offerBothModes();
    const latest = new Promise<void>((resolve) => {
      releaseLatest = resolve;
    });
    routeHistory(historyPage(TARGET_WINDOW), () =>
      latest.then(() =>
        jsonResponse({
          messages: [
            ...replies(["target", 900, "target answer"]),
            rawChatMessage({
              id: "latest",
              chatId: CHAT_ID,
              role: "assistant",
              seq: 1000,
              parts: [{ type: "text", text: "latest durable answer" }],
              usage: { status: "completed", modelId: GPT_5_4_MINI.id },
            }),
          ],
        }),
      ),
    );
    routeAlso({ [SEND_ROUTE]: () => Promise.resolve(streamedReply()) });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openedTarget(canvasElement);
    await sendFollowUp(canvasElement);

    await transcriptShows(canvasElement, "newest");
    await expect(canvas.getByRole("combobox")).toHaveAccessibleName(
      "Select model, GPT-5.4 mini",
    );
    await expect(
      canvas.getByRole("button", { name: "Permission mode, Default" }),
    ).toBeVisible();

    releaseLatest();

    await transcriptShows(canvasElement, "latest durable answer");
    await expect(canvas.getByRole("combobox")).toHaveAccessibleName(
      "Select model, GPT-5.4 mini",
    );
    await expect(
      canvas.getByRole("button", { name: "Permission mode, Default" }),
    ).toBeVisible();
  },
};

const AFTER_INTERRUPTION = replies(
  ["target", 900, "target answer"],
  ["latest", 1000, "latest after interruption"],
);

/** After an interrupted target send, the page opens the newest page on the
 *  hashless sent-draft route and probes for the run to resume. Each of the
 *  SDK's `reports` of the failure first re-reads the target window. */
async function recoveredFromInterruption(
  canvasElement: HTMLElement,
  reports: number,
) {
  await transcriptShows(canvasElement, "latest after interruption");
  await expect(
    within(canvasElement).queryByText("older target context"),
  ).toBeNull();
  await expect(pageUrl()).toBe(`/chat/${CHAT_ID}?draft=sent`);
  const rereads = Array.from({ length: reports }, () => HISTORY_ROUTE);
  await waitFor(() =>
    expect(sentRoutes()).toEqual([
      HISTORY_ROUTE,
      SEND_ROUTE,
      ...rereads,
      HISTORY_ROUTE,
      RESUME_ROUTE,
      HISTORY_ROUTE,
    ]),
  );
  await expect(sentHistoryQueries()).toEqual([
    TARGET_QUERY,
    ...rereads.map(() => TARGET_QUERY),
    LATEST_QUERY,
    LATEST_QUERY,
  ]);
}

/**
 * When the api fails a target send, the page keeps the recovery route —
 * hashless and still marked sent — opens the newest page, and probes for the
 * run, which may still be running server-side.
 *
 * @summary a failed target send recovers onto the newest page
 */
export const TargetSendErrorRecovers: Story = {
  tags: ["ai-generated"],
  parameters: TARGET_CHAT,
  beforeEach: () => {
    routeHistory(historyPage(TARGET_WINDOW), historyPage(AFTER_INTERRUPTION));
    routeAlso({
      [SEND_ROUTE]: () =>
        Promise.resolve(
          jsonResponse(
            {
              statusCode: 500,
              error: "Internal Server Error",
              message: "Internal server error",
            },
            500,
          ),
        ),
    });
  },
  play: async ({ canvasElement }) => {
    await openedTarget(canvasElement);
    await sendFollowUp(canvasElement);
    // The SDK reports the failure twice: as an error, then an errored finish.
    await recoveredFromInterruption(canvasElement, 2);
  },
};

/**
 * A network drop during a target send recovers the same way.
 *
 * @summary a disconnected target send recovers onto the newest page
 */
export const TargetSendDisconnectRecovers: Story = {
  tags: ["ai-generated"],
  parameters: TARGET_CHAT,
  beforeEach: () => {
    routeHistory(historyPage(TARGET_WINDOW), historyPage(AFTER_INTERRUPTION));
    routeAlso({
      [SEND_ROUTE]: () => Promise.reject(new TypeError("Failed to fetch")),
    });
  },
  play: async ({ canvasElement }) => {
    await openedTarget(canvasElement);
    await sendFollowUp(canvasElement);
    // As an error, then a disconnected finish.
    await recoveredFromInterruption(canvasElement, 2);
  },
};

/**
 * Stopping a target send's reply mid-stream recovers the same way.
 *
 * @summary a stopped target send recovers onto the newest page
 */
export const TargetSendStopRecovers: Story = {
  tags: ["ai-generated"],
  parameters: TARGET_CHAT,
  beforeEach: () => {
    routeHistory(historyPage(TARGET_WINDOW), historyPage(AFTER_INTERRUPTION));
    // The reply streams until the user stops it.
    routeAlso({
      [SEND_ROUTE]: () =>
        Promise.resolve(streamedReply(new Promise<void>(() => {}))),
    });
    // Stop cancels the reply's run, then closes the stream.
    runIdToCancel.mockReturnValue("reply-1");
    cancelRun.mockResolvedValue(undefined);
  },
  play: async ({ canvasElement }) => {
    await openedTarget(canvasElement);
    await sendFollowUp(canvasElement);
    await transcriptShows(canvasElement, "streamed reply");

    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Stop generation" }),
    );

    // A stop is no error: the SDK reports only the aborted finish.
    await recoveredFromInterruption(canvasElement, 1);
  },
};

/** Conversation rows, each `[role, seq, text]`, as the history api returns
 *  them. */
function turns(
  ...rows: Array<[role: "user" | "assistant", seq: number, text: string]>
): Array<ChatMessageResponse> {
  return rows.map(([role, seq, text]) =>
    rawChatMessage({
      id: `${role}-${seq}`,
      chatId: CHAT_ID,
      role,
      seq,
      parts: [{ type: "text", text }],
    }),
  );
}

/** The checkpoint compaction leaves once it summarized `absorbedMessageCount`
 *  messages through seq `absorbedThroughSeq`. */
function compactedThrough(
  absorbedThroughSeq: number,
  absorbedMessageCount: number,
): Compaction {
  return {
    absorbedThroughSeq,
    absorbedMessageCount,
    summary: "Earlier turns summarized.",
    createdAt: "2026-07-06T00:00:00.000Z",
    stats: { beforeTokens: null, afterTokens: null, modelId: null },
  };
}

/** That checkpoint's own row at `seq` in the history api's answer. The
 *  history re-read derives the compaction boundary from this row. */
function checkpointRow(seq: number, compaction: Compaction) {
  return rawChatMessage({
    id: `checkpoint-${seq}`,
    chatId: CHAT_ID,
    role: "checkpoint",
    seq,
    ...compaction,
  });
}

/** The transcript's "Context compacted" boundary. */
function compactionBoundary(canvasElement: HTMLElement) {
  return within(canvasElement).getByRole("button", {
    name: /^Context compacted/,
  });
}

/** The transcript element showing `text`. */
function transcriptText(canvasElement: HTMLElement, text: string) {
  return within(within(canvasElement).getByRole("log")).getByText(text);
}

/** Whether `first` comes before `second` in the page. */
function precedes(first: Node, second: Node) {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

const THROUGH_HELLO = compactedThrough(2, 2);

/**
 * A reopened chat that compaction summarized shows a "Context compacted"
 * boundary with the summarized message count, between the last summarized
 * message and the first one after it. Its history renders through the same
 * cache the server page seeds and the history api refreshes.
 *
 * @summary a compacted chat shows its boundary after the summarized turns
 */
export const CompactedHistory: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: [
      ...turns(["user", 1, "hi"], ["assistant", 2, "hello"]),
      checkpointRow(3, THROUGH_HELLO),
      ...turns(["user", 4, "more"]),
    ],
  } satisfies ChatPageParameters,
  play: async ({ canvasElement }) => {
    await settledChat(canvasElement, OPEN_CHAT_ROUTES, "more");
    const boundary = compactionBoundary(canvasElement);
    await expect(boundary).toHaveTextContent("2 messages");
    await expect(
      precedes(transcriptText(canvasElement, "hello"), boundary),
    ).toBe(true);
    await expect(
      precedes(boundary, transcriptText(canvasElement, "more")),
    ).toBe(true);
  },
};

const THROUGH_48 = compactedThrough(48, 1);

/**
 * When every loaded message came after the summarized span, the boundary
 * opens the transcript; a single summarized message reads in the singular.
 *
 * @summary the boundary sits on top when the window is all post-compaction
 */
export const CompactionAtTop: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: [
      checkpointRow(49, THROUGH_48),
      ...turns(["user", 50, "hi"], ["assistant", 51, "hello"]),
    ],
  } satisfies ChatPageParameters,
  play: async ({ canvasElement }) => {
    await settledChat(canvasElement, OPEN_CHAT_ROUTES, "hello");
    const boundary = compactionBoundary(canvasElement);
    await expect(boundary).toHaveTextContent(/1 message$/);
    await expect(precedes(boundary, transcriptText(canvasElement, "hi"))).toBe(
      true,
    );
  },
};

const THROUGH_202 = compactedThrough(202, 3);

/**
 * When every loaded message is inside the summarized span, the boundary
 * closes the transcript.
 *
 * @summary the boundary sits at the bottom when the window is all summarized
 */
export const CompactionAtBottom: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: [
      ...turns(
        ["user", 200, "turn 200"],
        ["assistant", 201, "turn 201"],
        ["user", 202, "turn 202"],
      ),
      checkpointRow(203, THROUGH_202),
    ],
  } satisfies ChatPageParameters,
  play: async ({ canvasElement }) => {
    await settledChat(canvasElement, OPEN_CHAT_ROUTES, "turn 202");
    await expect(
      precedes(
        transcriptText(canvasElement, "turn 202"),
        compactionBoundary(canvasElement),
      ),
    ).toBe(true);
  },
};

const CHAT_START = turns(["user", 1, "hi"], ["assistant", 2, "hello"]);

/** The history after the sent turn, compacted through "hello": the user turn
 *  persists under its client id, the reply carries its run's id. */
async function compactedAfterSend() {
  const { message }: { message: { id: string } } = await sentBody(SEND_ROUTE);
  return [
    ...CHAT_START,
    checkpointRow(3, THROUGH_HELLO),
    rawChatMessage({
      id: message.id,
      chatId: CHAT_ID,
      role: "user",
      seq: 4,
      parts: [{ type: "text", text: "follow-up" }],
    }),
    rawChatMessage({
      id: "assistant-5",
      chatId: CHAT_ID,
      role: "assistant",
      seq: 5,
      parts: [{ type: "text", text: "streamed reply" }],
      usage: { runId: "reply-1" },
    }),
  ];
}

/**
 * A compaction that lands during a turn shows up once the reply finishes,
 * without a reload: the finished turn re-reads the history, which now carries
 * the checkpoint.
 *
 * @summary a compaction during a turn appears once the reply finishes
 */
export const CompactionLandsMidConversation: Story = {
  tags: ["ai-generated"],
  parameters: { history: CHAT_START } satisfies ChatPageParameters,
  beforeEach: () =>
    routeAlso({
      [SEND_ROUTE]: () => Promise.resolve(streamedReply()),
      [HISTORY_ROUTE]: async () =>
        jsonResponse({
          messages: sentRoutes().includes(SEND_ROUTE)
            ? await compactedAfterSend()
            : CHAT_START,
        }),
    }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settledChat(canvasElement, OPEN_CHAT_ROUTES, "hello");
    await expect(
      canvas.queryByRole("button", { name: /^Context compacted/ }),
    ).toBeNull();

    await sendFollowUp(canvasElement);

    await waitFor(() =>
      expect(compactionBoundary(canvasElement)).toHaveTextContent("2 messages"),
    );
    await expect(
      precedes(
        transcriptText(canvasElement, "hello"),
        compactionBoundary(canvasElement),
      ),
    ).toBe(true);
    await expect(
      precedes(
        compactionBoundary(canvasElement),
        transcriptText(canvasElement, "follow-up"),
      ),
    ).toBe(true);
    await expect(sentRoutes()).toEqual([
      ...OPEN_CHAT_ROUTES,
      SEND_ROUTE,
      HISTORY_ROUTE,
    ]);
  },
};

const RUN_ID = "11111111-2222-4333-8444-555555555555";

/** A server-authored context part from `producer`, as the api persists it on
 *  the user message whose run it shaped. */
function contextPart<Payload>(
  producer: string,
  payload: Payload,
  reminder: string,
) {
  return {
    type: "data-context" as const,
    data: {
      v: 1,
      producer,
      form: "notice",
      runId: RUN_ID,
      payload,
      text: `<system-reminder producer="${producer}" form="notice">${reminder}</system-reminder>`,
    },
  };
}

const MODEL_CHANGE = contextPart(
  "effective-context-change",
  { cause: "model", fromModelId: "model-a", toModelId: "model-b" },
  "model changed",
);

/**
 * A run that switched models shows a "Model changed" boundary right before
 * the user message that triggered it.
 *
 * @summary the model switch boundary precedes its triggering message
 */
export const ModelSwitchBoundary: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: [
      ...turns(["assistant", 1, "Earlier answer"]),
      rawChatMessage({
        id: "user-2",
        chatId: CHAT_ID,
        role: "user",
        seq: 2,
        parts: [MODEL_CHANGE, { type: "text", text: "Triggering request" }],
      }),
    ],
  } satisfies ChatPageParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settledChat(canvasElement, OPEN_CHAT_ROUTES, "Triggering request");
    const boundary = canvas.getByRole("button", {
      name: "Model changed from model-a to model-b",
    });
    await expect(
      precedes(transcriptText(canvasElement, "Earlier answer"), boundary),
    ).toBe(true);
    await expect(
      precedes(boundary, transcriptText(canvasElement, "Triggering request")),
    ).toBe(true);
    await expect(canvas.queryByText(/unsupported part type/i)).toBeNull();
  },
};

/**
 * Server-authored context parts — every producer, including one this build
 * does not know — print nothing into the transcript: no debug text, no
 * reminder markup, and none of the prompt-side content they carry.
 *
 * @summary context parts never surface as chat content
 */
export const HidesContextParts: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: [
      rawChatMessage({
        id: "user-1",
        chatId: CHAT_ID,
        role: "user",
        seq: 1,
        parts: [
          MODEL_CHANGE,
          contextPart(
            "tool-availability",
            { kind: "delta", added: [], removed: [] },
            "tools changed",
          ),
          contextPart(
            "recency-digest",
            {
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
            "another chat exists",
          ),
          contextPart("from-a-newer-api", { anything: true }, "future context"),
          { type: "text", text: "Owner question" },
        ],
      }),
    ],
  } satisfies ChatPageParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settledChat(canvasElement, OPEN_CHAT_ROUTES, "Owner question");
    await expect(canvas.queryByText(/unsupported part type/i)).toBeNull();
    await expect(canvas.queryByText(/Another chat/)).toBeNull();
    await expect(
      canvas.queryByText(/tools changed|another chat exists|future context/i),
    ).toBeNull();
    await expect(canvas.queryByText(/<system-reminder/)).toBeNull();
  },
};

/**
 * A reply whose run stayed on one model offers its System prompt receipt and
 * shows no model switch.
 *
 * @summary a same-model reply has a receipt and no switch boundary
 */
export const RunReceiptWithoutSwitch: Story = {
  tags: ["ai-generated"],
  parameters: {
    history: [
      ...turns(["user", 1, "Same model request"]),
      rawChatMessage({
        id: "assistant-2",
        chatId: CHAT_ID,
        role: "assistant",
        seq: 2,
        parts: [{ type: "text", text: "Same model answer" }],
        usage: { runId: RUN_ID },
      }),
    ],
  } satisfies ChatPageParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settledChat(canvasElement, OPEN_CHAT_ROUTES, "Same model answer");
    // The action row is transparent until its message is hovered or focused;
    // `toBeVisible` ignores an ancestor's opacity, so read the row's own.
    const receipt = canvas.getByRole("button", { name: "System prompt" });
    receipt.focus();
    await waitFor(() =>
      expect(getComputedStyle(receipt.parentElement!).opacity).toBe("1"),
    );
    await expect(
      canvas.queryByRole("button", { name: /model changed from/i }),
    ).toBeNull();
  },
};

const LIST_ROUTE = "GET /api/v1/chats";
const DETAIL_ROUTE = `GET /api/v1/chats/${CHAT_ID}`;
const LLAME_ROOT = "/home/operator/projects/llame";
const NEXT_ROOT = "/home/operator/projects/next";
const DOCS_ROOT = "/home/operator/projects/docs";

// The Workspace the api reports the chat bound to, changed by the story.
let boundRoot = LLAME_ROOT;

/** The chat's card, bound to `workspaceRoot`. */
function chatCard(workspaceRoot: string): ChatListItemResponse {
  return {
    id: CHAT_ID,
    ownerUserId: "u1",
    title: "Project chat",
    visibility: "private",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    archivedAt: null,
    projectId: null,
    workspaceRoot,
    lastMessage: null,
  };
}

/** Serves the chat's card to the chat header, cached as a prior page left
 *  it (bound to LLAME_ROOT). The header finds a `listed` chat in the rail's
 *  list and an unlisted (archived) one only through GET /chats/:id. */
function serveChatCard(listed: boolean) {
  boundRoot = LLAME_ROOT;
  const rail = (pinned: string | null) =>
    listed && pinned === "exclude" ? [chatCard(boundRoot)] : [];
  for (const pinned of ["only", "exclude"] as const) {
    queryClient.setQueryData(
      chatQueryKeys.infinite(
        pinned === "only" ? { pinned, archived: "with" } : { pinned },
      ),
      { pages: [rail(pinned)], pageParams: [undefined] },
    );
  }
  if (!listed) {
    queryClient.setQueryData(
      chatQueryKeys.detail(CHAT_ID),
      chatCard(boundRoot),
    );
  }
  routeAlso({
    [LIST_ROUTE]: (input) =>
      Promise.resolve(
        jsonResponse(
          rail(new URL(requestOf(input).url).searchParams.get("pinned")),
        ),
      ),
    [DETAIL_ROUTE]: () => Promise.resolve(jsonResponse(chatCard(boundRoot))),
  });
}

/** The page under the chat header with session details beside it, stacked
 *  as the chat layout stacks them. */
function ChatUnderHeader(props: ComponentProps<typeof ChatPage>) {
  return (
    <SidebarProvider className="min-h-0 flex-1">
      <SessionDetailsProvider defaultOpen>
        <SidebarInset className="flex flex-col overflow-hidden">
          <ChatHeader />
          <ChatPage {...props} />
        </SidebarInset>
        <SessionDetails />
      </SessionDetailsProvider>
    </SidebarProvider>
  );
}

// The chat header reads the open chat from the route.
const HEADED_CHAT = {
  history: historyWithUsage({ status: "completed" }),
  nextjs: { navigation: { pathname: `/chat/${CHAT_ID}` } },
};

/** Waits until session details show the chat bound to `root`. */
async function panelShows(canvasElement: HTMLElement, root: string) {
  await waitFor(() =>
    expect(
      within(canvasElement).getByRole("button", { name: root }),
    ).toBeVisible(),
  );
}

// Released by the story to end the first reply.
let endFirstReply: () => void = () => {};

/**
 * The start of every streamed reply refreshes the chat's card, so session
 * details show the Workspace the api prepared for that run while it still
 * streams — here for an archived chat the card reads only through
 * GET /chats/:id.
 *
 * @summary each reply's start refreshes the session details' Workspace
 */
export const WorkspaceRefreshesEachRun: Story = {
  tags: ["ai-generated"],
  parameters: HEADED_CHAT,
  render: (args) => <ChatUnderHeader {...args} />,
  beforeEach: () => {
    serveChatCard(false);
    const firstEnded = new Promise<void>((resolve) => {
      endFirstReply = resolve;
    });
    let sends = 0;
    routeAlso({
      [SEND_ROUTE]: () => {
        sends += 1;
        return Promise.resolve(
          sends === 1
            ? streamedReply(firstEnded)
            : streamedReply(new Promise<void>(() => {}), "reply-2"),
        );
      },
    });
  },
  play: async ({ canvasElement }) => {
    const stop = () =>
      within(canvasElement).getByRole("button", { name: "Stop generation" });
    const refresh = [LIST_ROUTE, LIST_ROUTE, DETAIL_ROUTE];
    await settledChat(canvasElement);
    await panelShows(canvasElement, LLAME_ROOT);

    boundRoot = NEXT_ROOT;
    await sendFollowUp(canvasElement);
    await panelShows(canvasElement, NEXT_ROOT);
    await expect(stop()).toBeVisible();
    await expect(sentRoutes()).toEqual([
      ...OPEN_CHAT_ROUTES,
      SEND_ROUTE,
      ...refresh,
    ]);

    // The finished reply refreshes the card again and re-reads the history.
    endFirstReply();
    const firstRun = [
      ...OPEN_CHAT_ROUTES,
      SEND_ROUTE,
      ...refresh,
      ...refresh,
      HISTORY_ROUTE,
    ];
    await waitFor(() => expect(sentRoutes()).toEqual(firstRun));

    boundRoot = DOCS_ROOT;
    await sendFollowUp(canvasElement);
    await panelShows(canvasElement, DOCS_ROOT);
    await expect(stop()).toBeVisible();
    await expect(sentRoutes()).toEqual([...firstRun, SEND_ROUTE, ...refresh]);
  },
};

/** A reply that enters `root` mid-stream: the tool call streams at once, its
 *  successful result once `entered` settles, then a line of text; the reply
 *  never finishes. */
function workspaceEntryReply(root: string, entered: Promise<void>) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start", messageId: "reply-1" });
        writer.write({
          type: "tool-input-available",
          toolCallId: "enter-1",
          toolName: "enter_workspace",
          input: { path: root },
        });
        await entered;
        writer.write({
          type: "tool-output-available",
          toolCallId: "enter-1",
          output: { status: "success", root },
        });
        writer.write({ type: "text-start", id: "text-1" });
        writer.write({
          type: "text-delta",
          id: "text-1",
          delta: "Workspace is ready.",
        });
        await new Promise<void>(() => {});
      },
    }),
  });
}

// Released by the story once the reply's start has refreshed the card.
let enterWorkspace: () => void = () => {};

/**
 * When the agent enters a Workspace mid-reply, session details pick up the
 * new binding as soon as the entry succeeds — once, not again for the text
 * that follows it.
 *
 * @summary a live Workspace entry refreshes session details once
 */
export const WorkspaceRefreshesOnEntry: Story = {
  tags: ["ai-generated"],
  parameters: HEADED_CHAT,
  render: (args) => <ChatUnderHeader {...args} />,
  beforeEach: () => {
    serveChatCard(true);
    const entered = new Promise<void>((resolve) => {
      enterWorkspace = resolve;
    });
    routeAlso({
      [SEND_ROUTE]: () =>
        Promise.resolve(workspaceEntryReply(NEXT_ROOT, entered)),
    });
  },
  play: async ({ canvasElement }) => {
    await settledChat(canvasElement);
    await sendFollowUp(canvasElement);
    // The reply's start refreshes the card before the entry rebinds the chat.
    const started = [...OPEN_CHAT_ROUTES, SEND_ROUTE, LIST_ROUTE, LIST_ROUTE];
    await waitFor(() => expect(sentRoutes()).toEqual(started));
    await panelShows(canvasElement, LLAME_ROOT);

    boundRoot = NEXT_ROOT;
    enterWorkspace();

    await panelShows(canvasElement, NEXT_ROOT);
    await transcriptShows(canvasElement, "Workspace is ready.");
    await expect(sentRoutes()).toEqual([...started, LIST_ROUTE, LIST_ROUTE]);
  },
};

/**
 * Reopening a chat whose history already entered a Workspace leaves the
 * session details on the cached card: a past entry refreshes nothing.
 *
 * @summary a past Workspace entry does not refresh the card on open
 */
export const PastWorkspaceEntryKeepsCard: Story = {
  tags: ["ai-generated"],
  parameters: {
    ...HEADED_CHAT,
    history: [
      rawChatMessage({
        id: "assistant-1",
        chatId: CHAT_ID,
        role: "assistant",
        seq: 1,
        parts: [
          {
            type: "tool-enter_workspace",
            toolCallId: "enter-1",
            state: "output-available",
            input: { path: LLAME_ROOT },
            output: { status: "success", root: LLAME_ROOT },
          },
          { type: "text", text: "Entered the project." },
        ],
      }),
    ],
  },
  render: (args) => <ChatUnderHeader {...args} />,
  beforeEach: () => {
    serveChatCard(true);
    // A refresh would pick up this later binding.
    boundRoot = NEXT_ROOT;
  },
  play: async ({ canvasElement }) => {
    await settledChat(canvasElement, OPEN_CHAT_ROUTES, "Entered the project.");
    await panelShows(canvasElement, LLAME_ROOT);
    await expect(sentRoutes()).toEqual(OPEN_CHAT_ROUTES);
  },
};
