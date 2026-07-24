// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const modelsQuery = vi.hoisted(() => ({
  state: {
    data: undefined as
      | {
          defaultModelId: string;
          models: Array<{ id: string; source: "system"; name?: string }>;
        }
      | undefined,
    isError: false,
    isPending: true,
  },
}));

// Stub only the query hook; keep the real hasModelId/modelDisplayName so the
// test exercises the shipped helpers rather than a hand-copied approximation.
vi.mock("@/lib/services/models/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/models/queries")>()),
  useModelsQuery: () => modelsQuery.state,
}));

import { ChatProvider } from "@/contexts/chat-context";

import { ModelSelector } from "./model-selector";

// Base UI Popover + cmdk need a handful of DOM APIs jsdom omits.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
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
  modelsQuery.state = { data: undefined, isError: false, isPending: true };
});

function renderModelSelector() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ChatProvider>
        <ModelSelector />
      </ChatProvider>
    </QueryClientProvider>,
  );
}

describe("ModelSelector", () => {
  it("initializes the visible selection from the API default model id", async () => {
    modelsQuery.state = {
      data: {
        defaultModelId: "system:openai:model-two",
        models: [
          {
            id: "system:openai:model-one",
            source: "system",
            name: "Model One",
          },
          {
            id: "system:openai:model-two",
            source: "system",
            name: "Model Two",
          },
        ],
      },
      isError: false,
      isPending: false,
    };

    renderModelSelector();

    await waitFor(() => {
      expect(screen.getByRole("combobox").textContent).toContain("Model Two");
    });
  });

  it("stays openable and shows skeleton rows in the picker while the catalog loads", async () => {
    // Default hoisted state is isPending with no data.
    const user = userEvent.setup();
    renderModelSelector();

    const trigger = screen.getByRole("combobox");
    expect((trigger as HTMLButtonElement).disabled).toBe(false);

    await user.click(trigger);

    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-slot="skeleton"]').length,
      ).toBeGreaterThan(0);
    });
  });
});
