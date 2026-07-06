// @vitest-environment jsdom

/**
 * useChatCompactionQuery's error state, in isolation from ChatPage's render
 * wiring. Before this, `chat-page.tsx` destructured only `data` from this
 * hook — a fetch that ERRORS (network blip, transient 5xx, an auth race)
 * left `compaction` silently `undefined`, indistinguishable from "no
 * compaction exists" and logged nowhere. That's the one failure mode the
 * boundary-render logic genuinely cannot detect (by design:
 * compactionBoundaryIndex has no way to tell "no data" from "errored"
 * apart), so it needs to be observable somewhere else — this pins that the
 * query itself DOES surface an error state a caller can act on.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: { get },
  buildApiUrl: (path: string) => `https://api.example.com${path}`,
}));

import { useChatCompactionQuery } from "./compaction";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useChatCompactionQuery", () => {
  it("surfaces a fetch failure as an error, rather than leaving data silently undefined", async () => {
    get.mockReturnValue({
      json: () => Promise.reject(new Error("network down")),
    });

    const { result } = renderHook(
      () => useChatCompactionQuery("chat-1", true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
  });

  it("resolves normally when the fetch succeeds", async () => {
    const compaction = {
      uptoSeq: 5,
      summary: "Summarized.",
      createdAt: "2026-07-06T00:00:00.000Z",
    };
    get.mockReturnValue({ json: () => Promise.resolve(compaction) });

    const { result } = renderHook(
      () => useChatCompactionQuery("chat-1", true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(compaction);
    expect(result.current.error).toBeNull();
  });
});
