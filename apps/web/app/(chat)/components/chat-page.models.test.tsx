// @vitest-environment jsdom

/**
 * The real useModelsQuery and ActiveRunsProvider run against a stubbed
 * globalThis.fetch, routed per pathname: GET /api/v1/models drives the
 * pending-vs-loaded model gating this suite tests, and GET /api/v1/me/runs
 * (ActiveRunsProvider's mount rehydration) always answers with no active
 * runs — that provider's own polling is contexts/active-runs-context.test.tsx's
 * job, not this suite's. Only next/navigation and the AI SDK's useChat (both
 * external, no in-process seam) are mocked.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    // ChatPage drives resume itself (guarded against Strict Mode's double
    // mount effect — see its useChat call), so the stub must provide it.
    resumeStream: vi.fn(),
  }),
}));

import { ActiveRunsProvider } from "@/contexts/active-runs-context";
import { ChatProvider } from "@/contexts/chat-context";

import { ChatPage } from "./chat-page";

let fetchMock: Mock<typeof fetch>;
// Left unresolved by default — GET /api/v1/models stays pending until a test
// overrides this, mirroring useModelsQuery's real isPending state.
let modelsHandler: () => Promise<Response>;

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
  fetchMock = stubFetch();
  modelsHandler = () => new Promise<Response>(() => {});
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    if (pathname === "/api/v1/models") return modelsHandler();
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
});

afterEach(() => {
  cleanup();
  sendMessage.mockReset();
  // NOT vi.unstubAllGlobals() — beforeAll's ResizeObserver stub must survive
  // across tests; beforeEach's stubFetch() already replaces fetch fresh.
});

function renderDraftChat() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveRunsProvider>
        <ChatProvider>
          <ChatPage
            chatId="a5dc235e-1de8-4aad-84d8-e0e247b6a135"
            initialChatExists={false}
            initialDraftPhase="fresh"
          />
        </ChatProvider>
      </ActiveRunsProvider>
    </QueryClientProvider>,
  );
}

describe("ChatPage model gating", () => {
  it("leaves the composer input usable but disables send while models are loading", async () => {
    const user = userEvent.setup();
    renderDraftChat();

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
            },
          ],
        }),
      );
    const user = userEvent.setup();
    renderDraftChat();

    const input = screen.getByPlaceholderText("What would you like to know?");
    const send = screen.getByRole("button", { name: "Send message" });

    // SAFETY: `send` is the composer's send button, queried by its own role.
    await waitFor(() =>
      expect((send as HTMLButtonElement).disabled).toBe(false),
    );
    await user.type(input, "Hello");
    await user.click(send);

    expect(sendMessage).toHaveBeenCalledWith({ text: "Hello" });
  });
});
