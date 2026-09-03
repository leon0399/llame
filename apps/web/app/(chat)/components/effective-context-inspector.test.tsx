// @vitest-environment jsdom

/**
 * useRunContextReceipt runs for real against a stubbed globalThis.fetch, so
 * the loading/error/data branches are proved by actual query state, not a
 * mocked hook.
 */

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
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

import { EffectiveContextInspector } from "./effective-context-inspector";

let fetchMock: Mock<typeof fetch>;
let queryClient: QueryClient;

const receipt = {
  modelId: "system:openai:gpt-5.4-mini",
  promptSource: "project_default" as const,
  systemPrompt: "You are a helpful assistant.",
  tools: [],
  contentHash: "abc123",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeAll(() => {
  for (const method of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        value: () => false,
        writable: true,
      });
    }
  }
});

beforeEach(() => {
  fetchMock = stubFetch();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderInspector(runId: string | null, open: boolean) {
  return render(
    <QueryClientProvider client={queryClient}>
      <EffectiveContextInspector
        runId={runId}
        open={open}
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("EffectiveContextInspector", () => {
  it("stays disabled (no fetch) while closed", () => {
    renderInspector("run1", false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a loading state while the receipt is in flight", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    renderInspector("run1", true);

    expect(screen.getByText("Loading effective context…")).toBeTruthy();
  });

  it("shows an error state when the receipt fails to load", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, 403));
    renderInspector("run1", true);

    expect(
      await screen.findByText("Effective context unavailable"),
    ).toBeTruthy();
  });

  it("renders the metadata, prompt, and 'no tools advertised' when tools is empty", async () => {
    fetchMock.mockResolvedValue(jsonResponse(receipt));
    renderInspector("run1", true);

    expect(await screen.findByText(receipt.modelId)).toBeTruthy();
    expect(screen.getByText("Project default")).toBeTruthy();
    expect(screen.getByText(receipt.systemPrompt)).toBeTruthy();
    expect(
      screen.getByText("No tools were advertised to this run."),
    ).toBeTruthy();
    // No effort on this receipt: the row must be entirely absent, not blank.
    expect(screen.queryByText("Effort")).toBeNull();
  });

  it("renders the effort row when present, and each advertised tool", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...receipt,
        effort: "high",
        promptSource: "model_override",
        tools: [
          {
            id: "search_conversations",
            description: "Search prior conversations.",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );
    renderInspector("run1", true);

    expect(await screen.findByText("high")).toBeTruthy();
    expect(screen.getByText("Model-specific override")).toBeTruthy();
    expect(screen.getByText("search_conversations")).toBeTruthy();
    expect(screen.getByText("Search prior conversations.")).toBeTruthy();
  });

  it("waits for a runId before enabling the query (closed for a null run)", () => {
    renderInspector(null, true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
