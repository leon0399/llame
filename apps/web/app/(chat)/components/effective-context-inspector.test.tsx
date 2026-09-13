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
  state: "prepared" as const,
  receipts: [
    {
      attemptId: "a1b2c3d4-0000-0000-0000-000000000001",
      promptSource: "project_default" as const,
      systemPrompt: "You are a helpful assistant.",
      promptHash: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
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

    expect(screen.getByText("System prompt receipt")).toBeTruthy();
  });

  it("shows an error state when the receipt fails to load", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, 403));
    renderInspector("run1", true);

    expect(
      await screen.findByText("Could not load the receipt for this run."),
    ).toBeTruthy();
  });

  it("renders metadata and attempt receipt for a prepared run", async () => {
    fetchMock.mockResolvedValue(jsonResponse(receipt));
    renderInspector("run1", true);

    expect(await screen.findByText(receipt.modelId)).toBeTruthy();
    expect(screen.getByText("prepared")).toBeTruthy();
    expect(screen.getByText(receipt.receipts[0].systemPrompt)).toBeTruthy();
    expect(screen.getByText("Project default")).toBeTruthy();
    // No effort on this receipt: the row must be entirely absent.
    expect(screen.queryByText("Effort")).toBeNull();
  });

  it("renders effort and attempt details when present", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...receipt,
        effort: "high",
        completedAttemptId: receipt.receipts[0].attemptId,
        receipts: [
          {
            ...receipt.receipts[0],
            promptSource: "model_override" as const,
          },
        ],
      }),
    );
    renderInspector("run1", true);

    expect(await screen.findByText("high")).toBeTruthy();
    expect(screen.getByText("Model-specific override")).toBeTruthy();
  });

  it("shows pending message when no receipts exist", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...receipt,
        state: "pending",
        receipts: [],
      }),
    );
    renderInspector("run1", true);

    expect(
      await screen.findByText(
        "This run is queued; no attempt has prepared a prompt yet.",
      ),
    ).toBeTruthy();
  });

  it("waits for a runId before enabling the query (closed for a null run)", () => {
    renderInspector(null, true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
