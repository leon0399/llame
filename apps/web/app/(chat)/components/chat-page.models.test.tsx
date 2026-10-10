// @vitest-environment jsdom

/**
 * The real useModelsQuery and ActiveRunsProvider run against a stubbed
 * globalThis.fetch, routed per pathname: GET /api/v1/models drives the
 * pending-vs-loaded model gating this suite tests, and GET /api/v1/me/runs
 * (ActiveRunsProvider's mount rehydration) always answers with no active
 * runs — that provider's own polling is contexts/active-runs-context.test.tsx's
 * job, not this suite's. POST /api/v1/media answers the composer's image
 * uploads in the attachment tests. Only next/navigation and the AI SDK's
 * useChat (both external, no in-process seam) are mocked.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
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
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { rawChatMessage } from "@/lib/services/chat/message-fixtures";
import type { ChatMessagesResponse } from "@/lib/services/chat/history";

const routerMock = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const sendMessage = vi.fn();
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: "ready",
    stop: vi.fn(),
    error: undefined,
    setMessages: vi.fn(),
    // ChatPage drives resume itself (guarded against Strict Mode's double
    // mount effect — see its useChat call), so the stub must provide it.
    resumeStream: vi.fn(),
  }),
}));

import { ActiveRunsProvider } from "@/contexts/active-runs-context";
import { ChatProvider } from "@/contexts/chat-context";

import { ChatPage } from "./chat-page";
import { ensureChatMarkdownRenderersLoaded } from "./use-chat-markdown-ready";

beforeAll(async () => {
  await ensureChatMarkdownRenderersLoaded();
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
  // jsdom has no object URLs; composer thumbnails only need a string src.
  if (!("createObjectURL" in URL)) {
    Object.assign(URL, {
      createObjectURL: () => "blob:thumbnail",
      revokeObjectURL: () => {},
    });
  }
});

const CHAT_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";

let fetchMock: Mock<typeof fetch>;
// Left unresolved by default — GET /api/v1/models stays pending until a test
// overrides this, mirroring useModelsQuery's real isPending state.
let modelsHandler: () => Promise<Response>;
// Per-test-overridable handler for GET /api/v1/chats/:id/messages — empty by
// default, so a persisted chat's history probe resolves with no messages.
let messagesHandler: () => Promise<Response>;
// Per-test-overridable handler for GET /api/v1/permission-modes — default-only
// by default, so the last-turn restore never offers `bypass` unless a test says so.
let permissionModesHandler: () => Promise<Response>;
// Per-test-overridable handler for POST /api/v1/media — unrouted by default,
// so only the attachment tests upload.
let mediaUploadHandler: () => Promise<Response>;

beforeEach(() => {
  fetchMock = stubFetch();
  modelsHandler = () => new Promise<Response>(() => {});
  messagesHandler = () =>
    Promise.resolve(
      jsonResponse<ChatMessagesResponse>({ compaction: null, messages: [] }),
    );
  permissionModesHandler = () =>
    Promise.resolve(jsonResponse({ modes: [{ value: "default" }] }));
  mediaUploadHandler = () =>
    Promise.reject(new Error("unrouted fetch in test: POST /api/v1/media"));
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    if (pathname === "/api/v1/models") return modelsHandler();
    if (pathname === "/api/v1/permission-modes")
      return permissionModesHandler();
    if (pathname === `/api/v1/chats/${CHAT_ID}/messages`)
      return messagesHandler();
    if (pathname === "/api/v1/media" && request.method === "POST")
      return mediaUploadHandler();
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
});

afterEach(() => {
  cleanup();
  sendMessage.mockReset();
  // NOT vi.unstubAllGlobals() — beforeAll's ResizeObserver stub must survive
  // across tests; beforeEach's stubFetch() already replaces fetch fresh.
});

function renderChat(
  initialChatExists: boolean,
  initialDraftPhase: "fresh" | null,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveRunsProvider>
        <ChatProvider>
          <ChatPage
            chatId={CHAT_ID}
            initialChatExists={initialChatExists}
            initialDraftPhase={initialDraftPhase}
          />
        </ChatProvider>
      </ActiveRunsProvider>
    </QueryClientProvider>,
  );
}

/** A persisted chat (history is fetched) — the path the last-message model
 *  restore runs on. */
function renderPersistedChat() {
  return renderChat(true, null);
}

describe("ChatPage model gating", () => {
  it("leaves the composer input usable but disables send while models are loading", async () => {
    const user = userEvent.setup();
    renderChat(false, "fresh");

    const input = screen.getByPlaceholderText("What would you like to know?");
    const send = screen.getByRole("button", { name: "Send message" });

    // SAFETY: the composer textarea is queried by its own placeholder text,
    // so its concrete DOM element type is known even though Testing
    // Library's return type is `HTMLElement`.
    expect((input as HTMLTextAreaElement).disabled).toBe(false);
    // SAFETY: `send` is the composer's send button, queried by its own role.
    expect((send as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, "Hello");
    // SAFETY: same as above — `input` is the composer textarea.
    expect((input as HTMLTextAreaElement).value).toBe("Hello");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("selects the API default and allows send when the selected model is valid", async () => {
    modelsHandler = () =>
      Promise.resolve(
        jsonResponse<ModelsResponse>({
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
        }),
      );
    const user = userEvent.setup();
    renderChat(false, "fresh");

    const input = screen.getByPlaceholderText("What would you like to know?");
    const send = screen.getByRole("button", { name: "Send message" });

    // SAFETY: `send` is the composer's send button, queried by its own role.
    await waitFor(() =>
      expect((send as HTMLButtonElement).disabled).toBe(false),
    );
    await user.type(input, "Hello");
    await user.click(send);

    expect(sendMessage).toHaveBeenCalledWith({ text: "Hello", files: [] });
  });
});

describe("ChatPage last-message model restore", () => {
  /** The model a chat's last recorded turn used, plus the catalog default. */
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
      {
        id: "system:openai:gpt-5.4",
        source: "system",
        name: "GPT-5.4",
        contextWindowTokens: 400_000,
        input: ["text"],
      },
    ],
  };

  it("selects the model used by the chat's last message", async () => {
    modelsHandler = () => Promise.resolve(jsonResponse(MODELS_RESPONSE));
    messagesHandler = () =>
      Promise.resolve(
        jsonResponse<ChatMessagesResponse>({
          compaction: null,
          messages: [
            rawChatMessage({
              chatId: CHAT_ID,
              id: "msg-1",
              seq: 1,
              role: "assistant",
              parts: [{ type: "text", text: "hello" }],
              usage: { modelId: "system:openai:gpt-5.4", status: "completed" },
            }),
          ],
        }),
      );
    renderPersistedChat();

    const selector = screen.getByRole("combobox");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe("Select model, GPT-5.4"),
    );
  });

  it("falls back to the default model when the last message's model is unavailable", async () => {
    modelsHandler = () => Promise.resolve(jsonResponse(MODELS_RESPONSE));
    // The last turn ran a model that is no longer in the catalog (it was
    // removed/was configured only for that run) — the sender must not select
    // a dead model id.
    messagesHandler = () =>
      Promise.resolve(
        jsonResponse<ChatMessagesResponse>({
          compaction: null,
          messages: [
            rawChatMessage({
              chatId: CHAT_ID,
              id: "msg-1",
              seq: 1,
              role: "assistant",
              parts: [{ type: "text", text: "hello" }],
              usage: {
                modelId: "system:openai:retired-model",
                status: "completed",
              },
            }),
          ],
        }),
      );
    renderPersistedChat();

    const selector = screen.getByRole("combobox");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe(
        "Select model, GPT-5.4 mini",
      ),
    );
  });

  it("keeps the operator default when the chat has no recorded model", async () => {
    modelsHandler = () => Promise.resolve(jsonResponse(MODELS_RESPONSE));
    // Persisted chat whose last turn recorded no telemetry model (legacy).
    messagesHandler = () =>
      Promise.resolve(
        jsonResponse<ChatMessagesResponse>({
          compaction: null,
          messages: [
            rawChatMessage({
              chatId: CHAT_ID,
              id: "msg-1",
              seq: 1,
              role: "assistant",
              parts: [{ type: "text", text: "hello" }],
              usage: { status: "completed" },
            }),
          ],
        }),
      );
    renderPersistedChat();

    const selector = screen.getByRole("combobox");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe(
        "Select model, GPT-5.4 mini",
      ),
    );
  });

  it("restores the reasoning effort used by the last message", async () => {
    modelsHandler = () =>
      Promise.resolve(
        jsonResponse<ModelsResponse>({
          defaultModelId: "system:openai:gpt-5.4-mini",
          models: [
            {
              id: "system:openai:gpt-5.4-mini",
              source: "system",
              name: "GPT-5.4 mini",
              contextWindowTokens: 400_000,
              input: ["text"],
            },
            {
              id: "system:openai:gpt-5.4",
              source: "system",
              name: "GPT-5.4",
              contextWindowTokens: 400_000,
              input: ["text"],
              reasoning: {
                effortLevels: [
                  { value: "low", label: "Low" },
                  { value: "high", label: "High" },
                ],
                defaultEffort: "low",
                cacheInvalidatedByEffortChange: false,
              },
            },
          ],
        }),
      );
    messagesHandler = () =>
      Promise.resolve(
        jsonResponse<ChatMessagesResponse>({
          compaction: null,
          messages: [
            rawChatMessage({
              chatId: CHAT_ID,
              id: "msg-1",
              seq: 1,
              role: "assistant",
              parts: [{ type: "text", text: "hello" }],
              usage: {
                modelId: "system:openai:gpt-5.4",
                status: "completed",
                effort: "high",
              },
            }),
          ],
        }),
      );
    renderPersistedChat();

    await screen.findByRole("button", { name: "Reasoning effort, High" });
  });
});

describe("ChatPage image attachments", () => {
  const VISION_MODELS: ModelsResponse = {
    defaultModelId: "system:openai:vision",
    models: [
      {
        id: "system:openai:vision",
        source: "system",
        name: "Vision",
        contextWindowTokens: 400_000,
        input: ["text", "image"],
      },
    ],
  };
  const LOCATOR_A = "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a01";
  const LOCATOR_B = "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a02";

  /** Answers uploads in request order: the first gets `LOCATOR_A` and
   *  `a.png`, the second `LOCATOR_B` and `b.png`, later ones the next
   *  locators and `image-n.png`. */
  function answerUploads(): void {
    let count = 0;
    mediaUploadHandler = () => {
      count += 1;
      const locator = `media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a${String(count).padStart(2, "0")}`;
      const name = ["a.png", "b.png"][count - 1] ?? `image-${count}.png`;
      return Promise.resolve(
        jsonResponse(
          {
            id: locator.slice("media://".length),
            locator,
            provenance: "upload",
            mediaType: "image/png",
            name,
            width: 4,
            height: 4,
            byteSize: 68,
            model: {
              mediaType: "image/png",
              width: 4,
              height: 4,
              byteSize: 68,
            },
          },
          201,
        ),
      );
    };
  }

  /** Pastes PNGs named `names` into the composer. */
  function pasteImages(input: HTMLElement, names: Array<string>): void {
    fireEvent.paste(input, {
      clipboardData: {
        types: ["Files"],
        files: names.map(
          (name) => new File([name], name, { type: "image/png" }),
        ),
      },
    });
  }

  /** Pastes two PNGs into the composer and waits until both uploaded. */
  async function pasteTwoImages() {
    modelsHandler = () => Promise.resolve(jsonResponse(VISION_MODELS));
    answerUploads();
    renderChat(false, "fresh");
    const input = screen.getByPlaceholderText("What would you like to know?");
    const send = screen.getByRole("button", { name: "Send message" });
    // SAFETY: `send` is the composer's send button, queried by its own role.
    await waitFor(() =>
      expect((send as HTMLButtonElement).disabled).toBe(false),
    );
    pasteImages(input, ["a.png", "b.png"]);
    await waitFor(() =>
      expect(screen.queryAllByRole("status", { name: "Uploading" })).toEqual(
        [],
      ),
    );
    // SAFETY: as above.
    expect((send as HTMLButtonElement).disabled).toBe(false);
    return { input, send };
  }

  it("sends an image-only message as file parts without a text part", async () => {
    const user = userEvent.setup();
    const { send } = await pasteTwoImages();

    await user.click(send);

    expect(sendMessage).toHaveBeenCalledWith({
      files: [
        {
          type: "file",
          mediaType: "image/png",
          url: LOCATOR_A,
          filename: "a.png",
        },
        {
          type: "file",
          mediaType: "image/png",
          url: LOCATOR_B,
          filename: "b.png",
        },
      ],
    });
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Attached images" })).toBe(
        null,
      ),
    );
  });

  it("sends file parts in the order the keyboard reorder left them", async () => {
    const user = userEvent.setup();
    const { input, send } = await pasteTwoImages();

    screen.getByRole("button", { name: "b.png" }).focus();
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(screen.getByRole("button", { name: "b.png" })).toBe(
      document.activeElement,
    );
    await user.type(input, "Compare these");
    await user.click(send);

    expect(sendMessage).toHaveBeenCalledWith({
      text: "Compare these",
      files: [
        expect.objectContaining({ url: LOCATOR_B }),
        expect.objectContaining({ url: LOCATOR_A }),
      ],
    });
  });

  /** Holds the next send pending until the returned `fail` rejects it. */
  function holdSend() {
    let reject: (error: Error) => void = () => {};
    sendMessage.mockImplementation(
      () =>
        new Promise<void>((_resolve, rejectSend) => {
          reject = rejectSend;
        }),
    );
    return { fail: () => reject(new Error("send failed")) };
  }

  /** The attached images' names, in thumbnail order. */
  function attachedNames(): Array<string> {
    return screen
      .getAllByRole("img")
      .map((image) => image.getAttribute("alt") ?? "");
  }

  it("restores a failed send's images ahead of those attached while it was pending", async () => {
    const user = userEvent.setup();
    const { input, send } = await pasteTwoImages();
    const { fail } = holdSend();

    await user.click(send);
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Attached images" })).toBe(
        null,
      ),
    );
    pasteImages(input, ["c.png"]);
    await screen.findByRole("img", { name: "c.png" });
    fail();

    await waitFor(() =>
      expect(attachedNames()).toEqual(["a.png", "b.png", "c.png"]),
    );
  });

  it("caps the restored images at 10 and frees the previews the cap drops", async () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(
        (file) => `blob:${file instanceof File ? file.name : "unnamed"}`,
      );
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      const { input, send } = await pasteTwoImages();
      const { fail } = holdSend();
      const pendingNames = Array.from(
        { length: 9 },
        (_, index) => `pending-${index + 1}.png`,
      );

      await user.click(send);
      await waitFor(() =>
        expect(screen.queryByRole("list", { name: "Attached images" })).toBe(
          null,
        ),
      );
      pasteImages(input, pendingNames);
      await screen.findByRole("img", { name: "pending-9.png" });
      fail();

      await waitFor(() =>
        expect(attachedNames()).toEqual([
          "a.png",
          "b.png",
          ...pendingNames.slice(0, 8),
        ]),
      );
      expect(revokeObjectURL.mock.calls).toEqual([["blob:pending-9.png"]]);
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });
});
