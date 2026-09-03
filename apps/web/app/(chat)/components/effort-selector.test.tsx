// @vitest-environment jsdom

/**
 * Coverage for the reasoning-effort derivation (useActiveEffortSelection) and
 * the trigger/null-render branches of EffortSelector. Real ChatContext and
 * useModelsQuery run against a stubbed globalThis.fetch — no first-party
 * module mocking. Dragging the popover's Slider is DOM-interaction surface
 * (docs/testing.md rule 5) left to the component's own Storybook story;
 * this file drives model switches through ChatContext instead, which is
 * how the same seeding/reset logic is actually reachable.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { ChatProvider, useChatContext } from "@/contexts/chat-context";
import type {
  AvailableModel,
  ModelsResponse,
} from "@/lib/services/models/queries";

import { EffortSelector } from "./effort-selector";

function model(
  overrides: Partial<AvailableModel> & { id: string },
): AvailableModel {
  return {
    source: "system",
    contextWindowTokens: 128_000,
    ...overrides,
  };
}

function stubModels(response: ModelsResponse) {
  const fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/models") return jsonResponse(response);
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

function Harness() {
  const { setSelectedModel, selectedEffort } = useChatContext();
  return (
    <div>
      <button type="button" onClick={() => setSelectedModel("model-a")}>
        pick a
      </button>
      <button type="button" onClick={() => setSelectedModel("model-b")}>
        pick b
      </button>
      <button type="button" onClick={() => setSelectedModel("model-c")}>
        pick c
      </button>
      <span data-testid="effort">{selectedEffort ?? "none"}</span>
      <EffortSelector />
    </div>
  );
}

function renderHarness(response: ModelsResponse) {
  stubModels(response);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ChatProvider>
        <Harness />
      </ChatProvider>
    </QueryClientProvider>,
  );
}

const modelA = model({
  id: "model-a",
  reasoning: {
    effortLevels: [
      { value: "low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    defaultEffort: "medium",
    cacheInvalidatedByEffortChange: false,
  },
});

const modelB = model({ id: "model-b" }); // no `reasoning` at all.

const modelC = model({
  id: "model-c",
  reasoning: {
    effortLevels: [{ value: "x" }, { value: "y", label: "Y" }],
    defaultEffort: "x",
    cacheInvalidatedByEffortChange: true,
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("EffortSelector", () => {
  it("renders nothing for the catalog default model when it declares no reasoning", async () => {
    renderHarness({ defaultModelId: "model-b", models: [modelA, modelB] });

    await waitFor(() => expect(screen.getByTestId("effort")).toBeTruthy());
    expect(
      screen.queryByRole("button", { name: /Reasoning effort/ }),
    ).toBeNull();
    expect(screen.getByTestId("effort").textContent).toBe("none");
  });

  it("renders nothing when the model declares an empty effort vocabulary", async () => {
    const modelEmpty = model({
      id: "model-empty",
      reasoning: {
        effortLevels: [],
        defaultEffort: "n/a",
        cacheInvalidatedByEffortChange: false,
      },
    });
    renderHarness({ defaultModelId: "model-empty", models: [modelEmpty] });

    await waitFor(() => expect(screen.getByTestId("effort")).toBeTruthy());
    expect(
      screen.queryByRole("button", { name: /Reasoning effort/ }),
    ).toBeNull();
  });

  it("falls back to the catalog default model and seeds the default effort", async () => {
    renderHarness({ defaultModelId: "model-a", models: [modelA, modelB] });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reasoning effort, Medium" }),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("effort").textContent).toBe("medium"),
    );
  });

  it("shows the raw value in place of a label when the active level has none", async () => {
    renderHarness({ defaultModelId: "model-c", models: [modelC] });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reasoning effort, x" }),
      ).toBeTruthy(),
    );
  });

  it("clears the selected effort when switching to a model with no reasoning", async () => {
    renderHarness({ defaultModelId: "model-a", models: [modelA, modelB] });

    await waitFor(() =>
      expect(screen.getByTestId("effort").textContent).toBe("medium"),
    );

    fireEvent.click(screen.getByRole("button", { name: "pick b" }));

    await waitFor(() =>
      expect(screen.getByTestId("effort").textContent).toBe("none"),
    );
    expect(
      screen.queryByRole("button", { name: /Reasoning effort/ }),
    ).toBeNull();
  });

  it("resets to the new model's own default when the carried-over effort isn't in its vocabulary", async () => {
    renderHarness({
      defaultModelId: "model-a",
      models: [modelA, modelB, modelC],
    });

    await waitFor(() =>
      expect(screen.getByTestId("effort").textContent).toBe("medium"),
    );

    fireEvent.click(screen.getByRole("button", { name: "pick c" }));

    await waitFor(() =>
      expect(screen.getByTestId("effort").textContent).toBe("x"),
    );
    expect(
      screen.getByRole("button", { name: "Reasoning effort, x" }),
    ).toBeTruthy();
  });

  it("opens the popover on click, showing the trade-off labels and the slider", async () => {
    renderHarness({ defaultModelId: "model-a", models: [modelA, modelB] });

    const trigger = await screen.findByRole("button", {
      name: "Reasoning effort, Medium",
    });
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByText("Faster")).toBeTruthy());
    expect(screen.getByText("Smarter")).toBeTruthy();
    // The visually-hidden live region announces the active level for screen
    // readers, since the slider's own value is a meaningless index.
    expect(
      screen.getByText("Medium", { selector: "[aria-live]" }),
    ).toBeTruthy();
  });
});
