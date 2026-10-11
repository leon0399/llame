// @vitest-environment jsdom

/**
 * The composer's image attachments on the real ChatPage, with the real
 * useModelsQuery and ActiveRunsProvider against a stubbed globalThis.fetch,
 * routed per pathname: GET /api/v1/models serves a vision model, GET
 * /api/v1/me/runs answers with no active runs, and POST /api/v1/media answers
 * the composer's uploads. Only next/navigation and the AI SDK's useChat (both
 * external, no in-process seam) are mocked, so these tests own the sends the
 * page hands useChat, including one that fails. The request an image-only
 * message sends is chat-page.stories.tsx's.
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
  afterAll,
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
import { setChatMarkdownRenderersForTests } from "./use-chat-markdown-ready";
import { installStubChatMarkdownRenderers } from "@/lib/test-support/chat-markdown";

beforeAll(() => {
  installStubChatMarkdownRenderers();
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

afterAll(() => {
  setChatMarkdownRenderersForTests(null);
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
  /** Answers uploads in request order under sequential `media://` ids: the
   *  first is `a.png`, the second `b.png`, later ones `image-n.png`. */
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
