// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatProvider } from "@/contexts/chat-context";
import { modelQueryKeys } from "@/lib/services/models/queries";

import { ModelSelector } from "./model-selector";

afterEach(() => {
  cleanup();
});

function renderModelSelector() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(modelQueryKeys.all, {
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
    renderModelSelector();

    await waitFor(() => {
      expect(screen.getByRole("combobox").textContent).toContain("Model Two");
    });
  });
});
