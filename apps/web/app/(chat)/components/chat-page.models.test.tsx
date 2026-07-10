// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const routerMock = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/contexts/active-runs-context", () => ({
  useActiveRuns: () => ({
    trackRun: vi.fn(),
    untrackChat: vi.fn(),
    completedChats: new Set<string>(),
    markChatSeen: vi.fn(),
  }),
}));

const sendMessage = vi.fn();
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: "ready",
    stop: vi.fn(),
    error: undefined,
  }),
}));

const modelsQuery = vi.hoisted(() => ({
  state: {
    data: undefined as
      | {
          defaultModelId: string;
          models: Array<{ id: string; source: "system"; name?: string }>;
        }
      | undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
  },
}));

vi.mock("@/lib/services/models/queries", () => ({
  useModelsQuery: () => modelsQuery.state,
  hasModelId: (models: Array<{ id: string }>, modelId: string): boolean =>
    models.some((model) => model.id === modelId),
  modelDisplayName: (
    modelId: string,
    models?: Array<{ id: string; name?: string }>,
  ): string => models?.find((model) => model.id === modelId)?.name ?? modelId,
}));

import { ChatProvider } from "@/contexts/chat-context";

import { ChatPage } from "./chat-page";

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (
      globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
    ).ResizeObserver = ResizeObserverStub;
  }
});

afterEach(() => {
  cleanup();
  sendMessage.mockReset();
  modelsQuery.state = {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
  };
});

function renderDraftChat() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ChatProvider>
        <ChatPage />
      </ChatProvider>
    </QueryClientProvider>,
  );
}

describe("ChatPage model gating", () => {
  it("leaves the composer input usable but disables send while models are loading", async () => {
    const user = userEvent.setup();
    renderDraftChat();

    const input = screen.getByPlaceholderText("What would you like to know?");
    const send = screen.getByRole("button", { name: "Send message" });

    expect((input as HTMLTextAreaElement).disabled).toBe(false);
    expect((send as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, "Hello");
    expect((input as HTMLTextAreaElement).value).toBe("Hello");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("selects the API default and allows send when the selected model is valid", async () => {
    modelsQuery.state = {
      data: {
        defaultModelId: "system:openai:gpt-5.4-mini",
        models: [
          {
            id: "system:openai:gpt-5.4-mini",
            source: "system",
            name: "GPT-5.4 mini",
          },
        ],
      },
      isPending: false,
      isError: false,
      isSuccess: true,
    };
    const user = userEvent.setup();
    renderDraftChat();

    const input = screen.getByPlaceholderText("What would you like to know?");
    const send = screen.getByRole("button", { name: "Send message" });

    await waitFor(() =>
      expect((send as HTMLButtonElement).disabled).toBe(false),
    );
    await user.type(input, "Hello");
    await user.click(send);

    expect(sendMessage).toHaveBeenCalledWith({ text: "Hello" });
  });
});
